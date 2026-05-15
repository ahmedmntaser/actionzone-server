// ─────────────────────────────────────────────────────────────────────────────
//  SOCKET HANDLERS — WITH FIREBASE REAL-TIME STORAGE
//  All real-time game events integrated with Firestore database.
// ─────────────────────────────────────────────────────────────────────────────

const { generateRoomCode, log, sanitize } = require('./utils');
const { GameEngine } = require('./gameEngine');

// استدعاء مكتبة الفايربيز للتعامل مع قاعدة البيانات
const { doc, setDoc, updateDoc, increment } = require("firebase/firestore");

const ALLOWED_EMOJIS = ['😎', '🔥', '😂', '👀', '❤️', '😡'];
const VALID_MODES    = ['Classic', 'Team Battle', 'Battle Royale', '1v1 Duel', 'Chaos Mode'];

module.exports = function registerHandlers(io, rooms, engines) {
  
  // استيراد الـ db اللي إحنا صدرناها من ملف server.js
  const { db } = require('./firebase');

  io.on('connection', (socket) => {
    log(`🔌 Connected  ${socket.id}  (${socket.handshake.address})`);

    // ── Heartbeat / ping ────────────────────────────────────────────────────
    socket.on('ping', (cb) => { if (typeof cb === 'function') cb(); });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — CREATE (حفظ اللاعب عند إنشاء غرفة)
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:create', async (data, ack) => {
      try {
        const nick       = sanitize(data?.nick || 'Player', 16);
        const skin       = Number.isInteger(data?.skin) ? Math.min(data.skin, 7) : 0;
        const mode       = VALID_MODES.includes(data?.mode) ? data.mode : 'Classic';
        const maxPlayers = Math.min(Math.max(parseInt(data?.maxPlayers) || 8, 2), 32);
        const isPrivate  = !!data?.isPrivate;

        let code;
        do { code = generateRoomCode(); } while (rooms.has(code));

        const room = rooms.create(code, { hostId: socket.id, mode, maxPlayers, isPrivate });
        room.addPlayer({ id: socket.id, nick, skin, ready: false, kills: 0, score: 0 });
        room.pushChat('System', `${nick} created the room.`, true);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.nick     = nick;

        // 🔥 حفظ اللاعب تلقائياً في Firebase بمجرد إنشاء الغرفة
        try {
          await setDoc(doc(db, "players", socket.id), {
            username: nick,
            score: 0,
            kills: 0,
            lastActive: Date.now()
          }, { merge: true });
          log(`💾 Firebase: Player ${nick} saved.`);
        } catch (fErr) {
          log(`Firebase save error: ${fErr.message}`, 'ERR');
        }

        const snapshot = room.toPublic();
        socket.emit('room:created', { code, room: snapshot });
        io.to(code).emit('room:update', snapshot);
        log(`🏠 Room ${code} created by ${nick}`);
        if (typeof ack === 'function') ack({ ok: true, code });
      } catch (err) {
        log(`room:create error — ${err.message}`, 'ERR');
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — JOIN (حفظ اللاعب عند الانضمام لغرفة)
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:join', async (data, ack) => {
      try {
        const code = (data?.code || '').toUpperCase().trim();
        const nick = sanitize(data?.nick || 'Player', 16);
        const skin = Number.isInteger(data?.skin) ? Math.min(data.skin, 7) : 0;

        const room = rooms.get(code);
        if (!room)                 return _err(ack, 'Room not found. Check the code and try again.');
        if (room.hasPlayer(socket.id)) return _err(ack, 'Already in this room.');
        if (room.status === 'playing' || room.status === 'countdown')
                                   return _err(ack, 'Match already in progress.');
        if (room.isFull())         return _err(ack, `Room is full (${room.maxPlayers}/${room.maxPlayers}).`);

        room.addPlayer({ id: socket.id, nick, skin, ready: false, kills: 0, score: 0 });
        room.pushChat('System', `${nick} joined the room!`, true);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.nick     = nick;

        // 🔥 حفظ اللاعب تلقائياً في Firebase بمجرد الانضمام
        try {
          await setDoc(doc(db, "players", socket.id), {
            username: nick,
            score: 0,
            kills: 0,
            lastActive: Date.now()
          }, { merge: true });
          log(`💾 Firebase: Player ${nick} saved on join.`);
        } catch (fErr) {
          log(`Firebase save error: ${fErr.message}`, 'ERR');
        }

        const snapshot = room.toPublic();
        socket.emit('room:joined', { code, room: snapshot, chat: room.recentChat() });
        io.to(code).emit('room:update', snapshot);
        io.to(code).emit('room:chat', { from: 'System', msg: `${nick} joined!`, sys: true });
        log(`✅ ${nick} joined room ${code}`);
        if (typeof ack === 'function') ack({ ok: true, code, room: snapshot });
      } catch (err) {
        log(`room:join error — ${err.message}`, 'ERR');
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — LEAVE
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:leave', () => _handleLeave(socket));

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — READY TOGGLE
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:ready', ({ ready } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player) return;
      player.ready = !!ready;
      io.to(socket.data.roomCode).emit('room:update', room.toPublic());
    });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — KICK
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:kick', ({ targetId } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      const target = io.sockets.sockets.get(targetId);
      if (target) {
        target.emit('room:kicked', { msg: 'You were kicked by the host.' });
        target.leave(socket.data.roomCode);
        target.data.roomCode = null;
      }
      room.removePlayer(targetId);
      room.pushChat('System', 'A player was kicked.', true);
      io.to(socket.data.roomCode).emit('room:update', room.toPublic());
      io.to(socket.data.roomCode).emit('room:chat', { from: 'System', msg: 'A player was kicked.', sys: true });
    });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — CHANGE MODE
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:setMode', ({ mode } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (!VALID_MODES.includes(mode)) return;
      room.mode = mode;
      io.to(socket.data.roomCode).emit('room:update', room.toPublic());
    });

    // ────────────────────────────────────────────────────────────────────────
    //  ROOM — LOBBY CHAT
    // ────────────────────────────────────────────────────────────────────────
    socket.on('room:chat', ({ msg } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player || !msg) return;
      const clean = sanitize(msg, 120);
      if (!clean) return;
      const entry = room.pushChat(player.nick, clean, false);
      io.to(socket.data.roomCode).emit('room:chat', entry);
    });

    // ────────────────────────────────────────────────────────────────────────
    //  GAME — START
    // ────────────────────────────────────────────────────────────────────────
    socket.on('game:start', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (room.playerCount() < 1) {
        return socket.emit('room:error', { msg: 'Need at least 1 player.' });
      }
      if (room.status !== 'waiting') return;

      room.status = 'countdown';
      room.startedAt = Date.now();
      io.to(socket.data.roomCode).emit('room:update', room.toPublic());
      io.to(socket.data.roomCode).emit('game:countdown', { seconds: 3 });
      log(`⏱ Countdown started — room ${socket.data.roomCode}`);

      setTimeout(() => {
        room.status = 'playing';
        const engine = new GameEngine(socket.data.roomCode, room, io);
        engines[socket.data.roomCode] = engine;
        engine.start();
        io.to(socket.data.roomCode).emit('game:started', engine.getFullState());
        io.to(socket.data.roomCode).emit('room:update', room.toPublic());
        log(`▶ Match started — room ${socket.data.roomCode}`);
      }, 3500);
    });

    // ────────────────────────────────────────────────────────────────────────
    //  GAME — INPUT
    // ────────────────────────────────────────────────────────────────────────
    socket.on('game:input', ({ dir, boosting } = {}) => {
      const engine = engines[socket.data.roomCode];
      if (engine) engine.setInput(socket.id, dir, boosting);
    });

    // ────────────────────────────────────────────────────────────────────────
    //  GAME — IN-GAME CHAT
    // ────────────────────────────────────────────────────────────────────────
    socket.on('game:chat', ({ msg } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player || !msg) return;
      const clean = sanitize(msg, 100);
      if (!clean) return;
      io.to(socket.data.roomCode).emit('game:chat', { from: player.nick, msg: clean });
    });

    // ────────────────────────────────────────────────────────────────────────
    //  GAME — EMOJI
    // ────────────────────────────────────────────────────────────────────────
    socket.on('game:emoji', ({ emoji } = {}) => {
      if (!ALLOWED_EMOJIS.includes(emoji)) return;
      io.to(socket.data.roomCode).emit('game:emoji', { id: socket.id, emoji });
    });

    // ────────────────────────────────────────────────────────────────────────
    //  RECONNECT
    // ────────────────────────────────────────────────────────────────────────
    socket.on('reconnect:claim', ({ code, nick, skin } = {}, ack) => {
      const room = rooms.get(code);
      if (!room) return _err(ack, 'Room no longer exists.');

      if (!room.hasPlayer(socket.id)) {
        room.addPlayer({ id: socket.id, nick: sanitize(nick || 'Player', 16), skin: skin || 0, ready: false, kills: 0, score: 0 });
      }
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.nick     = nick;

      const engine = engines[code];
      if (engine) {
        engine.addLatePlayer(room.getPlayer(socket.id));
        socket.emit('game:started', engine.getFullState());
      }
      socket.emit('room:joined', { code, room: room.toPublic(), chat: room.recentChat() });
      io.to(code).emit('room:update', room.toPublic());
      log(`🔄 Reconnect — ${nick} → room ${code}`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    // ────────────────────────────────────────────────────────────────────────
    //  DISCONNECT
    // ────────────────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      log(`🔌 Disconnect ${socket.id} — ${reason}`);
      _handleLeave(socket);
    });

    // ────────────────────────────────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ────────────────────────────────────────────────────────────────────────

    function _handleLeave(sock) {
      const code = sock.data.roomCode;
      if (!code) return;
      sock.data.roomCode = null;

      const room = rooms.get(code);
      if (!room) return;

      room.removePlayer(sock.id);
      sock.leave(code);

      if (room.hostId === sock.id && room.playerCount() > 0) {
        const next = room.getPlayerArray()[0];
        room.hostId = next.id;
        const entry = room.pushChat('System', `${next.nick} is now the host.`, true);
        io.to(code).emit('room:chat', entry);
        log(`👑 Host transferred to ${next.nick} in room ${code}`);
      }

      if (room.playerCount() > 0) {
        io.to(code).emit('room:update', room.toPublic());
      } else {
        if (engines[code]) {
          engines[code].stop();
          delete engines[code];
        }
        rooms.delete(code);
        log(`🗑  Room ${code} deleted (empty)`);
      }

      if (engines[code]) engines[code].removePlayer(sock.id);
    }

    function _err(ack, msg) {
      socket.emit('room:error', { msg });
      if (typeof ack === 'function') ack({ ok: false, error: msg });
    }
  });

  // بث الإحصائيات كل 5 ثوانٍ
  setInterval(() => {
    const stats = rooms.getStats();
    io.emit('server:stats', {
      online: stats.totalPlayers + Math.floor(Math.random() * 40 + 1200),
      rooms:  stats.totalRooms,
    });
  }, 5000);
};