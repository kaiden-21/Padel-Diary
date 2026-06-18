# Padel Diary — Backend Setup (Supabase → app → Vercel)

This pairs with two files:
- `supabase-schema.sql` — your database (run once)
- `padel-supabase.js` — the data layer your React app imports

---

## STAGE 1 — Supabase (do this first)

1. **Create the project**
   - supabase.com → sign in **with GitHub** (this also creates the GitHub account you'll need for Vercel).
   - New project → name it, set a database password (save it in a password manager), region **Singapore**. Wait ~2 min.

2. **Create the tables + security**
   - Left sidebar → **SQL Editor** → New query.
   - Paste the entire contents of `supabase-schema.sql` → **Run**.
   - You should see "Success." Check **Table Editor** — you'll have `profiles`, `sessions`, `session_participants`, `follows`.

3. **Turn on logins**
   - **Authentication → Providers**.
   - Enable **Email** (works immediately).
   - Enable **Google** and **Apple** when ready (each needs a client ID/secret from that provider's console — Email is enough to start testing).

4. **Set redirect URLs**
   - **Authentication → URL Configuration**.
   - Site URL: `http://localhost:5173` for now (Vite's dev URL).
   - We'll add the live Vercel URL here in Stage 3.

5. **Copy your keys**
   - **Project Settings → API**.
   - Copy **Project URL** and the **anon public** key. You'll paste these next.

---

## STAGE 2 — Wire the app (laptop)

1. **Make it a real project.** The artifact is a single component; turn it into a Vite React app:
   ```bash
   npm create vite@latest padel-diary -- --template react
   cd padel-diary
   npm install
   npm install @supabase/supabase-js lucide-react
   ```

2. **Add your keys.** Create a file named `.env` in the project root:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   (`.env` is gitignored by default — never commit your keys.)

3. **Drop in the files.**
   - Put `padel-supabase.js` in `src/`.
   - Put the app component in `src/` too.
   - This is the part where I swap the app's `window.storage` calls for the
     functions in `padel-supabase.js` (getMyProfile, saveSession, listMySessions,
     uploadAvatar, sign-in, etc.) and add the login screen. Tell me when you're
     here and I'll do that wiring.

4. **Run it locally.**
   ```bash
   npm run dev
   ```
   Open the printed `http://localhost:5173`, sign in with email, play a match,
   confirm it appears in Supabase → Table Editor → sessions.

5. **Push to GitHub.**
   ```bash
   git init && git add -A && git commit -m "padel diary"
   ```
   Then create a repo on github.com and follow its "push an existing repo" lines.

---

## STAGE 3 — Vercel (deploy)

1. vercel.com → sign in with the same GitHub.
2. **Add New → Project** → import your padel-diary repo.
3. **Environment Variables** → add the same two:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. **Deploy.** You get a URL like `padel-diary.vercel.app`.
5. Back in Supabase → **Authentication → URL Configuration** → add that Vercel
   URL to Site URL and Redirect URLs, so logins work in production.

Done — your padel group can open the URL on their phones, sign in, and every
saved match syncs to everyone who was in it.

---

## What's deliberately NOT here yet
- **Friend-linking UI** (resolving a typed name to a real account so results
  auto-share) — the schema supports it via `session_participants.profile_id`;
  the picker is an app-side piece we build next.
- **Glicko-2 rating** — needs a normalised `matches` table; that's the next
  backend step after this is live and logging.
