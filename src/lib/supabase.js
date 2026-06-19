// =====================================================================
// PADEL DIARY — Supabase data layer
// One place for every call to the backend. The app imports from here
// instead of touching window.storage.
//
// Setup:
//   npm install @supabase/supabase-js
//   Add these to your .env (Vite):
//     VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//     VITE_SUPABASE_ANON_KEY=your-anon-public-key
//   (Next.js: use NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
//    and read them via process.env instead of import.meta.env below.)
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------

// OAuth (Google / Apple). redirectTo must be whitelisted in
// Supabase → Authentication → URL Configuration.
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export function signInWithApple() {
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin },
  });
}

// Passwordless email (magic link / OTP).
export function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

// Subscribe to login/logout. Returns an unsubscribe function.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------

export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

// Patch only the fields you pass (name, racket, side, dob, gender, etc.).
export async function updateMyProfile(fields) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Upload a profile photo (a File/Blob) to <uid>/avatar.<ext>, return public URL.
export async function uploadAvatar(file) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `${user.id}/avatar.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // cache-bust so a replaced photo refreshes immediately
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Find people to add to a match or follow.
export async function searchProfiles(query) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, photo_url')
    .ilike('name', `%${query}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------

// Save a finished session.
//   session      = the full app object { venue, format, scoring, courts,
//                  standings, rating, players, date, ... }
//   participants = array of { profileId } for registered players, or
//                  { guestName } for everyone else. Resolve this once on the
//                  caller's side — don't pass the same person both ways.
//                  The creator is added automatically; don't include them.
export async function saveSession(session, participants = []) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');

  const { data: row, error } = await supabase
    .from('sessions')
    .insert({
      created_by: user.id,
      venue: session.venue,
      format: session.format,
      scoring: session.scoring ?? null,
      rating: session.rating ?? null,
      total_rounds: session.totalRounds ?? null,
      played_on: session.date ?? new Date().toISOString(),
      data: session,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = [{ session_id: row.id, profile_id: user.id }]; // the creator
  participants.forEach((p) => {
    if (p.profileId && p.profileId !== user.id) rows.push({ session_id: row.id, profile_id: p.profileId });
    else if (p.guestName) rows.push({ session_id: row.id, guest_name: p.guestName });
  });
  if (rows.length) {
    const { error: pErr } = await supabase.from('session_participants').insert(rows);
    if (pErr) throw pErr;
  }
  return row;
}

// Every session you created OR were added to, newest first.
// Returns the original app session objects (from the jsonb `data` column).
export async function listMySessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, data, played_on')
    .order('played_on', { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ ...r.data, id: r.id }));
}

export async function deleteSession(id) {
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// FOLLOWS
// ---------------------------------------------------------------------

export async function follow(profileId) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: user.id, following_id: profileId });
  if (error) throw error;
}

export async function unfollow(profileId) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('following_id', profileId);
  if (error) throw error;
}

export async function listFollowing() {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('follows')
    .select('following_id, profiles:following_id (id, name, photo_url)')
    .eq('follower_id', user.id);
  if (error) throw error;
  return data.map((r) => r.profiles);
}

// ---------------------------------------------------------------------
// GOOGLE OAUTH
// ---------------------------------------------------------------------



// ---------------------------------------------------------------------
// LOBBIES
// ---------------------------------------------------------------------

// Create a new lobby — returns the full lobby row including the auto-generated code.
export async function createLobby(cfg) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('lobbies')
    .insert({
      host_id: user.id,
      venue: cfg.venue || null,
      venue_address: cfg.venueAddress || null,
      venue_lat: cfg.venueLat || null,
      venue_lng: cfg.venueLng || null,
      format: cfg.format || 'americano',
      scoring: cfg.scoring || null,
      total_rounds: cfg.totalRounds || 5,
      num_courts: cfg.numCourts || 1,
      status: 'open',
    })
    .select()
    .single();
  if (error) throw error;
  // Host automatically joins their own lobby.
  await supabase.from('lobby_members').insert({ lobby_id: data.id, profile_id: user.id, selected: true });
  return data;
}

// Fetch a lobby by its short join code (what's in the share link).
export async function getLobbyByCode(code) {
  const { data, error } = await supabase
    .from('lobbies')
    .select('*, host:host_id (id, name, photo_url)')
    .eq('code', code)
    .single();
  if (error) throw error;
  return data;
}

// Fetch a lobby and all its current members with their profiles.
export async function getLobbyWithMembers(lobbyId) {
  const [{ data: lobby, error: le }, { data: members, error: me }] = await Promise.all([
    supabase.from('lobbies').select('*, host:host_id (id, name, photo_url)').eq('id', lobbyId).single(),
    supabase.from('lobby_members').select('*, profile:profile_id (id, name, photo_url, racket, side, rackets_owned)').eq('lobby_id', lobbyId).order('joined_at'),
  ]);
  if (le) throw le;
  if (me) throw me;
  return { lobby, members };
}

// Join a lobby (called when a friend clicks the share link).
export async function joinLobby(lobbyId) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('lobby_members')
    .upsert({ lobby_id: lobbyId, profile_id: user.id }, { onConflict: 'lobby_id,profile_id' });
  if (error) throw error;
}

// Host toggles a member as selected (in) or deselected (out).
export async function toggleMemberSelected(memberId, selected) {
  const { error } = await supabase
    .from('lobby_members')
    .update({ selected })
    .eq('id', memberId);
  if (error) throw error;
}

// Host starts the match — marks lobby as started and returns selected members' profiles.
export async function startLobbyMatch(lobbyId) {
  const { error } = await supabase
    .from('lobbies')
    .update({ status: 'started', started_at: new Date().toISOString() })
    .eq('id', lobbyId);
  if (error) throw error;
  const { data, error: me } = await supabase
    .from('lobby_members')
    .select('profile:profile_id (id, name, photo_url, racket, side)')
    .eq('lobby_id', lobbyId)
    .eq('selected', true);
  if (me) throw me;
  return data.map((m) => m.profile);
}

// Subscribe to live updates for a lobby's member list.
// Returns an unsubscribe function.
export function subscribeLobby(lobbyId, onUpdate) {
  const channel = supabase
    .channel(`lobby:${lobbyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_members', filter: `lobby_id=eq.${lobbyId}` }, onUpdate)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` }, onUpdate)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

