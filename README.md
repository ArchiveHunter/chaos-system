# 🔥 Chaos Gremlin System

A gamified behaviour tracking system. Earn **Chaos Energy (CE)** through positive actions. Spend it to cause mischief. The system rewards spending — not hoarding.

---

## How It Works

### Chaos Energy (CE)
CE is earned by the admin logging positive behaviours. Once earned, CE can be spent on chaos actions. The goal is to spend it all.

**Daily cap:** 10 CE (extends to 15 in Overcharge mode)

### Earning CE (Admin)
| Action | CE |
|---|---|
| Food | +2 |
| Hydration | +1 |
| Sleep | +2 |
| Communication | +1 |
| Affection | +2 |
| Followed Instructions | +3 |

### Spending CE (Admin)
| Chaos Action | Cost |
|---|---|
| Teasing | 1 CE |
| Ignore Minor Instruction | 2 CE |
| Deliberate Push | 3 CE |
| Full Chaos Moment | 5 CE |

### Chaos States
| CE | State |
|---|---|
| 0–3 | 😴 Tame Gremlin |
| 4–7 | 😈 Stirring Trouble |
| 8–10 | 🔥 Chaos Gremlin |
| 11+ | 💀 Menace Mode |

### Overcharge
Reaching 10 CE without spending unlocks a temporary cap of 15 CE and enables larger chaos events.

### Overload
Attempting a chaos action without enough CE resets CE to 0 and locks the gremlin out of chaos actions for **1 hour**.

### Admin Controls
- **Catch Moment** — immediately locks chaos (indefinitely, until manually released)
- **Release** — lifts any active lock
- **Adjust CE** — manually add or remove CE
- **Reset Daily** — clears the daily earn counter
- **Set CE → 0** — emergency reset

---

## Setup

### Requirements
- Node.js 18+

### Install

```bash
git clone https://github.com/ArchiveHunter/chaos-system.git
cd chaos-system
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
PORT=3050
ADMIN_PIN=your-chosen-pin
```

### Run

```bash
node server.js
```

The app will be available at `http://localhost:3050`.

State is persisted to `data/state.json` and survives restarts.

---

## Deployment (PM2)

```bash
pm2 start server.js --name chaos-gremlin
pm2 save
```

---

## UI

| View | URL |
|---|---|
| Main display (gremlin view) | `http://[host]:[port]/` |

- The **main view** shows the CE meter, chaos state, and activity log — read-only
- The **admin panel** is unlocked via PIN and contains all earn/spend controls plus management tools
- State polls automatically every 5 seconds
