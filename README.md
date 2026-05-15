# ⚡ Action Zone — Multiplayer Backend

Real-time multiplayer server for **Action Zone** built with:
- **Node.js** + **Express** — HTTP server & REST API
- **Socket.io** — real-time WebSocket communication
- **Railway** — one-click cloud deployment

---

## 📁 File Structure

```
actionzone-backend/
├── src/
│   ├── server.js          ← Main entry point (Express + Socket.io)
│   ├── socketHandlers.js  ← All real-time event handlers
│   ├── roomManager.js     ← Room create/join/leave/list
│   ├── gameEngine.js      ← Authoritative physics (20 tick/sec)
│   └── utils.js           ← Helpers (code gen, logger, sanitize)
├── public/
│   ├── index.html         ← Place your ActionZone_Final.html here
│   └── multiplayer-client.js  ← Drop-in frontend connector
├── package.json
├── railway.toml           ← Railway deployment config
├── .env.example
└── .gitignore
```

---

## 🚀 Deploy to Railway — Step by Step

### STEP 1 — Install Git (if you don't have it)
Download from: https://git-scm.com/downloads
After install, open Terminal / Command Prompt and verify:
```bash
git --version
```

### STEP 2 — Create a GitHub account (if you don't have one)
Go to: https://github.com → Sign Up (free)

### STEP 3 — Create a new GitHub repository
1. Click the **+** button → **New repository**
2. Name it: `actionzone-server`
3. Set to **Public**
4. Click **Create repository**

### STEP 4 — Push this backend to GitHub
Open Terminal in this folder and run these commands one by one:

```bash
git init
git add .
git commit -m "Initial commit — Action Zone server"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/actionzone-server.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

### STEP 5 — Create a Railway account
Go to: https://railway.app → **Login with GitHub** (use the same account)

### STEP 6 — Deploy on Railway
1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. Select **actionzone-server**
4. Railway will automatically:
   - Detect Node.js
   - Run `npm install`
   - Run `npm start`
5. Wait ~1 minute for the build to finish ✅

### STEP 7 — Get your server URL
1. Click on your project in Railway
2. Go to **Settings** tab
3. Under **Networking**, click **Generate Domain**
4. You'll get a URL like: `https://actionzone-server-production-xxxx.up.railway.app`
5. **Copy this URL** — you'll need it in the next step

### STEP 8 — Add your game HTML to the server
Two options:

**Option A (Easiest):** Put your `ActionZone_Final.html` in the `/public/` folder,
rename it to `index.html`, push to GitHub → Railway auto-redeploys.

**Option B:** Host the HTML file anywhere (GitHub Pages, Netlify, etc.)
and just connect it to the Railway server URL.

### STEP 9 — Connect the frontend to your server

Add these 2 lines to `ActionZone_Final.html` just before `</body>`:

```html
<!-- Replace with your actual Railway URL -->
<script>window.AZ_SERVER = 'https://your-app.up.railway.app';</script>
<script src="https://your-app.up.railway.app/multiplayer-client.js"></script>
```

That's it! Open the game and click **CREATE ROOM** or **FIND ROOMS**.

---

## ✅ Verify it's working

Open your browser and visit:
```
https://your-app.up.railway.app/health
```

You should see:
```json
{
  "status": "ok",
  "uptime": 42.5,
  "rooms": 0,
  "players": 0,
  "ts": "2026-05-10 12:00:00.000Z"
}
```

Visit `/rooms` to see active public rooms:
```
https://your-app.up.railway.app/rooms
```

---

## 🎮 How the Multiplayer Works

```
Player A (Browser)                    Railway Server
     │                                      │
     │── room:create ──────────────────────▶│
     │◀─ room:created (code: ABC123) ───────│
     │                                      │
Player B (Browser)                          │
     │── room:join (ABC123) ───────────────▶│
     │◀─ room:joined ────────────────────── │
     │◀─ room:update (both players see it) ─│
     │                                      │
Host clicks START                           │
     │── game:start ──────────────────────▶│
     │◀─ game:countdown (3,2,1) ────────── │
     │◀─ game:started (initial state) ─────│
     │                                      │
Every 50ms (20 Hz):                         │
     │── game:input (dir, boosting) ───────▶│
     │◀─ game:tick (all worm positions) ────│
```

---

## 🔌 Socket.io Events Reference

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `room:create` | `{nick, skin, mode, maxPlayers, isPrivate}` | Create room |
| `room:join` | `{code, nick, skin}` | Join by code |
| `room:leave` | — | Leave room |
| `room:ready` | `{ready: bool}` | Toggle ready |
| `room:kick` | `{targetId}` | Kick player (host only) |
| `room:chat` | `{msg}` | Lobby chat |
| `room:setMode` | `{mode}` | Change mode (host only) |
| `game:start` | — | Start match (host only) |
| `game:input` | `{dir, boosting}` | Movement (20x/sec) |
| `game:chat` | `{msg}` | In-game chat |
| `game:emoji` | `{emoji}` | Send emoji |
| `reconnect:claim` | `{code, nick, skin}` | Rejoin after disconnect |
| `ping` | — | Measure latency |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| `room:created` | `{code, room}` | Room created |
| `room:joined` | `{code, room, chat}` | Joined room |
| `room:update` | `room` | Room state changed |
| `room:chat` | `{from, msg, sys}` | Chat message |
| `room:error` | `{msg}` | Error |
| `room:kicked` | `{msg}` | You were kicked |
| `game:countdown` | `{seconds}` | Match countdown |
| `game:started` | `{worms, foods, worldW, worldH}` | Full initial state |
| `game:tick` | `{t, worms, lb, eaten, deaths, kills, foods?}` | 20Hz delta |
| `game:respawn` | `{id, segs, dir}` | Worm respawned |
| `game:chat` | `{from, msg}` | In-game chat |
| `game:emoji` | `{id, emoji}` | Remote emoji |
| `server:stats` | `{online, rooms}` | Global stats |

---

## 🖥 Local Development

```bash
# Install dependencies
npm install

# Start with auto-restart on file changes
npm run dev

# Test the server
open http://localhost:3000/health
```

---

## 🔧 Troubleshooting

**"Cannot connect to server"**
→ Check your Railway URL is correct in the `<script>` tag.
→ Visit `your-url/health` to confirm the server is running.

**"Room not found"**
→ Room codes expire when empty. Create a new one.

**High latency**
→ Railway's free tier runs in the US. For players in the Middle East,
  upgrade to Railway Pro and select a region closer to you (EU/Asia).

**Mobile not working**
→ Make sure your Railway URL uses `https://` (not `http://`).
  Socket.io requires HTTPS on mobile browsers.

**Players see different positions**
→ This is normal with lag. The client uses 80ms interpolation
  to smooth out position differences between server ticks.

---

## 📊 Performance

| Metric | Value |
|---|---|
| Tick rate | 20 Hz (every 50ms) |
| Max players/room | 32 |
| Food items | 300 per room |
| Respawn time | 4 seconds |
| Reconnect attempts | 5 |
| Room cleanup | 90 minutes idle |

---

## 💰 Railway Free Tier Limits

- **500 hours/month** of compute (enough for ~20 hours/day)
- **1 GB** RAM
- **Sleeps after 30 min** of inactivity (first request wakes it up)

For a production game, upgrade to Railway's **Hobby plan ($5/month)**
which keeps the server always-on.
