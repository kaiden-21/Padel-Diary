# Padel Diary — MVP 2.0 (Supabase-backed)

This is the real, multi-user version. The scoring/pairing engine is identical
to the local build — what changed is where data lives:

| | MVP 1.1 (local) | MVP 2.0 (this) |
|---|---|---|
| Login | none, just a name | real email sign-in (Google/Apple later) |
| Profile | browser only | Supabase `profiles` table |
| Photo | base64 in browser | uploaded to Supabase Storage |
| Sessions | browser only | Supabase `sessions` + shared to friends who played |
| In-progress match | browser | **still browser** — it's a draft, not a record yet |

## Run it

```bash
npm install
cp .env.example .env        # then paste your Supabase URL + anon key into .env
npm run dev
```

Open the printed `http://localhost:5173`. Sign in with your email — you'll
get a magic link, click it, and you're in. First login asks for your bio
(DOB, gender, rackets owned); after that it's the same app you already know.

## Before this will work

You need a Supabase project with the schema applied. If you haven't done
that yet: open `supabase-schema.sql` in this folder, paste it into your
Supabase project's SQL Editor, and run it once. Full walkthrough in
`SUPABASE_SETUP.md`.

## What's still a known simplification

- **Friend linking is name-matching, not a picker.** When you finish a
  session, the app checks if any typed player name exactly matches a
  registered account and links them automatically; otherwise they're stored
  as a guest. A proper "search and select a friend" autocomplete in the
  player list is the natural next step.
- **Google/Apple login** need their own OAuth app registration (outside
  what I can set up for you) — email sign-in works today with zero extra
  setup.
- **The rating system (Glicko-2)** isn't built yet — this version's job is
  to get clean, structured, shared match data flowing, which is exactly
  what the rating engine will need to calibrate against.

## Deploying

Once this runs locally, push it to GitHub and import it into Vercel — add
the same two environment variables there, deploy, then add the live URL to
Supabase's Auth → URL Configuration so login works in production. Full
steps in `SUPABASE_SETUP.md`, Stage 3.
