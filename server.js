const express = require('express');
const fs      = require('fs');
const path    = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const ADMIN_PIN = process.env.ADMIN_PIN || '0000';

const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Admin auth ────────────────────────────────────────────────────────────────

app.post('/api/admin/auth', (req, res) => {
  const { pin } = req.body;
  res.json({ ok: String(pin) === String(ADMIN_PIN) });
});

function requireAdmin(req, res, next) {
  if (String(req.headers['x-admin-pin']) !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// Apply to all /api/admin/* except /auth
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/auth') return next();
  requireAdmin(req, res, next);
});

const DATA_DIR   = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ── Action definitions ────────────────────────────────────────────────────────

const EARN_ACTIONS = {
  food:          { label: 'Food',                   emoji: '🍕', ce: 2 },
  hydration:     { label: 'Hydration',              emoji: '💧', ce: 1 },
  sleep:         { label: 'Sleep',                  emoji: '😴', ce: 2 },
  communication: { label: 'Communication',          emoji: '💬', ce: 1 },
  affection:     { label: 'Affection',              emoji: '💕', ce: 2 },
  instructions:  { label: 'Followed Instructions',  emoji: '✅', ce: 3 },
};

const CHAOS_ACTIONS = {
  teasing:         { label: 'Teasing',                   emoji: '😏', ce: 1 },
  ignore_minor:    { label: 'Ignore Minor Instruction',  emoji: '🙈', ce: 2 },
  deliberate_push: { label: 'Deliberate Push',           emoji: '😤', ce: 3 },
  full_chaos:      { label: 'Full Chaos Moment',         emoji: '💥', ce: 5 },
};

// ── State helpers ─────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  ce: 0,
  dailyEarned: 0,
  overcharged: false,
  noChaos: false,
  noChaosExpiry: null,   // null = permanent until admin releases
  noChaosReason: null,   // 'overload' | 'catch'
  lastDailyReset: new Date().toDateString(),
  log: [],
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch (e) { console.error('State load error:', e.message); }
  return { ...DEFAULT_STATE };
}

function saveState(s) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function dailyReset(s) {
  const today = new Date().toDateString();
  if (s.lastDailyReset !== today) {
    s.dailyEarned = 0;
    s.lastDailyReset = today;
  }
  return s;
}

function checkExpiry(s) {
  if (s.noChaos && s.noChaosExpiry && Date.now() > s.noChaosExpiry) {
    s.noChaos       = false;
    s.noChaosExpiry = null;
    s.noChaosReason = null;
    addLog(s, '⏰ No-Chaos timer expired — gremlin is back', 0);
  }
  return s;
}

function addLog(s, action, delta) {
  s.log.unshift({ time: new Date().toISOString(), action, delta, ce: s.ce });
  if (s.log.length > 30) s.log = s.log.slice(0, 30);
}

function getMax(s)         { return s.overcharged ? 15 : 10; }
function getChaosState(ce) {
  if (ce <= 3)  return { name: 'Tame Gremlin',    level: 0, emoji: '😴' };
  if (ce <= 7)  return { name: 'Stirring Trouble', level: 1, emoji: '😈' };
  if (ce <= 10) return { name: 'Chaos Gremlin',   level: 2, emoji: '🔥' };
  return              { name: 'Menace Mode',       level: 3, emoji: '💀' };
}

function prep(s) {
  dailyReset(s);
  checkExpiry(s);
}

function respond(res, s, extra = {}) {
  saveState(s);
  res.json({
    ...s,
    chaosState:     getChaosState(s.ce),
    max:            getMax(s),
    remainingToday: Math.max(0, getMax(s) - s.dailyEarned),
    earnActions:    EARN_ACTIONS,
    chaosActions:   CHAOS_ACTIONS,
    ...extra,
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  const s = loadState();
  respond(res, s);
});

app.post('/api/earn', requireAdmin, (req, res) => {
  const act = EARN_ACTIONS[req.body.action];
  if (!act) return res.status(400).json({ error: 'Unknown action' });

  const s = loadState();
  prep(s);

  const max      = getMax(s);
  const canEarn  = Math.min(act.ce, max - s.dailyEarned);

  if (canEarn <= 0) {
    return respond(res, s, { toast: '⚡ Daily CE cap reached — save your chaos for tomorrow!', toastType: 'warn' });
  }

  s.ce          = Math.min(s.ce + canEarn, max);
  s.dailyEarned += canEarn;

  if (s.ce >= 10 && !s.overcharged) {
    s.overcharged = true;
    addLog(s, '⚡ OVERCHARGE UNLOCKED — cap raised to 15!', 0);
  }

  addLog(s, `${act.emoji} ${act.label} — +${canEarn} CE`, canEarn);
  respond(res, s, { toast: `${act.emoji} +${canEarn} CE — ${act.label}!`, toastType: 'earn', earnedAmount: canEarn });
});

app.post('/api/spend', requireAdmin, (req, res) => {
  const act = CHAOS_ACTIONS[req.body.action];
  if (!act) return res.status(400).json({ error: 'Unknown action' });

  const s = loadState();
  prep(s);

  if (s.noChaos) {
    const until = s.noChaosExpiry
      ? ` until ${new Date(s.noChaosExpiry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : ' — admin has locked it down';
    return respond(res, s, { toast: `🔒 No chaos allowed${until}.`, toastType: 'locked' });
  }

  if (s.ce < act.ce) {
    // Overload
    s.ce            = 0;
    s.overcharged   = false;
    s.noChaos       = true;
    s.noChaosExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    s.noChaosReason = 'overload';
    addLog(s, `💥 OVERLOAD! Attempted ${act.emoji} ${act.label} without enough CE. Locked for 1h.`, 0);
    return respond(res, s, { toast: '💥 OVERLOAD! CE reset to 0. No chaos for 1 hour.', toastType: 'overload', overloaded: true });
  }

  s.ce -= act.ce;
  if (s.ce < 10) s.overcharged = false;

  addLog(s, `${act.emoji} ${act.label} — -${act.ce} CE`, -act.ce);
  respond(res, s, { toast: `${act.emoji} ${act.label} activated! -${act.ce} CE`, toastType: 'spend' });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.post('/api/admin/adjust', (req, res) => {
  const { delta, reason } = req.body;
  if (typeof delta !== 'number') return res.status(400).json({ error: 'delta required' });

  const s = loadState();
  prep(s);
  s.ce = Math.max(0, Math.min(15, s.ce + delta));
  if (s.ce >= 10 && !s.overcharged) s.overcharged = true;
  if (s.ce < 10)  s.overcharged = false;
  addLog(s, `👑 Admin: ${delta > 0 ? '+' : ''}${delta} CE${reason ? ` — ${reason}` : ''}`, delta);
  respond(res, s, { toast: `👑 CE adjusted ${delta > 0 ? '+' : ''}${delta}`, toastType: 'admin' });
});

app.post('/api/admin/set-ce', (req, res) => {
  const { ce } = req.body;
  if (typeof ce !== 'number') return res.status(400).json({ error: 'ce required' });

  const s = loadState();
  prep(s);
  s.ce          = Math.max(0, Math.min(15, Math.round(ce)));
  s.overcharged = s.ce >= 10;
  addLog(s, `👑 Admin: CE set to ${s.ce}`, 0);
  respond(res, s, { toast: `👑 CE set to ${s.ce}`, toastType: 'admin' });
});

app.post('/api/admin/catch', (req, res) => {
  const s = loadState();
  prep(s);
  s.noChaos       = true;
  s.noChaosExpiry = null; // permanent until released
  s.noChaosReason = 'catch';
  s.overcharged   = false;
  addLog(s, '🛑 CATCH MOMENT — admin ended chaos phase', 0);
  respond(res, s, { toast: '🛑 Chaos caught! Locked until admin releases.', toastType: 'admin' });
});

app.post('/api/admin/release', (req, res) => {
  const s = loadState();
  prep(s);
  s.noChaos       = false;
  s.noChaosExpiry = null;
  s.noChaosReason = null;
  addLog(s, '✅ Admin lifted no-chaos restriction', 0);
  respond(res, s, { toast: '✅ Chaos restriction lifted!', toastType: 'admin' });
});

app.post('/api/admin/reset-daily', (req, res) => {
  const s = loadState();
  s.dailyEarned    = 0;
  s.lastDailyReset = new Date().toDateString();
  addLog(s, '👑 Admin: daily earn counter reset', 0);
  respond(res, s, { toast: '👑 Daily counter reset!', toastType: 'admin' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => console.log(`🔥 Chaos Gremlin running on http://0.0.0.0:${PORT}`));
