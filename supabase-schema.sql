-- =====================================================================
-- PADEL DIARY — Supabase schema (run once in the Supabase SQL Editor)
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROFILES  (one row per real user, linked to Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default 'Player',
  photo_url     text,
  racket        text,
  side          text not null default 'Right',
  dob           date,
  gender        text,
  rackets_owned text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any signed-in user can read profiles (needed to show opponents / add friends).
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- You can only insert / update your own profile row.
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. Auto-create a profile row whenever a new auth user signs up.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh on profile edits.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. SESSIONS  (one row per completed match session)
--    The full app session object lives in `data` (jsonb); the columns
--    above it are denormalised copies for fast listing / filtering.
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.profiles (id) on delete cascade,
  venue        text,
  format       text,
  scoring      jsonb,
  rating       jsonb,
  total_rounds int,
  played_on    timestamptz not null default now(),
  data         jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists sessions_created_by_idx on public.sessions (created_by);
create index if not exists sessions_played_on_idx  on public.sessions (played_on desc);

alter table public.sessions enable row level security;

-- ---------------------------------------------------------------------
-- 4. SESSION PARTICIPANTS  (who was in a session)
--    profile_id set  -> a real registered user (gets the session shared to them)
--    guest_name set  -> a typed-in name with no account (yet)
-- ---------------------------------------------------------------------
create table if not exists public.session_participants (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  guest_name text,
  created_at timestamptz not null default now()
);

create index if not exists sp_session_idx on public.session_participants (session_id);
create index if not exists sp_profile_idx on public.session_participants (profile_id);

alter table public.session_participants enable row level security;

-- ---------------------------------------------------------------------
-- 5. Membership helper (SECURITY DEFINER avoids RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_session_member(sid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from public.sessions s
            where s.id = sid and s.created_by = auth.uid())
    or
    exists (select 1 from public.session_participants p
            where p.session_id = sid and p.profile_id = auth.uid());
$$;

-- Sessions: visible to creator and to any participant; only creator writes.
drop policy if exists "sessions_select_member" on public.sessions;
create policy "sessions_select_member"
  on public.sessions for select
  using (created_by = auth.uid() or public.is_session_member(id));

drop policy if exists "sessions_insert_self" on public.sessions;
create policy "sessions_insert_self"
  on public.sessions for insert
  with check (created_by = auth.uid());

drop policy if exists "sessions_update_owner" on public.sessions;
create policy "sessions_update_owner"
  on public.sessions for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "sessions_delete_owner" on public.sessions;
create policy "sessions_delete_owner"
  on public.sessions for delete
  using (created_by = auth.uid());

-- Participants: visible to anyone who can see the session; only the
-- session creator can add participant rows.
drop policy if exists "sp_select_member" on public.session_participants;
create policy "sp_select_member"
  on public.session_participants for select
  using (public.is_session_member(session_id));

drop policy if exists "sp_insert_owner" on public.session_participants;
create policy "sp_insert_owner"
  on public.session_participants for insert
  with check (
    exists (select 1 from public.sessions s
            where s.id = session_id and s.created_by = auth.uid())
  );

drop policy if exists "sp_delete_owner" on public.session_participants;
create policy "sp_delete_owner"
  on public.session_participants for delete
  using (
    exists (select 1 from public.sessions s
            where s.id = session_id and s.created_by = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 6. FOLLOWS  (the social graph: who follows whom)
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.follows enable row level security;

drop policy if exists "follows_read_all" on public.follows;
create policy "follows_read_all"
  on public.follows for select
  using (auth.role() = 'authenticated');

drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self"
  on public.follows for insert
  with check (follower_id = auth.uid());

drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_self"
  on public.follows for delete
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7. STORAGE  (avatars bucket for profile photos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read of avatars.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Users may upload/replace files only inside a folder named after their uid,
-- e.g. path  <uid>/avatar.jpg
drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- NOTE: a normalised `matches` table (one row per game, linking real
-- player ids) will be added in the next step when we build the Glicko-2
-- rating engine. For now match detail lives inside sessions.data jsonb,
-- which is enough for the diary, rivals, and court views.
-- =====================================================================
