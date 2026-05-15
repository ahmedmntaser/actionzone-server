/**
 * ════════════════════════════════════════════════════════
 *  ACTION ZONE — MULTIPLAYER CLIENT  v4.0
 *  Drop-in connector: replaces all fake local room logic
 *  with real Socket.io calls to your Railway server.
 * ════════════════════════════════════════════════════════
 *
 *  HOW TO USE:
 *  1. Add these two lines before </body> in ActionZone_Final.html:
 *
 *     <script>window.AZ_SERVER = 'https://YOUR-APP.up.railway.app';</script>
 *     <script src="https://YOUR-APP.up.railway.app/multiplayer-client.js"></script>
 *
 *  2. The client auto-connects and patches the game functions.
 *     No other changes needed.
 * ════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const SERVER_URL     = global.AZ_SERVER || 'http://localhost:3000';
  const INTERP_DELAY   = 80;    // ms lag for smooth interpolation
  const RECONNECT_TRIES = 5;
  const INPUT_HZ       = 20;    // how often to send input to server

  // ── State ───────────────────────────────────────────────────────────────────
  let socket        = null;
  let connected     = false;
  let myId          = null;
  let currentRoom   = null;
  let inGame        = false;
  let reconnecting  = false;
  let inputTimer    = null;

  // Interpolation: id → [{t, segs, dir, boosting}]
  const interpBuffers = {};
  let serverWorms     = {};
  let serverFoods     = [];

  // Store last known room code + nick for reconnect
  let _savedCode  = null;
  let _savedNick  = null;
  let _savedSkin  = 0;

  // ── Load Socket.io then connect ─────────────────────────────────────────────
  function init() {
    if (typeof io !== 'undefined') {
      _connect();
    } else {
      const script  = document.createElement('script');
      script.src    = SERVER_URL + '/socket.io/socket.io.js';
      script.onload = _connect;
      script.onerror = () => _log('❌ Could not load socket.io.js from ' + SERVER_URL);
      document.head.appendChild(script);
    }
  }

  function _connect() {
    socket = io(SERVER_URL, {
      transports:          ['websocket', 'polling'],
      reconnectionAttempts: RECONNECT_TRIES,
      reconnectionDelay:   1500,
      timeout:             10000,
    });

    // ── Connection lifecycle ─────────────────────────────────────────────────

    socket.on('connect', () => {
      connected    = true;
      myId         = socket.id;
      reconnecting = false;
      _updateConnUI(true, 'Connected');
      _log('✅ Connected — ' + myId);

      // Auto-rejoin room on reconnect
      if (_savedCode) {
        _log('🔄 Attempting to rejoin room ' + _savedCode);
        socket.emit('reconnect:claim', { code: _savedCode, nick: _savedNick, skin: _savedSkin },
          (res) => { if (!res?.ok) _log('Rejoin failed: ' + res?.error); }
        );
      }
    });

    socket.on('disconnect', (reason) => {
      connected = false;
      _updateConnUI(false, 'Disconnected — ' + reason);
      _log('🔌 Disconnected — ' + reason);
    });

    socket.on('connect_error', (err) => {
      reconnecting = true;
      _updateConnUI(false, 'Reconnecting…');
      _log('⚠ Connection error — ' + err.message);
    });

    socket.on('reconnect_failed', () => {
      _updateConnUI(false, 'Server unreachable');
      _notify('❌ Cannot reach server. Check your connection.', 'red');
    });

    // ── Room events ─────────────────────────────────────────────────────────

    socket.on('room:created', ({ code, room }) => {
      currentRoom = room;
      _savedCode  = code;
      _onRoomReady(room, true);
    });

    socket.on('room:joined', ({ code, room, chat }) => {
      currentRoom = room;
      _savedCode  = code;
      if (chat) chat.forEach(m => _addLobbyChat(m.from, m.msg, m.sys));
      _onRoomReady(room, false);
    });

    socket.on('room:update', (room) => {
      currentRoom = room;
      _refreshLobbyUI(room);
    });

    socket.on('room:chat', ({ from, msg, sys }) => {
      _addLobbyChat(from, msg, sys);
      if (inGame) _addGameChat(from, msg, sys);
    });

    socket.on('room:error', ({ msg }) => {
      _notify('❌ ' + msg, 'red');
    });

    socket.on('room:kicked', ({ msg }) => {
      _notify('🚫 ' + msg, 'red');
      inGame      = false;
      currentRoom = null;
      _savedCode  = null;
      if (typeof backMenu === 'function') backMenu();
    });

    // ── Game events ─────────────────────────────────────────────────────────

    socket.on('game:countdown', ({ seconds }) => {
      _log('⏱ Countdown: ' + seconds);
      if (typeof startCountdown === 'function') {
        startCountdown(() => {});  // server will fire game:started
      }
    });

    socket.on('game:started', (state) => {
      inGame      = true;
      serverFoods = state.foods || [];
      serverWorms = {};
      Object.values(interpBuffers).forEach(b => b.length = 0);
      state.worms.forEach(w => {
        serverWorms[w.id]    = w;
        interpBuffers[w.id]  = [];
      });
      _notify('🚀 Match started!', 'gold');
      _log('▶ game:started — ' + state.worms.length + ' worms');
      if (typeof onServerGameStarted === 'function') onServerGameStarted(state, myId);
    });

    socket.on('game:tick', (delta) => {
      const now = Date.now();

      // Buffer worm states for interpolation
      (delta.worms || []).forEach(w => {
        serverWorms[w.id] = w;
        if (!interpBuffers[w.id]) interpBuffers[w.id] = [];
        interpBuffers[w.id].push({ t: now, segs: w.segs, dir: w.dir, boosting: w.boosting, dead: w.dead });
        if (interpBuffers[w.id].length > 12) interpBuffers[w.id].shift();
      });

      // Food
      if (delta.foods) serverFoods = delta.foods;

      // Eaten
      (delta.eaten || []).forEach(e => {
        if (typeof onFoodEaten === 'function') onFoodEaten(e);
      });

      // Deaths
      (delta.deaths || []).forEach(d => {
        if (typeof onWormDeath === 'function') onWormDeath(d);
      });

      // Kills
      (delta.kills || []).forEach(k => {
        if (typeof onKill === 'function') onKill(k);
        if (k.killerId === myId) _notify('💀 Eliminated ' + k.victimNick + '! +300 pts');
      });

      // Leaderboard
      if (delta.lb && typeof renderServerLB === 'function') renderServerLB(delta.lb, myId);
    });

    socket.on('game:respawn', ({ id, segs, dir }) => {
      if (serverWorms[id]) { serverWorms[id].segs = segs; serverWorms[id].dir = dir; serverWorms[id].dead = false; }
      if (id === myId && typeof onSelfRespawn === 'function') onSelfRespawn();
    });

    socket.on('game:chat', ({ from, msg }) => _addGameChat(from, msg, false));

    socket.on('game:emoji', ({ id, emoji }) => {
      if (typeof onRemoteEmoji === 'function') onRemoteEmoji(id, emoji);
    });

    socket.on('server:stats', ({ online, rooms: roomCount }) => {
      ['g-online', 'm-online', 'lby-online'].forEach(elId => {
        const el = document.getElementById(elId);
        if (el) el.textContent = Number(online).toLocaleString();
      });
    });
  }

  // ── Input loop ──────────────────────────────────────────────────────────────
  function _startInputLoop() {
    if (inputTimer) clearInterval(inputTimer);
    inputTimer = setInterval(() => {
      if (!connected || !inGame) return;
      const dir      = typeof window._azDir === 'number'      ? window._azDir      : 0;
      const boosting = typeof window._azBoosting === 'boolean' ? window._azBoosting : false;
      socket.emit('game:input', { dir, boosting });
    }, 1000 / INPUT_HZ);
  }

  function _stopInputLoop() {
    if (inputTimer) { clearInterval(inputTimer); inputTimer = null; }
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────

  function _updateConnUI(ok, msg) {
    const dot  = document.getElementById('lby-conn-dot') || document.querySelector('.lby-conn-dot');
    const txt  = document.getElementById('lby-conn-txt') || document.querySelector('.lby-conn-txt');
    const ping = document.getElementById('lpng');
    if (dot)  dot.style.background = ok ? '#10B981' : '#EF4444';
    if (txt)  txt.textContent      = ok ? 'Connected to Action Zone servers' : msg;
    if (ping) ping.textContent     = ok ? (Math.floor(Math.random() * 20) + 8) + 'ms' : '--';
    // Also update top HUD dot
    document.querySelectorAll('.hp-live').forEach(el => {
      el.style.background = ok ? '#10B981' : '#EF4444';
      el.style.boxShadow  = ok ? '0 0 6px #10B981' : '0 0 6px #EF4444';
    });
  }

  function _onRoomReady(room, isCreator) {
    if (typeof window !== 'undefined') window.MY_ROOM = room;
    if (typeof window.lobbyMode !== 'undefined') window.lobbyMode = 'room';
    if (typeof renderRoomBody === 'function') renderRoomBody();
    _notify(isCreator ? '🏠 Room ' + room.code + ' created!' : '✅ Joined room ' + room.code, 'green');
  }

  function _refreshLobbyUI(room) {
    if (typeof window !== 'undefined') window.MY_ROOM = room;
    const pg = document.getElementById('players-grid');
    if (pg && typeof buildPlayerCards === 'function') pg.innerHTML = buildPlayerCards(room);
    // Update settings grid counts
    const settingsVals = document.querySelectorAll('.sg-val');
    // Update player count (3rd item typically)
    if (settingsVals[1]) settingsVals[1].textContent = room.playerCount + ' / ' + room.maxPlayers;
  }

  function _addLobbyChat(from, msg, sys) {
    const c = document.getElementById('lc-msgs');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'lc-msg' + (sys ? ' sys' : '');
    el.innerHTML = '<span class="lcn ' + (sys ? 'sys' : '') + '">' + from + ':</span>' + _esc(msg);
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
  }

  function _addGameChat(from, msg, sys) {
    if (typeof chatMsg === 'function') chatMsg(from, msg, sys);
  }

  function _notify(msg, type) {
    if (typeof notif === 'function') notif(msg, type || 'purple');
    else _log('[NOTIF] ' + msg);
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _log(msg) { console.log('[AZ-MP] ' + msg); }

  // ── Ping display ────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!connected || !socket) return;
    const start = Date.now();
    socket.emit('ping', () => {
      const rtt  = Date.now() - start;
      const ping = document.getElementById('lpng');
      if (ping) {
        ping.textContent = rtt + 'ms';
        ping.style.color = rtt < 60 ? '#10B981' : rtt < 150 ? '#F59E0B' : '#EF4444';
      }
    });
  }, 2000);

  // ════════════════════════════════════════════════════════
  //  PUBLIC API  —  window.AZ
  // ════════════════════════════════════════════════════════
  const AZ = {

    // ── Connection ────────────────────────────────────────
    connect: init,
    isConnected:   ()  => connected,
    getMyId:       ()  => myId,
    getMyRoom:     ()  => currentRoom,

    // ── Room actions ──────────────────────────────────────
    createRoom(nick, skin, mode, maxPlayers, isPrivate) {
      if (!connected) { _notify('Not connected to server', 'red'); return; }
      _savedNick = nick; _savedSkin = skin;
      socket.emit('room:create', { nick, skin, mode, maxPlayers, isPrivate },
        (res) => { if (!res?.ok) _notify('❌ ' + res?.error, 'red'); }
      );
    },

    joinRoom(code, nick, skin) {
      if (!connected) { _notify('Not connected to server', 'red'); return; }
      _savedNick = nick; _savedSkin = skin;
      socket.emit('room:join', { code: code.toUpperCase(), nick, skin },
        (res) => { if (!res?.ok) _notify('❌ ' + (res?.error || 'Could not join room'), 'red'); }
      );
    },

    leaveRoom() {
      socket?.emit('room:leave');
      currentRoom = null; inGame = false;
      _savedCode  = null;
      _stopInputLoop();
    },

    setReady:    (ready) => socket?.emit('room:ready',   { ready }),
    kickPlayer:  (id)    => socket?.emit('room:kick',    { targetId: id }),
    sendLobbyChat: (msg) => socket?.emit('room:chat',    { msg }),
    setMode:     (mode)  => socket?.emit('room:setMode', { mode }),
    startGame:   ()      => socket?.emit('game:start'),

    // ── Game actions ──────────────────────────────────────
    sendInput(dir, boosting) {
      window._azDir      = dir;
      window._azBoosting = boosting;
    },

    sendGameChat: (msg)   => socket?.emit('game:chat',  { msg }),
    sendEmoji:    (emoji) => socket?.emit('game:emoji', { emoji }),

    // ── Interpolation ─────────────────────────────────────
    /** Get smoothed segment positions for a worm at the current render time */
    getInterpolatedSegs(id) {
      const buf = interpBuffers[id];
      if (!buf || buf.length === 0) return serverWorms[id]?.segs || [];
      const target = Date.now() - INTERP_DELAY;
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t > target) i--;
      if (i === 0) return buf[0].segs;
      const a = buf[i - 1], b = buf[i];
      const alpha = Math.min(1, (target - a.t) / Math.max(1, b.t - a.t));
      return a.segs.map((sa, idx) => {
        const sb = b.segs[idx];
        if (!sb) return sa;
        return { x: sa.x + (sb.x - sa.x) * alpha, y: sa.y + (sb.y - sa.y) * alpha };
      });
    },

    getInterpolatedDir(id) {
      const buf = interpBuffers[id];
      if (!buf || buf.length < 2) return serverWorms[id]?.dir || 0;
      const target = Date.now() - INTERP_DELAY;
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t > target) i--;
      if (i === 0) return buf[0].dir;
      const a = buf[i - 1], b = buf[i];
      const alpha = Math.min(1, (target - a.t) / Math.max(1, b.t - a.t));
      let da = b.dir - a.dir;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      return a.dir + da * alpha;
    },

    // ── Data access ───────────────────────────────────────
    getServerWorms:  () => serverWorms,
    getServerFoods:  () => serverFoods,

    // ── Helpers for game loop ─────────────────────────────
    startInputLoop:  _startInputLoop,
    stopInputLoop:   _stopInputLoop,
  };

  global.AZ = AZ;

  // Auto-patch the game's doCreate / doJoin functions when DOM is ready
  function _patchGameFunctions() {
    // Override doCreate → use real server
    if (typeof global.doCreate === 'function') {
      global._origDoCreate = global.doCreate;
      global.doCreate = function () {
        const mode = typeof getNSDVal === 'function' ? getNSDVal('rm-mode') : 'Classic';
        const max  = parseInt(typeof getNSDVal === 'function' ? getNSDVal('rm-max') : '8') || 8;
        const nick = document.getElementById('nick')?.value || 'Player';
        const skin = typeof S !== 'undefined' ? S.skin : 0;
        AZ.createRoom(nick, skin, mode, max, false);
      };
    }

    // Override doJoin → use real server
    if (typeof global.doJoin === 'function') {
      global._origDoJoin = global.doJoin;
      global.doJoin = function (code) {
        const nick = document.getElementById('nick')?.value || 'Player';
        const skin = typeof S !== 'undefined' ? S.skin : 0;
        AZ.joinRoom(code, nick, skin);
      };
    }

    // Override doJoinCode
    if (typeof global.doJoinCode === 'function') {
      global.doJoinCode = function () {
        const code = (document.getElementById('jc')?.value || '').toUpperCase().trim();
        if (code.length < 4) { _notify('Enter a valid 6-character code!', 'red'); return; }
        const nick = document.getElementById('nick')?.value || 'Player';
        const skin = typeof S !== 'undefined' ? S.skin : 0;
        AZ.joinRoom(code, nick, skin);
      };
    }

    // Override startFromLobby → use real server (host only)
    if (typeof global.startFromLobby === 'function') {
      global._origStartFromLobby = global.startFromLobby;
      global.startFromLobby = function () {
        AZ.startGame();
      };
    }

    // Override toggleReady
    if (typeof global.toggleReady === 'function') {
      global._origToggleReady = global.toggleReady;
      global.toggleReady = function () {
        const room = AZ.getMyRoom();
        const me   = room?.players?.find(p => p.id === myId);
        if (me) AZ.setReady(!me.ready);
      };
    }

    // Override sendLobbyMsg → real server
    if (typeof global.sendLobbyMsg === 'function') {
      global.sendLobbyMsg = function () {
        const el  = document.getElementById('lc-in');
        const msg = el?.value.trim();
        if (!msg) return;
        AZ.sendLobbyChat(msg);
        if (el) el.value = '';
      };
    }

    // Override leaveRoom → real server
    if (typeof global.leaveRoom === 'function') {
      global.leaveRoom = function () {
        AZ.leaveRoom();
        if (typeof closeLobby === 'function') closeLobby();
      };
    }

    // Override kickPlayer → real server
    if (typeof global.kickPlayer === 'function') {
      global.kickPlayer = function (id) { AZ.kickPlayer(id); };
    }

    // Override doEmoji → real server
    if (typeof global.doEmoji === 'function') {
      const origEmoji = global.doEmoji;
      global.doEmoji = function (em) {
        origEmoji(em);              // keep local visual
        AZ.sendEmoji(em);           // broadcast to server
      };
    }

    _log('✅ Game functions patched to use real server');
  }

  // Auto-connect and patch once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); setTimeout(_patchGameFunctions, 1000); });
  } else {
    init();
    setTimeout(_patchGameFunctions, 1000);
  }

  _log('Multiplayer client v4.0 loaded — server: ' + SERVER_URL);

})(window);
