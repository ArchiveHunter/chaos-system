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

app.use('/api/admin', (req, res, next) => {
  if (req.path === '/auth') return next();
  requireAdmin(req, res, next);
});

// ── Data files ────────────────────────────────────────────────────────────────

const DATA_DIR      = path.join(__dirname, 'data');
const STATE_FILE    = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ── Action definitions (defaults) ────────────────────────────────────────────

const DEFAULT_EARN_ACTIONS = {
  food:          { label: 'Food',                   emoji: '🍕', ce: 2 },
  hydration:     { label: 'Hydration',              emoji: '💧', ce: 1 },
  sleep:         { label: 'Sleep',                  emoji: '😴', ce: 2 },
  communication: { label: 'Communication',          emoji: '💬', ce: 1 },
  affection:     { label: 'Affection',              emoji: '💕', ce: 2 },
  instructions:  { label: 'Followed Instructions',  emoji: '✅', ce: 3 },
};

const DEFAULT_CHAOS_ACTIONS = {
  teasing:         { label: 'Teasing',                   emoji: '😏', ce: 1 },
  ignore_minor:    { label: 'Ignore Minor Instruction',  emoji: '🙈', ce: 2 },
  deliberate_push: { label: 'Deliberate Push',           emoji: '😤', ce: 3 },
  full_chaos:      { label: 'Full Chaos Moment',         emoji: '💥', ce: 5 },
};

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  partnerName: '',
  earnCE:  {},
  chaosCE: {},
};

let settings = DEFAULT_SETTINGS;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) { console.error('Settings load error:', e.message); }
  return settings;
}

function saveSettings(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  settings = data;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function getEarnActions() {
  return Object.fromEntries(
    Object.entries(DEFAULT_EARN_ACTIONS).map(([k, v]) => [k, { ...v, ce: settings.earnCE?.[k] ?? v.ce }])
  );
}

function getChaosActions() {
  return Object.fromEntries(
    Object.entries(DEFAULT_CHAOS_ACTIONS).map(([k, v]) => [k, { ...v, ce: settings.chaosCE?.[k] ?? v.ce }])
  );
}

loadSettings();

// ── State helpers ─────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  ce: 0,
  dailyEarned: 0,
  overcharged: false,
  noChaos: false,
  noChaosExpiry: null,
  noChaosReason: null,
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
    s.dailyEarned    = 0;
    s.overcharged    = false;
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

function getMax(s) { return s.overcharged ? 15 : 10; }

function getChaosState(ce) {
  if (ce <= 3)  return { name: 'Tame Gremlin',    level: 0, emoji: '😴' };
  if (ce <= 7)  return { name: 'Stirring Trouble', level: 1, emoji: '😈' };
  if (ce <= 10) return { name: 'Chaos Gremlin',   level: 2, emoji: '🔥' };
  return              { name: 'Menace Mode',       level: 3, emoji: '💀' };
}

function prep(s) { dailyReset(s); checkExpiry(s); }

function respond(res, s, extra = {}) {
  saveState(s);
  res.json({
    ...s,
    chaosState:     getChaosState(s.ce),
    max:            getMax(s),
    remainingToday: Math.max(0, getMax(s) - s.dailyEarned),
    earnActions:    getEarnActions(),
    chaosActions:   getChaosActions(),
    partnerName:    settings.partnerName || '',
    ...extra,
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  const s = loadState();
  respond(res, s);
});

app.post('/api/earn', requireAdmin, (req, res) => {
  const actions = getEarnActions();
  const act     = actions[req.body.action];
  if (!act) return res.status(400).json({ error: 'Unknown action' });

  const s = loadState();
  prep(s);

  const max     = getMax(s);
  const canEarn = Math.min(act.ce, max - s.dailyEarned);

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
  const actions = getChaosActions();
  const act     = actions[req.body.action];
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
    s.ce            = 0;
    s.overcharged   = false;
    s.noChaos       = true;
    s.noChaosExpiry = Date.now() + 60 * 60 * 1000;
    s.noChaosReason = 'overload';
    addLog(s, `💥 OVERLOAD! Attempted ${act.emoji} ${act.label} without enough CE. Locked for 1h.`, 0);
    return respond(res, s, { toast: '💥 OVERLOAD! CE reset to 0. No chaos for 1 hour.', toastType: 'overload', overloaded: true });
  }

  s.ce -= act.ce;
  // Overcharge stays unlocked until daily reset or overload — spending below 10 does NOT clear it

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
  s.dailyEarned = 0;
  addLog(s, `👑 Admin: CE set to ${s.ce}`, 0);
  respond(res, s, { toast: `👑 CE set to ${s.ce}`, toastType: 'admin' });
});

app.post('/api/admin/catch', (req, res) => {
  const s = loadState();
  prep(s);
  s.noChaos       = true;
  s.noChaosExpiry = null;
  s.noChaosReason = 'catch';
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
  s.overcharged    = false;
  s.lastDailyReset = new Date().toDateString();
  addLog(s, '👑 Admin: daily earn counter reset', 0);
  respond(res, s, { toast: '👑 Daily counter reset!', toastType: 'admin' });
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', requireAdmin, (req, res) => {
  res.json({
    partnerName:         settings.partnerName || '',
    earnCE:              settings.earnCE  || {},
    chaosCE:             settings.chaosCE || {},
    defaultEarnActions:  DEFAULT_EARN_ACTIONS,
    defaultChaosActions: DEFAULT_CHAOS_ACTIONS,
  });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { partnerName, earnCE, chaosCE } = req.body;
  saveSettings({
    partnerName: String(partnerName || '').trim().slice(0, 40),
    earnCE:  earnCE  || {},
    chaosCE: chaosCE || {},
  });
  res.json({ ok: true, toast: '✅ Settings saved!', toastType: 'admin' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => console.log(`🔥 Chaos Gremlin running on http://0.0.0.0:${PORT}`));
