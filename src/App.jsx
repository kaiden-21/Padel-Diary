import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Minus, Star, ChevronLeft, MapPin, BookOpen, Play, Camera, Check, Trophy, LogOut, Mail } from 'lucide-react';
import {
  signInWithEmail,
  signOut,
  getCurrentUser,
  onAuthChange,
  getMyProfile,
  updateMyProfile,
  uploadAvatar,
  searchProfiles,
  saveSession as saveSessionRemote,
  listMySessions,
} from './lib/supabase.js';

const COLORS = {
  ink: '#14201D',
  cream: '#F3F1E6',
  teal: '#163832',
  lime: '#D7E94E',
  glass: '#4D7C82',
  clay: '#B4432F',
};

const TAGS = ['Good lighting', 'Bouncy court', 'Slippery surface', 'Great vibe', 'Crowded', 'Windy'];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Split players into the chosen number of courts (each group >= 4). Larger groups rotate sit-outs.
function groupPlayers(players, numCourts) {
  const n = players.length;
  const maxCourts = Math.max(1, Math.floor(n / 4));
  const courts = Math.max(1, Math.min(numCourts || maxCourts, maxCourts));
  const base = Math.floor(n / courts);
  const rem = n % courts;
  const shuffled = shuffle(players);
  const groups = [];
  let idx = 0;
  for (let g = 0; g < courts; g++) {
    const size = base + (g < rem ? 1 : 0);
    groups.push(shuffled.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

function playedIn(round, name) {
  return round.teamA.includes(name) || round.teamB.includes(name);
}

function courtTotals(members, rounds) {
  const t = {};
  members.forEach((n) => (t[n] = 0));
  rounds.forEach((r) => {
    t[r.teamA[0]] += r.scoreA;
    t[r.teamA[1]] += r.scoreA;
    t[r.teamB[0]] += r.scoreB;
    t[r.teamB[1]] += r.scoreB;
  });
  return t;
}

function sitOutTally(members, priorRounds) {
  const t = {};
  members.forEach((p) => (t[p] = 0));
  priorRounds.forEach((r) => {
    members.forEach((p) => {
      if (!playedIn(r, p)) t[p] += 1;
    });
  });
  return t;
}

function chooseActive(members, priorRounds) {
  if (members.length <= 4) return [...members];
  const tally = sitOutTally(members, priorRounds);
  const ordered = shuffle(members).sort((a, b) => tally[a] - tally[b]);
  const numSit = members.length - 4;
  const sitters = new Set(ordered.slice(0, numSit));
  return members.filter((p) => !sitters.has(p));
}

function partnerTally(priorRounds) {
  const t = {};
  const bump = (x, y) => {
    t[x] = t[x] || {};
    t[x][y] = (t[x][y] || 0) + 1;
  };
  priorRounds.forEach((r) => {
    bump(r.teamA[0], r.teamA[1]);
    bump(r.teamA[1], r.teamA[0]);
    bump(r.teamB[0], r.teamB[1]);
    bump(r.teamB[1], r.teamB[0]);
  });
  return t;
}

function pairFour(format, four, priorRounds, totals) {
  if (format === 'mexicano') {
    const ranked = [...four].sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
    return { teamA: [ranked[0], ranked[3]], teamB: [ranked[1], ranked[2]] };
  }
  const pt = partnerTally(priorRounds);
  const [a, b, c, d] = four;
  const pair = (x, y) => (pt[x] && pt[x][y]) || 0;
  const options = [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ];
  options.sort(
    (o1, o2) =>
      pair(o1.teamA[0], o1.teamA[1]) + pair(o1.teamB[0], o1.teamB[1]) -
      (pair(o2.teamA[0], o2.teamA[1]) + pair(o2.teamB[0], o2.teamB[1]))
  );
  return options[0];
}

function generatePairing(format, members, priorRounds) {
  const totals = courtTotals(members, priorRounds);
  const active = chooseActive(members, priorRounds);
  return pairFour(format, active, priorRounds, totals);
}

// ---- fixed pairs ----
function pairUp(players) {
  const teams = [];
  for (let i = 0; i + 1 < players.length; i += 2) teams.push([players[i], players[i + 1]]);
  return teams;
}

// Distribute whole teams (pairs) across courts; each court gets >= 2 teams.
function groupTeams(teams, numCourts) {
  const T = teams.length;
  const maxCourts = Math.max(1, Math.floor(T / 2));
  const courts = Math.max(1, Math.min(numCourts || maxCourts, maxCourts));
  const base = Math.floor(T / courts);
  const rem = T % courts;
  const shuffled = shuffle(teams);
  const groups = [];
  let idx = 0;
  for (let g = 0; g < courts; g++) {
    const size = base + (g < rem ? 1 : 0);
    const gt = shuffled.slice(idx, idx + size);
    idx += size;
    groups.push({ players: gt.flat(), rounds: [], teams: gt });
  }
  return groups;
}

function teamKey(t) {
  return t[0] + '|' + t[1];
}

// Pick the two teams in a court that have sat out most, so opponents rotate fairly.
function generateFixedPairing(teams, priorRounds) {
  if (teams.length <= 2) return { teamA: teams[0], teamB: teams[1] };
  const tally = {};
  teams.forEach((t) => (tally[teamKey(t)] = 0));
  priorRounds.forEach((r) => {
    teams.forEach((t) => {
      const played =
        (r.teamA.includes(t[0]) && r.teamA.includes(t[1])) ||
        (r.teamB.includes(t[0]) && r.teamB.includes(t[1]));
      if (!played) tally[teamKey(t)] += 1;
    });
  });
  const ordered = shuffle(teams).sort((a, b) => tally[teamKey(b)] - tally[teamKey(a)]);
  return { teamA: ordered[0], teamB: ordered[1] };
}

function pairingFor(format, court, priorRounds) {
  if (format === 'fixed') return generateFixedPairing(court.teams, priorRounds);
  return generatePairing(format, court.players, priorRounds);
}

// Pre-compute every round's matchup for a court, for formats whose pairing
// doesn't depend on scores (americano, fixed). Lets the UI show the whole
// session as a list instead of one round at a time, and lets any single
// match be skipped/postponed without blocking the rest.
function generateFullSchedule(format, court, totalRounds) {
  const synthetic = []; // {teamA, teamB} only — enough for partner/sit-out tally
  const schedule = [];
  for (let round = 1; round <= totalRounds; round++) {
    const pairing = pairingFor(format, court, synthetic);
    synthetic.push(pairing);
    schedule.push({ round, teamA: pairing.teamA, teamB: pairing.teamB, status: 'pending', scoreA: null, scoreB: null });
  }
  return schedule;
}

function isPrescheduled(format) {
  return format === 'americano' || format === 'fixed';
}

function computeStandings(courts) {
  const rows = [];
  courts.forEach((c) => {
    const totals = courtTotals(c.players, c.rounds);
    c.players.forEach((p) => rows.push({ name: p, total: totals[p] || 0 }));
  });
  rows.sort((a, b) => b.total - a.total);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Supabase's `profiles` row is snake_case; the rest of this app (built for the
// local version) expects camelCase. Keep that translation in one place.
function mapProfileFromRow(row) {
  if (!row) return { name: 'Player', photo: null, racket: '', side: 'Right', dob: '', gender: '', racketsOwned: '' };
  return {
    name: row.name || 'Player',
    photo: row.photo_url || null,
    racket: row.racket || '',
    side: row.side || 'Right',
    dob: row.dob || '',
    gender: row.gender || '',
    racketsOwned: row.rackets_owned || '',
  };
}

// Same resize logic, resolves an uploadable File (for Supabase storage).
function fileToResizedFile(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Could not process image')); return; }
            resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- shared UI ----------
function Avatar({ photo, name, size = 44 }) {
  if (photo) {
    return <img src={photo} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div
      className="font-display flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: '50%', backgroundColor: COLORS.teal, color: COLORS.lime }}
    >
      <span style={{ fontSize: size * 0.42 }}>{(name || '?').charAt(0).toUpperCase()}</span>
    </div>
  );
}

function StarRow({ value, onChange, size = 22 }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange && onChange(n)} className="p-0.5" aria-label={`${n} star`}>
          <Star size={size} color={COLORS.teal} fill={n <= value ? COLORS.lime : 'none'} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

function TagChips({ selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TAGS.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            className="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"
            style={{ backgroundColor: active ? COLORS.teal : 'transparent', color: active ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

function SessionTicket({ session, youName, onClick }) {
  const yourCourt = session.courts.find((c) => c.players.includes(youName));
  const yourEntry = session.standings.find((s) => s.name === youName);
  const others = yourCourt ? yourCourt.players.filter((p) => p !== youName) : [];
  const pips = yourCourt
    ? yourCourt.rounds.filter((r) => playedIn(r, youName)).map((r) => {
        const a = r.teamA.includes(youName);
        return (a ? r.scoreA : r.scoreB) > (a ? r.scoreB : r.scoreA);
      })
    : [];

  return (
    <button onClick={onClick} className="w-full flex text-left rounded-2xl overflow-hidden shadow-sm mb-4" style={{ backgroundColor: '#fff' }}>
      <div className="flex-1 p-4 min-w-0">
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="font-display text-lg tracking-wide truncate" style={{ color: COLORS.teal }}>{session.venue}</span>
          <span className="font-mono text-xs whitespace-nowrap" style={{ color: COLORS.glass }}>{fmtDate(session.date)}</span>
        </div>
        <div className="font-mono text-xs uppercase mb-2" style={{ color: COLORS.glass }}>
          {session.format} &middot; {yourCourt ? yourCourt.rounds.length : 0} rounds
        </div>
        {others.length > 0 && <div className="text-sm mb-2 truncate" style={{ color: COLORS.ink }}>with {others.join(', ')}</div>}
        <div className="flex gap-1 flex-wrap">
          {pips.map((win, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: win ? COLORS.lime : COLORS.clay }} />
          ))}
        </div>
      </div>
      <div className="stub w-20 flex-shrink-0 flex flex-col items-center justify-center" style={{ backgroundColor: COLORS.teal }}>
        <span className="font-display text-2xl" style={{ color: COLORS.lime }}>#{yourEntry ? yourEntry.rank : '-'}</span>
        <span className="font-mono text-[10px]" style={{ color: COLORS.cream }}>{yourEntry ? yourEntry.total : 0} PTS</span>
      </div>
    </button>
  );
}

// ---------- new match setup ----------
function NewSessionSetup({ youName, profile, sessions, hasActive, onStart, onCancel }) {
  const knownVenues = useMemo(() => [...new Set(sessions.map((s) => s.venue))], [sessions]);
  const knownPlayers = useMemo(() => {
    const set = new Set();
    sessions.forEach((s) => s.players.forEach((p) => { if (p !== youName) set.add(p); }));
    return [...set];
  }, [sessions, youName]);

  const [venue, setVenue] = useState('');
  const [format, setFormat] = useState('americano');
  const [count, setCount] = useState(4);
  const [names, setNames] = useState(['', '', '']);
  const [numCourts, setNumCourts] = useState(1);
  const [rounds, setRounds] = useState(5);
  const [scoreMode, setScoreMode] = useState('points');
  const [pointsTarget, setPointsTarget] = useState(21);
  const [tennisTarget, setTennisTarget] = useState(6);
  const [racket, setRacket] = useState(profile.racket || '');
  const [side, setSide] = useState(profile.side || 'Right');
  const [error, setError] = useState('');

  const maxCourts = Math.max(1, Math.floor(count / 4));

  useEffect(() => {
    setNames((prev) => {
      const next = Array(Math.max(0, count - 1)).fill('');
      for (let i = 0; i < next.length && i < prev.length; i++) next[i] = prev[i];
      return next;
    });
  }, [count]);

  useEffect(() => {
    setNumCourts((c) => Math.max(1, Math.min(c, maxCourts)));
  }, [maxCourts]);

  function updateName(i, val) {
    setNames((prev) => prev.map((n, idx) => (idx === i ? val : n)));
  }

  function handleStart() {
    const trimmed = names.map((n) => n.trim());
    if (!venue.trim()) { setError('Add a venue name.'); return; }
    if (trimmed.some((n) => !n)) { setError('Fill in every player name.'); return; }
    const all = [youName, ...trimmed];
    if (all.length < 4) { setError('You need at least 4 players.'); return; }
    if (new Set(all).size !== all.length) { setError('Player names must be unique.'); return; }
    if (format === 'fixed' && all.length % 2 !== 0) { setError('Fixed pairs needs an even number of players.'); return; }
    const scoring = scoreMode === 'points' ? { mode: 'points', target: pointsTarget } : { mode: 'tennis', target: tennisTarget };
    onStart({ venue: venue.trim(), format, totalRounds: rounds, numCourts, scoring, players: all, gear: { racket: racket.trim(), side } });
  }

  const sitsOut = count - numCourts * 4 > 0 || count % 4 !== 0;
  const perRoundSit = Math.max(0, count - numCourts * 4);

  return (
    <div className="px-5 pt-6 pb-28">
      <button onClick={onCancel} className="flex items-center gap-1 text-sm mb-4" style={{ color: COLORS.glass }}>
        <ChevronLeft size={18} /> Back
      </button>
      <h2 className="font-display text-2xl tracking-wide mb-1" style={{ color: COLORS.teal }}>NEW MATCH</h2>
      {hasActive && <p className="text-xs mb-4" style={{ color: COLORS.clay }}>Starting a new match will replace the one in progress.</p>}
      {!hasActive && <div className="mb-4" />}

      <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.glass }}>Venue</label>
      <input list="venues" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Padel Garage Senayan" className="w-full px-3 py-2.5 rounded-lg border mb-4 text-sm" style={{ borderColor: COLORS.glass }} />
      <datalist id="venues">{knownVenues.map((v) => <option key={v} value={v} />)}</datalist>

      <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.glass }}>Format</label>
      <div className="flex gap-2 mb-2">
        {[{ k: 'americano', label: 'Americano' }, { k: 'mexicano', label: 'Mexicano' }, { k: 'fixed', label: 'Fixed pairs' }].map((f) => (
          <button key={f.k} onClick={() => setFormat(f.k)} className="flex-1 py-2.5 rounded-lg text-xs font-medium border" style={{ backgroundColor: format === f.k ? COLORS.teal : 'transparent', color: format === f.k ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="text-xs mb-4" style={{ color: COLORS.glass }}>
        {format === 'americano' && 'Partners rotate every round so you play with everyone.'}
        {format === 'mexicano' && 'Pairings shift by standings each round.'}
        {format === 'fixed' && 'You keep the same partner all session; opponents rotate.'}
      </p>

      <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.glass }}>Players</label>
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setCount((c) => Math.max(4, c - 1))} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ borderColor: COLORS.teal, color: COLORS.teal }} aria-label="Remove player"><Minus size={18} /></button>
        <div className="flex-1 text-center"><span className="font-display text-3xl" style={{ color: COLORS.teal }}>{count}</span><span className="text-sm ml-1" style={{ color: COLORS.glass }}>players</span></div>
        <button onClick={() => setCount((c) => Math.min(24, c + 1))} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ borderColor: COLORS.teal, color: COLORS.teal }} aria-label="Add player"><Plus size={18} /></button>
      </div>

      <label className="block text-xs font-mono uppercase mb-1 mt-3" style={{ color: COLORS.glass }}>Courts available</label>
      <div className="flex gap-2 mb-1">
        {Array.from({ length: maxCourts }, (_, i) => i + 1).map((c) => (
          <button key={c} onClick={() => setNumCourts(c)} className="flex-1 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: numCourts === c ? COLORS.teal : 'transparent', color: numCourts === c ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>
            {c}
          </button>
        ))}
      </div>
      <p className="text-xs mb-4" style={{ color: COLORS.glass }}>
        {numCourts} court{numCourts > 1 ? 's' : ''} &middot; {perRoundSit > 0 ? `${perRoundSit} player${perRoundSit > 1 ? 's' : ''} rotate sit-outs each round.` : 'everyone plays every round.'}
      </p>

      <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.glass }}>Player names</label>
      <div className="mb-2 px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: '#fff', color: COLORS.ink }}>
        <Avatar photo={profile.photo} name={youName} size={24} /> {youName} (you)
      </div>
      {names.map((n, i) => (
        <input key={i} list="players" value={n} onChange={(e) => updateName(i, e.target.value)} placeholder={`Player ${i + 2} name`} className="w-full px-3 py-2.5 rounded-lg border mb-2 text-sm" style={{ borderColor: COLORS.glass }} />
      ))}
      <datalist id="players">{knownPlayers.map((p) => <option key={p} value={p} />)}</datalist>

      {format === 'fixed' && (
        <div className="rounded-2xl p-3 mb-2" style={{ backgroundColor: '#EDF0DD' }}>
          <div className="font-mono text-xs uppercase mb-2" style={{ color: COLORS.glass }}>Teams (paired in order)</div>
          {(() => {
            const all = [youName, ...names.map((n) => n.trim() || '…')];
            const rows = [];
            for (let i = 0; i + 1 < all.length; i += 2) rows.push([all[i], all[i + 1]]);
            const leftover = all.length % 2 !== 0;
            return (
              <>
                {rows.map((t, i) => (
                  <div key={i} className="text-sm" style={{ color: COLORS.ink }}>Team {i + 1}: {t[0]} &amp; {t[1]}</div>
                ))}
                {leftover && <div className="text-xs mt-1" style={{ color: COLORS.clay }}>Add one more player to complete the pairs.</div>}
              </>
            );
          })()}
        </div>
      )}

      <label className="block text-xs font-mono uppercase mb-1 mt-3" style={{ color: COLORS.glass }}>Rounds</label>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setRounds((r) => Math.max(1, r - 1))} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ borderColor: COLORS.teal, color: COLORS.teal }} aria-label="Fewer rounds"><Minus size={18} /></button>
        <div className="flex-1 text-center"><span className="font-display text-3xl" style={{ color: COLORS.teal }}>{rounds}</span><span className="text-sm ml-1" style={{ color: COLORS.glass }}>rounds</span></div>
        <button onClick={() => setRounds((r) => Math.min(10, r + 1))} className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ borderColor: COLORS.teal, color: COLORS.teal }} aria-label="More rounds"><Plus size={18} /></button>
      </div>

      <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.glass }}>Scoring</label>
      <div className="flex gap-2 mb-2">
        {[{ key: 'points', label: 'Points' }, { key: 'tennis', label: 'Tennis' }].map((m) => (
          <button key={m.key} onClick={() => setScoreMode(m.key)} className="flex-1 py-2.5 rounded-lg text-sm font-medium border" style={{ backgroundColor: scoreMode === m.key ? COLORS.teal : 'transparent', color: scoreMode === m.key ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>
            {m.label}
          </button>
        ))}
      </div>
      {scoreMode === 'points' ? (
        <>
          <div className="flex gap-2 mb-1">
            {[16, 21, 32].map((p) => (
              <button key={p} onClick={() => setPointsTarget(p)} className="flex-1 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: pointsTarget === p ? COLORS.lime : 'transparent', color: COLORS.teal, borderColor: pointsTarget === p ? COLORS.lime : COLORS.glass }}>{p} pts</button>
            ))}
          </div>
          <p className="text-xs mb-4" style={{ color: COLORS.glass }}>Each game is played to {pointsTarget} total points, split between the teams.</p>
        </>
      ) : (
        <>
          <div className="flex gap-2 mb-1">
            {[4, 6, 9].map((p) => (
              <button key={p} onClick={() => setTennisTarget(p)} className="flex-1 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: tennisTarget === p ? COLORS.lime : 'transparent', color: COLORS.teal, borderColor: tennisTarget === p ? COLORS.lime : COLORS.glass }}>First to {p}</button>
            ))}
          </div>
          <p className="text-xs mb-4" style={{ color: COLORS.glass }}>First team to win {tennisTarget} games takes the match.</p>
        </>
      )}

      <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: '#fff' }}>
        <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Your gear today</label>
        <input value={racket} onChange={(e) => setRacket(e.target.value)} placeholder="Racket (e.g. Bullpadel Vertex)" className="w-full px-3 py-2.5 rounded-lg border mb-3 text-sm" style={{ borderColor: COLORS.glass }} />
        <div className="flex gap-2">
          {['Left', 'Right'].map((s) => (
            <button key={s} onClick={() => setSide(s)} className="flex-1 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: side === s ? COLORS.teal : 'transparent', color: side === s ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>{s} side</button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm mb-3" style={{ color: COLORS.clay }}>{error}</p>}
      <button onClick={handleStart} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>START MATCH</button>
    </div>
  );
}

// ---------- live tab ----------
function LiveTab({ active, onCommitRound, onScoreMatch, onSkipMatch, onFinish, onSaveSession, onDiscard, onGoNew }) {
  if (!active) {
    return (
      <div className="px-5 pt-6 pb-28">
        <h1 className="font-display text-3xl tracking-wide mb-1" style={{ color: COLORS.teal }}>LIVE</h1>
        <p className="text-sm mb-6" style={{ color: COLORS.glass }}>No match in progress.</p>
        <div className="text-center py-16 px-6 rounded-2xl" style={{ backgroundColor: '#fff' }}>
          <Play size={32} color={COLORS.glass} className="mx-auto mb-3" />
          <p className="text-sm mb-5" style={{ color: COLORS.glass }}>Start a match and the live scoreboard shows up here.</p>
          <button onClick={onGoNew} className="px-5 py-2.5 rounded-xl font-display tracking-wide" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>NEW MATCH</button>
        </div>
      </div>
    );
  }
  if (active.phase === 'summary') return <SummaryView active={active} onSave={onSaveSession} onDiscard={onDiscard} />;
  if (isPrescheduled(active.format)) {
    return <ScheduleView active={active} onScoreMatch={onScoreMatch} onSkipMatch={onSkipMatch} onFinish={onFinish} onDiscard={onDiscard} />;
  }
  return <ScoringView active={active} onCommitRound={onCommitRound} onDiscard={onDiscard} />;
}

function ScoringView({ active, onCommitRound, onDiscard }) {
  const { courts, pairings, roundIndex, totalRounds, scoring, venue } = active;
  const [inputs, setInputs] = useState(courts.map(() => ({ a: '', b: '' })));

  useEffect(() => {
    setInputs(courts.map(() => ({ a: '', b: '' })));
  }, [roundIndex, courts.length]);

  const sitting = courts.map((c, idx) => c.players.filter((p) => !pairings[idx].teamA.includes(p) && !pairings[idx].teamB.includes(p)));
  const standings = computeStandings(courts);

  function adjust(idx, side, delta) {
    setInputs((prev) => {
      const next = [...prev];
      let v = Math.max(0, Number(next[idx][side] || 0) + delta);
      if (scoring.mode === 'points') v = Math.min(scoring.target, v);
      const entry = { ...next[idx], [side]: String(v) };
      if (scoring.mode === 'points') entry[side === 'a' ? 'b' : 'a'] = String(scoring.target - v);
      next[idx] = entry;
      return next;
    });
  }
  function setVal(idx, side, val) {
    const clean = val.replace(/[^0-9]/g, '');
    setInputs((prev) => {
      const next = [...prev];
      const entry = { ...next[idx], [side]: clean };
      if (scoring.mode === 'points' && clean !== '') {
        const v = Math.max(0, Math.min(scoring.target, Number(clean)));
        entry[side] = String(v);
        entry[side === 'a' ? 'b' : 'a'] = String(scoring.target - v);
      }
      next[idx] = entry;
      return next;
    });
  }

  const allFilled = inputs.every((i) => i.a !== '' && i.b !== '');
  const last = roundIndex + 1 >= totalRounds;

  return (
    <div className="px-5 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onDiscard} className="flex items-center gap-1 text-sm" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Exit</button>
        <span className="font-mono text-xs uppercase truncate ml-2" style={{ color: COLORS.glass }}>{venue}</span>
      </div>
      <div className="text-center mb-6">
        <div className="inline-block px-4 py-2 rounded-full font-mono text-sm" style={{ backgroundColor: COLORS.teal, color: COLORS.lime }}>ROUND {roundIndex + 1} / {totalRounds}</div>
      </div>

      {courts.map((c, idx) => (
        <div key={idx} className="rounded-2xl p-4 mb-4" style={{ backgroundColor: COLORS.teal }}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-xs" style={{ color: COLORS.lime }}>{courts.length > 1 ? `COURT ${idx + 1}` : 'MATCH'}</div>
            <div className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: COLORS.glass, color: COLORS.cream }}>{scoring.mode === 'points' ? `TO ${scoring.target} PTS` : `FIRST TO ${scoring.target}`}</div>
          </div>
          <div className="flex items-center justify-between gap-3">
            {['a', 'b'].map((side, sIdx) => (
              <React.Fragment key={side}>
                {sIdx === 1 && <div className="font-display text-sm" style={{ color: COLORS.glass }}>VS</div>}
                <div className="flex-1 text-center min-w-0">
                  <div className="text-sm mb-2 truncate" style={{ color: COLORS.cream }}>{(side === 'a' ? pairings[idx].teamA : pairings[idx].teamB).join(' & ')}</div>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => adjust(idx, side, -1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: COLORS.glass }}><Minus size={14} color="#fff" /></button>
                    <input value={inputs[idx][side]} onChange={(e) => setVal(idx, side, e.target.value)} inputMode="numeric" className="w-12 text-center font-display text-2xl bg-transparent border-b-2" style={{ color: COLORS.lime, borderColor: COLORS.lime }} />
                    <button onClick={() => adjust(idx, side, 1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: COLORS.glass }}><Plus size={14} color="#fff" /></button>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
          {sitting[idx].length > 0 && (
            <div className="font-mono text-[11px] mt-3 pt-2" style={{ color: COLORS.cream, borderTop: '1px dashed ' + COLORS.glass }}>Sitting out: {sitting[idx].join(', ')}</div>
          )}
        </div>
      ))}

      <button onClick={() => onCommitRound(inputs.map((i) => ({ a: Number(i.a), b: Number(i.b) })))} disabled={!allFilled} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide disabled:opacity-40 mb-6" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>
        {last ? 'FINISH MATCH' : 'NEXT ROUND'}
      </button>

      <div className="font-mono text-xs uppercase mb-2" style={{ color: COLORS.glass }}>Standings</div>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#fff' }}>
        {standings.map((r) => (
          <div key={r.name} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #eee' }}>
            <span className="text-sm" style={{ color: COLORS.ink }}><span className="font-mono mr-2" style={{ color: COLORS.glass }}>{r.rank}</span>{r.name}</span>
            <span className="font-mono text-sm" style={{ color: COLORS.glass }}>{r.total} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchRow({ match, scoring, courtLabel, onScore, onSkip }) {
  const [a, setA] = useState(match.scoreA != null ? String(match.scoreA) : '');
  const [b, setB] = useState(match.scoreB != null ? String(match.scoreB) : '');
  const [editing, setEditing] = useState(match.status !== 'completed');

  function adjust(side, delta) {
    const setOther = side === 'a' ? setB : setA;
    const cur = Number((side === 'a' ? a : b) || 0);
    let v = Math.max(0, cur + delta);
    if (scoring.mode === 'points') v = Math.min(scoring.target, v);
    (side === 'a' ? setA : setB)(String(v));
    if (scoring.mode === 'points') setOther(String(scoring.target - v));
  }
  function setVal(side, val) {
    const clean = val.replace(/[^0-9]/g, '');
    (side === 'a' ? setA : setB)(clean);
    if (scoring.mode === 'points' && clean !== '') {
      const v = Math.max(0, Math.min(scoring.target, Number(clean)));
      (side === 'a' ? setA : setB)(String(v));
      (side === 'a' ? setB : setA)(String(scoring.target - v));
    }
  }

  const filled = a !== '' && b !== '';
  const statusTag =
    match.status === 'completed' ? null : match.status === 'skipped' ? 'SKIPPED' : 'PENDING';

  if (!editing) {
    return (
      <div className="rounded-2xl p-4 mb-3" style={{ backgroundColor: '#fff' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs" style={{ color: COLORS.glass }}>ROUND {match.round} &middot; {courtLabel}</span>
          <button onClick={() => setEditing(true)} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: COLORS.cream, color: COLORS.teal }}>EDIT</button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate" style={{ color: match.scoreA > match.scoreB ? COLORS.teal : COLORS.ink, fontWeight: match.scoreA > match.scoreB ? 600 : 400 }}>{match.teamA.join(' & ')}</span>
          <span className="font-mono text-sm whitespace-nowrap" style={{ color: COLORS.glass }}>{match.scoreA} &ndash; {match.scoreB}</span>
          <span className="text-sm text-right truncate" style={{ color: match.scoreB > match.scoreA ? COLORS.teal : COLORS.ink, fontWeight: match.scoreB > match.scoreA ? 600 : 400 }}>{match.teamB.join(' & ')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 mb-3" style={{ backgroundColor: COLORS.teal }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs" style={{ color: COLORS.lime }}>ROUND {match.round} &middot; {courtLabel}</span>
        {statusTag && (
          <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: match.status === 'skipped' ? COLORS.clay : COLORS.glass, color: '#fff' }}>{statusTag}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        {['a', 'b'].map((side, sIdx) => (
          <React.Fragment key={side}>
            {sIdx === 1 && <div className="font-display text-sm" style={{ color: COLORS.glass }}>VS</div>}
            <div className="flex-1 text-center min-w-0">
              <div className="text-sm mb-2 truncate" style={{ color: COLORS.cream }}>{(side === 'a' ? match.teamA : match.teamB).join(' & ')}</div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => adjust(side, -1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: COLORS.glass }}><Minus size={14} color="#fff" /></button>
                <input value={side === 'a' ? a : b} onChange={(e) => setVal(side, e.target.value)} inputMode="numeric" className="w-12 text-center font-display text-2xl bg-transparent border-b-2" style={{ color: COLORS.lime, borderColor: COLORS.lime }} />
                <button onClick={() => adjust(side, 1)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: COLORS.glass }}><Plus size={14} color="#fff" /></button>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        {match.status !== 'skipped' && (
          <button onClick={onSkip} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: 'transparent', color: COLORS.cream, border: '1px solid ' + COLORS.glass }}>Skip for now</button>
        )}
        <button
          onClick={() => { onScore(Number(a), Number(b)); setEditing(false); }}
          disabled={!filled}
          className="flex-1 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}
        >
          {match.status === 'skipped' ? 'Play now' : 'Save score'}
        </button>
      </div>
    </div>
  );
}

function ScheduleView({ active, onScoreMatch, onSkipMatch, onFinish, onDiscard }) {
  const { courts, scoring, venue, totalRounds } = active;

  const flatStandings = useMemo(() => {
    const totals = {};
    courts.forEach((c) => c.players.forEach((p) => (totals[p] = 0)));
    courts.forEach((c) =>
      c.schedule.forEach((m) => {
        if (m.status !== 'completed') return;
        m.teamA.forEach((p) => (totals[p] += m.scoreA));
        m.teamB.forEach((p) => (totals[p] += m.scoreB));
      })
    );
    return Object.entries(totals)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [courts]);

  const totalMatches = courts.reduce((sum, c) => sum + c.schedule.length, 0);
  const doneMatches = courts.reduce((sum, c) => sum + c.schedule.filter((m) => m.status === 'completed').length, 0);

  // Flatten into one list, sorted by round then court, so it reads like a schedule.
  const rows = [];
  courts.forEach((c, courtIdx) => {
    c.schedule.forEach((m) => rows.push({ ...m, courtIdx }));
  });
  rows.sort((x, y) => x.round - y.round || x.courtIdx - y.courtIdx);

  return (
    <div className="px-5 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onDiscard} className="flex items-center gap-1 text-sm" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Exit</button>
        <span className="font-mono text-xs uppercase truncate ml-2" style={{ color: COLORS.glass }}>{venue}</span>
      </div>
      <div className="text-center mb-2">
        <div className="inline-block px-4 py-2 rounded-full font-mono text-sm" style={{ backgroundColor: COLORS.teal, color: COLORS.lime }}>{doneMatches} / {totalMatches} MATCHES PLAYED</div>
      </div>
      <p className="text-xs text-center mb-5" style={{ color: COLORS.glass }}>
        {totalRounds} rounds &middot; tap "Skip for now" if someone's away, then come back to it any time.
      </p>

      {rows.map((m) => (
        <MatchRow
          key={`${m.courtIdx}-${m.round}`}
          match={m}
          scoring={scoring}
          courtLabel={courts.length > 1 ? `COURT ${m.courtIdx + 1}` : 'MATCH'}
          onScore={(scoreA, scoreB) => onScoreMatch(m.courtIdx, m.round, scoreA, scoreB)}
          onSkip={() => onSkipMatch(m.courtIdx, m.round)}
        />
      ))}

      <button onClick={onFinish} disabled={doneMatches === 0} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide disabled:opacity-40 mb-6 mt-2" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>
        FINISH SESSION
      </button>

      <div className="font-mono text-xs uppercase mb-2" style={{ color: COLORS.glass }}>Standings so far</div>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#fff' }}>
        {flatStandings.map((r) => (
          <div key={r.name} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #eee' }}>
            <span className="text-sm" style={{ color: COLORS.ink }}><span className="font-mono mr-2" style={{ color: COLORS.glass }}>{r.rank}</span>{r.name}</span>
            <span className="font-mono text-sm" style={{ color: COLORS.glass }}>{r.total} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryView({ active, onSave, onDiscard }) {
  const standings = useMemo(() => computeStandings(active.courts), [active.courts]);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState([]);
  const toggleTag = (t) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className="px-5 pt-6 pb-28">
      <h2 className="font-display text-2xl tracking-wide mb-1" style={{ color: COLORS.teal }}>MATCH COMPLETE</h2>
      <p className="text-sm mb-5" style={{ color: COLORS.glass }}>{active.venue}</p>

      <div className="rounded-2xl mb-6 overflow-hidden" style={{ backgroundColor: '#fff' }}>
        {standings.map((r) => (
          <div key={r.name} className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: r.name === active.youName ? '#EDF0DD' : 'transparent', borderBottom: '1px solid #eee' }}>
            <div className="flex items-center gap-3"><span className="font-display text-lg w-6" style={{ color: COLORS.teal }}>{r.rank === 1 ? '🏆' : `#${r.rank}`}</span><span className="text-sm font-medium" style={{ color: COLORS.ink }}>{r.name}{r.name === active.youName ? ' (you)' : ''}</span></div>
            <span className="font-mono text-sm" style={{ color: COLORS.glass }}>{r.total} pts</span>
          </div>
        ))}
      </div>

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Rate {active.venue}</label>
      <div className="mb-4"><StarRow value={stars} onChange={setStars} size={28} /></div>
      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Quick tags</label>
      <div className="mb-6"><TagChips selected={tags} onToggle={toggleTag} /></div>

      <button onClick={() => onSave({ stars, tags })} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide mb-3 flex items-center justify-center gap-2" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}><Trophy size={18} /> SAVE TO DIARY</button>
      <button onClick={onDiscard} className="w-full py-2 text-sm" style={{ color: COLORS.glass }}>Discard match</button>
    </div>
  );
}

// ---------- rivals + courts maps ----------
function buildRivalMap(sessions, youName) {
  const map = {};
  sessions.forEach((s) => {
    const yc = s.courts.find((c) => c.players.includes(youName));
    if (!yc) return;
    yc.rounds.forEach((r) => {
      if (!playedIn(r, youName)) return;
      const isA = r.teamA.includes(youName);
      const yourTeam = isA ? r.teamA : r.teamB;
      const otherTeam = isA ? r.teamB : r.teamA;
      const ys = isA ? r.scoreA : r.scoreB;
      const os = isA ? r.scoreB : r.scoreA;
      const partner = yourTeam.find((p) => p !== youName);
      if (partner) {
        map[partner] = map[partner] || { partnerRounds: 0, partnerWins: 0, oppRounds: 0, oppWins: 0 };
        map[partner].partnerRounds++;
        if (ys > os) map[partner].partnerWins++;
      }
      otherTeam.forEach((opp) => {
        map[opp] = map[opp] || { partnerRounds: 0, partnerWins: 0, oppRounds: 0, oppWins: 0 };
        map[opp].oppRounds++;
        if (ys > os) map[opp].oppWins++;
      });
    });
  });
  return map;
}

function buildCourtMap(sessions) {
  const map = {};
  sessions.forEach((s) => {
    map[s.venue] = map[s.venue] || { visits: 0, starsSum: 0, lastDate: s.date };
    map[s.venue].visits++;
    map[s.venue].starsSum += s.rating.stars;
    if (new Date(s.date) > new Date(map[s.venue].lastDate)) map[s.venue].lastDate = s.date;
  });
  return map;
}

// ---------- detail screens ----------
function SessionDetail({ session, youName, onBack }) {
  return (
    <div className="px-5 pt-2 pb-28">
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-4" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Back</button>
      <h2 className="font-display text-2xl tracking-wide" style={{ color: COLORS.teal }}>{session.venue}</h2>
      <p className="font-mono text-xs mb-5" style={{ color: COLORS.glass }}>{fmtDate(session.date)} &middot; {session.format}{session.scoring ? ` \u00b7 ${session.scoring.mode === 'points' ? `to ${session.scoring.target} pts` : `first to ${session.scoring.target}`}` : ''}</p>

      {session.courts.map((c, idx) => (
        <div key={idx} className="mb-5">
          {session.courts.length > 1 && <div className="font-mono text-xs mb-2" style={{ color: COLORS.glass }}>COURT {idx + 1}</div>}
          {c.rounds.map((r, ri) => (
            <div key={ri} className="flex items-center justify-between px-3 py-2 rounded-lg mb-1.5 gap-2" style={{ backgroundColor: '#fff' }}>
              <span className="text-sm truncate" style={{ color: r.scoreA > r.scoreB ? COLORS.teal : COLORS.ink }}>{r.teamA.join(' & ')}</span>
              <span className="font-mono text-sm whitespace-nowrap" style={{ color: COLORS.glass }}>{r.scoreA} &ndash; {r.scoreB}</span>
              <span className="text-sm text-right truncate" style={{ color: r.scoreB > r.scoreA ? COLORS.teal : COLORS.ink }}>{r.teamB.join(' & ')}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="rounded-2xl mb-5 overflow-hidden" style={{ backgroundColor: '#fff' }}>
        {session.standings.map((r) => (
          <div key={r.name} className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: r.name === youName ? '#EDF0DD' : 'transparent', borderBottom: '1px solid #eee' }}>
            <span className="text-sm font-medium" style={{ color: COLORS.ink }}>#{r.rank} {r.name}</span>
            <span className="font-mono text-sm" style={{ color: COLORS.glass }}>{r.total} pts</span>
          </div>
        ))}
      </div>

      <div className="mb-2"><StarRow value={session.rating.stars} /></div>
      <div className="flex flex-wrap gap-2">
        {session.rating.tags.map((t) => <span key={t} className="px-3 py-1 rounded-full text-xs" style={{ backgroundColor: COLORS.teal, color: COLORS.cream }}>{t}</span>)}
      </div>
    </div>
  );
}

function RivalDetail({ name, sessions, youName, onBack, onOpenSession }) {
  const map = useMemo(() => buildRivalMap(sessions, youName), [sessions, youName]);
  const stats = map[name] || { partnerRounds: 0, partnerWins: 0, oppRounds: 0, oppWins: 0 };
  const related = sessions.filter((s) => s.courts.some((c) => c.players.includes(name) && c.players.includes(youName))).sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="px-5 pt-2 pb-28">
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-4" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Back</button>
      <div className="flex items-center gap-3 mb-5"><Avatar name={name} size={56} /><h2 className="font-display text-2xl tracking-wide" style={{ color: COLORS.teal }}>{name}</h2></div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#fff' }}>
          <div className="font-mono text-xs mb-1" style={{ color: COLORS.glass }}>AS PARTNERS</div>
          <div className="font-display text-2xl" style={{ color: COLORS.teal }}>{stats.partnerRounds} rounds</div>
          <div className="text-xs" style={{ color: COLORS.glass }}>{stats.partnerRounds ? Math.round((stats.partnerWins / stats.partnerRounds) * 100) : 0}% won together</div>
        </div>
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#fff' }}>
          <div className="font-mono text-xs mb-1" style={{ color: COLORS.glass }}>AS OPPONENTS</div>
          <div className="font-display text-2xl" style={{ color: COLORS.teal }}>{stats.oppWins}-{stats.oppRounds - stats.oppWins}</div>
          <div className="text-xs" style={{ color: COLORS.glass }}>your record vs them</div>
        </div>
      </div>
      <div className="font-mono text-xs uppercase mb-2" style={{ color: COLORS.glass }}>Shared sessions</div>
      {related.map((s) => <SessionTicket key={s.id} session={s} youName={youName} onClick={() => onOpenSession(s.id)} />)}
    </div>
  );
}

function CourtDetail({ venue, sessions, youName, onBack, onOpenSession }) {
  const related = sessions.filter((s) => s.venue === venue).sort((a, b) => new Date(b.date) - new Date(a.date));
  const avg = related.reduce((sum, s) => sum + s.rating.stars, 0) / (related.length || 1);
  return (
    <div className="px-5 pt-2 pb-28">
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-4" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Back</button>
      <h2 className="font-display text-2xl tracking-wide" style={{ color: COLORS.teal }}>{venue}</h2>
      <div className="flex items-center gap-1 mb-5"><Star size={16} fill={COLORS.lime} color={COLORS.teal} /><span className="font-mono text-sm" style={{ color: COLORS.teal }}>{avg.toFixed(1)} average &middot; {related.length} visit{related.length > 1 ? 's' : ''}</span></div>
      {related.map((s) => <SessionTicket key={s.id} session={s} youName={youName} onClick={() => onOpenSession(s.id)} />)}
    </div>
  );
}

// ---------- profile ----------
function ProfileEditor({ youName, profile, onSave, onBack, onSignOut }) {
  const [racket, setRacket] = useState(profile.racket || '');
  const [side, setSide] = useState(profile.side || 'Right');
  const [photo, setPhoto] = useState(profile.photo || null);
  const [dob, setDob] = useState(profile.dob || '');
  const [gender, setGender] = useState(profile.gender || '');
  const [racketsOwned, setRacketsOwned] = useState(profile.racketsOwned || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const resized = await fileToResizedFile(file);
      setPhoto(URL.createObjectURL(resized)); // instant preview
      const publicUrl = await uploadAvatar(resized); // real upload
      setPhoto(publicUrl);
    } catch (err) {
      console.error('Photo upload failed', err);
    }
    setBusy(false);
  }

  return (
    <div className="px-5 pt-2 pb-28">
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-4" style={{ color: COLORS.glass }}><ChevronLeft size={18} /> Back</button>
      <h2 className="font-display text-2xl tracking-wide mb-5" style={{ color: COLORS.teal }}>YOUR PROFILE</h2>

      <div className="flex flex-col items-center mb-6">
        <button onClick={() => fileRef.current && fileRef.current.click()} className="relative" aria-label="Change photo">
          <Avatar photo={photo} name={youName} size={96} />
          <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: COLORS.lime }}><Camera size={16} color={COLORS.teal} /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <p className="font-display text-xl mt-3" style={{ color: COLORS.teal }}>{youName}</p>
        {busy && <p className="text-xs mt-1" style={{ color: COLORS.glass }}>Processing photo…</p>}
      </div>

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Default racket</label>
      <input value={racket} onChange={(e) => setRacket(e.target.value)} placeholder="e.g. Bullpadel Vertex" className="w-full px-3 py-2.5 rounded-lg border mb-5 text-sm" style={{ borderColor: COLORS.glass }} />

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Preferred side</label>
      <div className="flex gap-2 mb-5">
        {['Left', 'Right'].map((s) => (
          <button key={s} onClick={() => setSide(s)} className="flex-1 py-2.5 rounded-lg text-sm font-medium border" style={{ backgroundColor: side === s ? COLORS.teal : 'transparent', color: side === s ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>{s} side</button>
        ))}
      </div>

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Date of birth</label>
      <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border mb-5 text-sm" style={{ borderColor: COLORS.glass }} />

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Gender</label>
      <div className="flex flex-wrap gap-2 mb-5">
        {['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => (
          <button key={g} onClick={() => setGender(g)} className="px-3 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: gender === g ? COLORS.teal : 'transparent', color: gender === g ? COLORS.cream : COLORS.teal, borderColor: COLORS.teal }}>{g}</button>
        ))}
      </div>

      <label className="block text-xs font-mono uppercase mb-2" style={{ color: COLORS.glass }}>Rackets owned</label>
      <input value={racketsOwned} onChange={(e) => setRacketsOwned(e.target.value)} placeholder="e.g. Bullpadel Vertex, Adidas Metalbone" className="w-full px-3 py-2.5 rounded-lg border mb-6 text-sm" style={{ borderColor: COLORS.glass }} />

      <button onClick={() => onSave({ racket: racket.trim(), side, photo, dob, gender, racketsOwned: racketsOwned.trim() })} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide flex items-center justify-center gap-2" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}><Check size={18} /> SAVE PROFILE</button>
      {onSignOut && (
        <button onClick={onSignOut} className="w-full py-3 mt-3 text-sm font-medium flex items-center justify-center gap-2" style={{ color: COLORS.clay }}><LogOut size={16} /> Sign out</button>
      )}
    </div>
  );
}

// ---------- diary hub ----------
function DiaryScreen({ sessions, youName, profile, onUpdateProfile, onSignOut }) {
  const [segment, setSegment] = useState('matches');
  const [view, setView] = useState({ type: 'home' });

  const stats = useMemo(() => {
    let wins = 0, total = 0;
    const partnerCount = {};
    sessions.forEach((s) => {
      const yc = s.courts.find((c) => c.players.includes(youName));
      if (!yc) return;
      yc.rounds.forEach((r) => {
        if (!playedIn(r, youName)) return;
        total++;
        const isA = r.teamA.includes(youName);
        if ((isA ? r.scoreA : r.scoreB) > (isA ? r.scoreB : r.scoreA)) wins++;
        const partner = (isA ? r.teamA : r.teamB).find((p) => p !== youName);
        if (partner) partnerCount[partner] = (partnerCount[partner] || 0) + 1;
      });
    });
    const top = Object.entries(partnerCount).sort((a, b) => b[1] - a[1])[0];
    return { sessions: sessions.length, winRate: total ? Math.round((wins / total) * 100) : 0, topPartner: top ? top[0] : null };
  }, [sessions, youName]);

  if (view.type === 'session') {
    const s = sessions.find((x) => x.id === view.id);
    if (s) return <SessionDetail session={s} youName={youName} onBack={() => setView({ type: 'home' })} />;
  }
  if (view.type === 'rival') return <RivalDetail name={view.id} sessions={sessions} youName={youName} onBack={() => setView({ type: 'home' })} onOpenSession={(id) => setView({ type: 'session', id })} />;
  if (view.type === 'court') return <CourtDetail venue={view.id} sessions={sessions} youName={youName} onBack={() => setView({ type: 'home' })} onOpenSession={(id) => setView({ type: 'session', id })} />;
  if (view.type === 'profile') return <ProfileEditor youName={youName} profile={profile} onBack={() => setView({ type: 'home' })} onSave={(p) => { onUpdateProfile(p); setView({ type: 'home' }); }} onSignOut={onSignOut} />;

  const rivalMap = buildRivalMap(sessions, youName);
  const rivals = Object.entries(rivalMap).map(([name, s]) => ({ name, ...s, total: s.partnerRounds + s.oppRounds })).sort((a, b) => b.total - a.total);
  const courtMap = buildCourtMap(sessions);
  const courts = Object.entries(courtMap).map(([venue, d]) => ({ venue, ...d, avg: d.starsSum / d.visits })).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
  const sortedSessions = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="px-5 pt-6 pb-28">
      <button onClick={() => setView({ type: 'profile' })} className="w-full flex items-center gap-3 p-4 rounded-2xl mb-5 text-left" style={{ backgroundColor: COLORS.teal }}>
        <Avatar photo={profile.photo} name={youName} size={52} />
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl tracking-wide truncate" style={{ color: COLORS.cream }}>{youName}</div>
          <div className="font-mono text-xs" style={{ color: COLORS.lime }}>{profile.racket || 'No racket'} &middot; {profile.side || 'Right'} side</div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl" style={{ color: COLORS.lime }}>{stats.winRate}%</div>
          <div className="font-mono text-[10px]" style={{ color: COLORS.cream }}>WIN RATE</div>
        </div>
      </button>

      <div className="flex gap-1 p-1 rounded-xl mb-5" style={{ backgroundColor: '#fff' }}>
        {[{ k: 'matches', label: 'Matches' }, { k: 'rivals', label: 'Rivals' }, { k: 'courts', label: 'Courts' }].map((s) => (
          <button key={s.k} onClick={() => setSegment(s.k)} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: segment === s.k ? COLORS.teal : 'transparent', color: segment === s.k ? COLORS.cream : COLORS.glass }}>{s.label}</button>
        ))}
      </div>

      {segment === 'matches' && (sortedSessions.length === 0 ? (
        <Empty text="No matches yet. Tap + to play your first one." />
      ) : sortedSessions.map((s) => <SessionTicket key={s.id} session={s} youName={youName} onClick={() => setView({ type: 'session', id: s.id })} />))}

      {segment === 'rivals' && (rivals.length === 0 ? (
        <Empty text="Play with friends to start tracking rivalries." />
      ) : rivals.map((r) => (
        <button key={r.name} onClick={() => setView({ type: 'rival', id: r.name })} className="w-full flex items-center gap-3 p-4 rounded-2xl mb-3" style={{ backgroundColor: '#fff' }}>
          <Avatar name={r.name} size={44} />
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-medium" style={{ color: COLORS.ink }}>{r.name}</div>
            <div className="font-mono text-xs truncate" style={{ color: COLORS.glass }}>
              {r.partnerRounds > 0 && `partnered ${r.partnerRounds}x`}{r.partnerRounds > 0 && r.oppRounds > 0 && ' · '}{r.oppRounds > 0 && `faced ${r.oppWins}-${r.oppRounds - r.oppWins}`}
            </div>
          </div>
        </button>
      )))}

      {segment === 'courts' && (courts.length === 0 ? (
        <Empty text="Rate a court after your next match to see it here." />
      ) : courts.map((c) => (
        <button key={c.venue} onClick={() => setView({ type: 'court', id: c.venue })} className="w-full flex items-center justify-between p-4 rounded-2xl mb-3" style={{ backgroundColor: '#fff' }}>
          <div className="flex items-center gap-3 min-w-0"><MapPin size={18} color={COLORS.teal} className="flex-shrink-0" /><div className="text-left min-w-0"><div className="text-sm font-medium truncate" style={{ color: COLORS.ink }}>{c.venue}</div><div className="font-mono text-xs" style={{ color: COLORS.glass }}>{c.visits} visit{c.visits > 1 ? 's' : ''}</div></div></div>
          <div className="flex items-center gap-1 flex-shrink-0"><Star size={14} fill={COLORS.lime} color={COLORS.teal} /><span className="font-mono text-sm" style={{ color: COLORS.teal }}>{c.avg.toFixed(1)}</span></div>
        </button>
      )))}
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-center py-16 px-4 rounded-2xl" style={{ backgroundColor: '#fff' }}><p className="text-sm" style={{ color: COLORS.glass }}>{text}</p></div>;
}

// ---------- nav + onboarding ----------
function BottomNav({ tab, onChange, hasActive }) {
  return (
    <div className="fixed bottom-0 left-0 right-0">
      <div className="max-w-md mx-auto flex items-center justify-around px-6 py-3" style={{ backgroundColor: '#fff', borderTop: '1px solid #eee' }}>
        <button onClick={() => onChange('live')} className="flex flex-col items-center gap-0.5 relative">
          <Play size={20} color={tab === 'live' ? COLORS.teal : COLORS.glass} fill={tab === 'live' ? COLORS.teal : 'none'} />
          <span className="text-[10px] font-mono" style={{ color: tab === 'live' ? COLORS.teal : COLORS.glass }}>Live</span>
          {hasActive && <span className="absolute -top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.clay }} />}
        </button>
        <button onClick={() => onChange('new')} className="w-14 h-14 rounded-full flex items-center justify-center -mt-6 shadow-lg" style={{ backgroundColor: COLORS.teal }}><Plus size={26} color={COLORS.lime} /></button>
        <button onClick={() => onChange('diary')} className="flex flex-col items-center gap-0.5">
          <BookOpen size={20} color={tab === 'diary' ? COLORS.teal : COLORS.glass} />
          <span className="text-[10px] font-mono" style={{ color: tab === 'diary' ? COLORS.teal : COLORS.glass }}>Diary</span>
        </button>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim()) { setError('Enter your email.'); return; }
    setBusy(true);
    setError('');
    try {
      const { error: err } = await signInWithEmail(email.trim());
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send link. Try again.');
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-8 py-10" style={{ backgroundColor: COLORS.teal }}>
      <div className="max-w-md w-full mx-auto">
        <h1 className="font-display text-4xl tracking-wide mb-2 text-center" style={{ color: COLORS.lime }}>PADEL DIARY</h1>
        <p className="text-sm mb-7 text-center" style={{ color: COLORS.cream }}>Every match, every rivalry, every court &mdash; logged and shared.</p>

        {sent ? (
          <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: COLORS.cream }}>
            <Mail size={28} color={COLORS.teal} className="mx-auto mb-2" />
            <p className="text-sm" style={{ color: COLORS.ink }}>Check <strong>{email}</strong> for a sign-in link, then come back to this tab.</p>
          </div>
        ) : (
          <>
            <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.lime }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded-lg mb-3 text-sm"
              style={{ backgroundColor: COLORS.cream, color: COLORS.ink }}
            />
            {error && <p className="text-sm mb-3" style={{ color: COLORS.lime }}>{error}</p>}
            <button onClick={submit} disabled={busy} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide disabled:opacity-50" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>
              {busy ? 'SENDING…' : 'SEND SIGN-IN LINK'}
            </button>
            <p className="text-xs mt-4 text-center" style={{ color: COLORS.glass }}>
              Google and Apple sign-in come later &mdash; email works today, no password needed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Shown once, right after a person's first sign-in, to collect the bio fields.
function ProfileSetup({ defaultName, onSubmit }) {
  const [name, setName] = useState(defaultName || '');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [racketsOwned, setRacketsOwned] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError('Enter your name to continue.'); return; }
    setBusy(true);
    await onSubmit({ name: name.trim(), dob, gender, racketsOwned: racketsOwned.trim() });
    setBusy(false);
  }

  const fieldStyle = { backgroundColor: COLORS.cream, color: COLORS.ink };

  return (
    <div className="min-h-screen flex flex-col justify-center px-8 py-10" style={{ backgroundColor: COLORS.teal }}>
      <div className="max-w-md w-full mx-auto">
        <h1 className="font-display text-4xl tracking-wide mb-2 text-center" style={{ color: COLORS.lime }}>ONE MORE THING</h1>
        <p className="text-sm mb-7 text-center" style={{ color: COLORS.cream }}>A bit about you, so the diary knows who's playing.</p>

        <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.lime }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full px-4 py-3 rounded-lg mb-4 text-sm" style={fieldStyle} />

        <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.lime }}>Date of birth</label>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-full px-4 py-3 rounded-lg mb-4 text-sm" style={fieldStyle} />

        <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.lime }}>Gender</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => (
            <button key={g} onClick={() => setGender(g)} className="px-3 py-2 rounded-lg text-sm font-medium border" style={{ backgroundColor: gender === g ? COLORS.lime : 'transparent', color: gender === g ? COLORS.teal : COLORS.cream, borderColor: COLORS.lime }}>{g}</button>
          ))}
        </div>

        <label className="block text-xs font-mono uppercase mb-1" style={{ color: COLORS.lime }}>Rackets owned</label>
        <input value={racketsOwned} onChange={(e) => setRacketsOwned(e.target.value)} placeholder="e.g. Bullpadel Vertex, Adidas Metalbone" className="w-full px-4 py-3 rounded-lg mb-2 text-sm" style={fieldStyle} />
        <p className="text-xs mb-5" style={{ color: COLORS.glass }}>Optional &mdash; you can fill these in later from your profile.</p>

        {error && <p className="text-sm mb-3" style={{ color: COLORS.lime }}>{error}</p>}
        <button onClick={submit} disabled={busy} className="w-full py-3.5 rounded-xl font-display text-lg tracking-wide disabled:opacity-50" style={{ backgroundColor: COLORS.lime, color: COLORS.teal }}>
          {busy ? 'SAVING…' : 'START LOGGING'}
        </button>
      </div>
    </div>
  );
}

// ---------- app ----------
export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState('diary');

  const youName = profile ? profile.name : null;

  // The in-progress match is a draft, not a real record yet — keep it in the
  // browser only, the same way it worked locally. Real sessions go to Supabase.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('padel-diary-active');
      if (raw) setActive(JSON.parse(raw));
    } catch (e) {}
  }, []);

  function persistActive(next) {
    setActive(next);
    try {
      if (next) localStorage.setItem('padel-diary-active', JSON.stringify(next));
      else localStorage.removeItem('padel-diary-active');
    } catch (e) {}
  }

  // Check who's signed in once, then keep listening for sign-in / sign-out.
  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      const current = await getCurrentUser();
      setUser(current);
      setAuthChecked(true);
    })();
    unsubscribe = onAuthChange((u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // Once signed in, load that person's profile + their sessions from Supabase.
  useEffect(() => {
    if (!user) { setProfile(null); setSessions([]); return; }
    (async () => {
      try {
        const row = await getMyProfile();
        setProfile(mapProfileFromRow(row));
        setNeedsProfileSetup(!row || !row.dob);
      } catch (e) {
        console.error('Could not load profile', e);
        setProfile(mapProfileFromRow(null));
        setNeedsProfileSetup(true);
      }
      try {
        const data = await listMySessions();
        setSessions(data);
      } catch (e) {
        console.error('Could not load sessions', e);
      }
    })();
  }, [user]);

  async function completeProfileSetup(bio) {
    try {
      const row = await updateMyProfile({
        name: bio.name,
        dob: bio.dob || null,
        gender: bio.gender || null,
        rackets_owned: bio.racketsOwned || null,
      });
      setProfile(mapProfileFromRow(row));
    } catch (e) {
      console.error('Could not save profile', e);
      setProfile((p) => ({ ...p, name: bio.name, dob: bio.dob, gender: bio.gender, racketsOwned: bio.racketsOwned }));
    }
    setNeedsProfileSetup(false);
  }

  async function saveProfile(next) {
    setProfile(next); // optimistic — the screen updates instantly
    try {
      const row = await updateMyProfile({
        racket: next.racket,
        side: next.side,
        photo_url: next.photo,
        dob: next.dob || null,
        gender: next.gender || null,
        rackets_owned: next.racketsOwned || null,
      });
      setProfile(mapProfileFromRow(row));
    } catch (e) {
      console.error('Could not save profile', e);
    }
  }

  function startMatch(cfg) {
    let courts, pairings;
    if (isPrescheduled(cfg.format)) {
      const base = cfg.format === 'fixed'
        ? groupTeams(pairUp(cfg.players), cfg.numCourts)
        : groupPlayers(cfg.players, cfg.numCourts).map((members) => ({ players: members, rounds: [] }));
      courts = base.map((c) => ({ ...c, schedule: generateFullSchedule(cfg.format, c, cfg.totalRounds) }));
      pairings = null;
    } else {
      courts = groupPlayers(cfg.players, cfg.numCourts).map((members) => ({ players: members, rounds: [] }));
      pairings = courts.map((c) => pairingFor(cfg.format, c, c.rounds));
    }
    const next = {
      youName, venue: cfg.venue, format: cfg.format, scoring: cfg.scoring,
      totalRounds: cfg.totalRounds, courts, pairings, roundIndex: 0, phase: 'scoring',
    };
    persistActive(next);
    saveProfile({ ...profile, racket: cfg.gear.racket, side: cfg.gear.side });
    setTab('live');
  }

  function commitRound(scores) {
    const courts = active.courts.map((c, idx) => ({
      ...c,
      rounds: [...c.rounds, { teamA: active.pairings[idx].teamA, teamB: active.pairings[idx].teamB, scoreA: scores[idx].a, scoreB: scores[idx].b }],
    }));
    if (active.roundIndex + 1 < active.totalRounds) {
      const pairings = courts.map((c) => pairingFor(active.format, c, c.rounds));
      persistActive({ ...active, courts, pairings, roundIndex: active.roundIndex + 1 });
    } else {
      persistActive({ ...active, courts, phase: 'summary' });
    }
  }

  // For prescheduled formats: score, skip, or finish any match in the list, in any order.
  function scoreMatch(courtIdx, round, scoreA, scoreB) {
    const courts = active.courts.map((c, idx) => {
      if (idx !== courtIdx) return c;
      return { ...c, schedule: c.schedule.map((m) => (m.round === round ? { ...m, status: 'completed', scoreA, scoreB } : m)) };
    });
    persistActive({ ...active, courts });
  }

  function skipMatch(courtIdx, round) {
    const courts = active.courts.map((c, idx) => {
      if (idx !== courtIdx) return c;
      return { ...c, schedule: c.schedule.map((m) => (m.round === round ? { ...m, status: 'skipped' } : m)) };
    });
    persistActive({ ...active, courts });
  }

  function finishSchedule() {
    const courts = active.courts.map((c) => ({
      players: c.players,
      rounds: c.schedule.filter((m) => m.status === 'completed').map((m) => ({ teamA: m.teamA, teamB: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB })),
    }));
    persistActive({ ...active, courts, phase: 'summary' });
  }

  // Best-effort friend linking: any typed player name that exactly matches a
  // registered account gets the session shared straight into their diary too.
  // Everyone else is stored as a guest name. A proper "search and pick a
  // friend" UI in the player list is the natural next refinement.
  async function resolveParticipants(names) {
    const participants = [];
    for (const name of names) {
      let matchedId = null;
      try {
        const matches = await searchProfiles(name);
        const exact = matches.find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (exact) matchedId = exact.id;
      } catch (e) {
        // lookup failed — falls back to storing them as a guest name, not fatal
      }
      participants.push(matchedId ? { profileId: matchedId } : { guestName: name });
    }
    return participants;
  }

  async function saveSession(rating) {
    const standings = computeStandings(active.courts);
    const players = active.courts.flatMap((c) => c.players);
    const session = {
      date: new Date().toISOString(), venue: active.venue, format: active.format,
      scoring: active.scoring, totalRounds: active.totalRounds, you: youName,
      players, courts: active.courts, standings, rating,
    };
    const otherNames = players.filter((p) => p !== youName);
    const participants = await resolveParticipants(otherNames);
    try {
      await saveSessionRemote(session, participants);
      const refreshed = await listMySessions();
      setSessions(refreshed);
    } catch (e) {
      console.error('Could not save session', e);
    }
    persistActive(null);
    setTab('diary');
  }

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: COLORS.cream }}><span className="font-mono text-sm" style={{ color: COLORS.glass }}>Loading&hellip;</span></div>;
  }
  if (!user) return <AuthScreen />;
  if (!profile) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: COLORS.cream }}><span className="font-mono text-sm" style={{ color: COLORS.glass }}>Loading your profile&hellip;</span></div>;
  }
  if (needsProfileSetup) return <ProfileSetup defaultName={profile.name} onSubmit={completeProfileSetup} />;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: COLORS.cream }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.02em; }
        .font-mono { font-family: 'Space Mono', monospace; }
        body, input, button { font-family: 'Inter', sans-serif; }
        .stub { position: relative; }
        .stub::before, .stub::after { content: ''; position: absolute; left: -7px; width: 14px; height: 14px; border-radius: 50%; background: #F3F1E6; }
        .stub::before { top: -7px; }
        .stub::after { bottom: -7px; }
        input:focus, button:focus-visible { outline: 2px solid #4D7C82; outline-offset: 1px; }
      `}</style>
      <div className="max-w-md mx-auto">
        {tab === 'live' && <LiveTab active={active} onCommitRound={commitRound} onScoreMatch={scoreMatch} onSkipMatch={skipMatch} onFinish={finishSchedule} onSaveSession={saveSession} onDiscard={() => persistActive(null)} onGoNew={() => setTab('new')} />}
        {tab === 'new' && <NewSessionSetup youName={youName} profile={profile} sessions={sessions} hasActive={!!active} onCancel={() => setTab(active ? 'live' : 'diary')} onStart={startMatch} />}
        {tab === 'diary' && <DiaryScreen sessions={sessions} youName={youName} profile={profile} onUpdateProfile={saveProfile} onSignOut={signOut} />}
      </div>
      <BottomNav tab={tab} onChange={setTab} hasActive={!!active} />
    </div>
  );
}
