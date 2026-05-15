// ─────────────────────────────────────────────────────────────────────────────
//  ROOM MANAGER
//  Handles all room create / join / leave / list operations.
// ─────────────────────────────────────────────────────────────────────────────

const { log } = require('./utils');

const VALID_MODES = ['Classic', 'Team Battle', 'Battle Royale', '1v1 Duel', 'Chaos Mode'];

// ─── Room class ──────────────────────────────────────────────────────────────

class Room {
  constructor(code, opts = {}) {
    this.code        = code;
    this.hostId      = opts.hostId;
    this.mode        = VALID_MODES.includes(opts.mode) ? opts.mode : 'Classic';
    this.maxPlayers  = Math.min(Math.max(opts.maxPlayers || 8, 2), 32);
    this.isPrivate   = !!opts.isPrivate;
    this.status      = 'waiting';   // 'waiting' | 'countdown' | 'playing' | 'ended'
    this.players     = new Map();   // socketId → PlayerData
    this.chat        = [];
    this.createdAt   = Date.now();
    this.startedAt   = null;
  }

  // ── Players ────────────────────────────────────────────────────────────────

  addPlayer(player) {
    this.players.set(player.id, player);
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  hasPlayer(id) {
    return this.players.has(id);
  }

  isFull() {
    return this.players.size >= this.maxPlayers;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  playerCount() {
    return this.players.size;
  }

  readyCount() {
    let n = 0;
    this.players.forEach(p => { if (p.ready) n++; });
    return n;
  }

  getPlayerArray() {
    return Array.from(this.players.values());
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Full snapshot sent to everyone in the room */
  toPublic() {
    return {
      code:        this.code,
      hostId:      this.hostId,
      mode:        this.mode,
      maxPlayers:  this.maxPlayers,
      isPrivate:   this.isPrivate,
      status:      this.status,
      playerCount: this.playerCount(),
      readyCount:  this.readyCount(),
      players:     this.getPlayerArray().map(p => ({
        id:     p.id,
        nick:   p.nick,
        skin:   p.skin,
        ready:  p.ready,
        isHost: p.id === this.hostId,
        kills:  p.kills  || 0,
        score:  p.score  || 0,
      })),
      createdAt: this.createdAt,
    };
  }

  /** Minimal row for the browse list */
  toBrowseRow() {
    return {
      code:        this.code,
      mode:        this.mode,
      host:        this.getPlayer(this.hostId)?.nick || '?',
      playerCount: this.playerCount(),
      maxPlayers:  this.maxPlayers,
      status:      this.status,
    };
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  pushChat(from, msg, sys = false) {
    const entry = { from, msg, sys, ts: Date.now() };
    this.chat.push(entry);
    if (this.chat.length > 200) this.chat.shift();
    return entry;
  }

  recentChat(n = 30) {
    return this.chat.slice(-n);
  }
}

// ─── RoomManager ─────────────────────────────────────────────────────────────

class RoomManager {
  constructor() {
    this._rooms = new Map(); // code → Room

    // Garbage-collect stale rooms every 3 minutes
    setInterval(() => this._gc(), 180_000);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  create(code, opts) {
    const room = new Room(code, opts);
    this._rooms.set(code, room);
    return room;
  }

  get(code) {
    return this._rooms.get(code) || null;
  }

  delete(code) {
    this._rooms.delete(code);
  }

  has(code) {
    return this._rooms.has(code);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  count() {
    return this._rooms.size;
  }

  totalPlayers() {
    let n = 0;
    this._rooms.forEach(r => (n += r.playerCount()));
    return n;
  }

  getStats() {
    let waiting = 0, playing = 0, ended = 0;
    this._rooms.forEach(r => {
      if (r.status === 'playing' || r.status === 'countdown') playing++;
      else if (r.status === 'ended') ended++;
      else waiting++;
    });
    return { totalRooms: this._rooms.size, waiting, playing, ended, totalPlayers: this.totalPlayers() };
  }

  // ── Browse ─────────────────────────────────────────────────────────────────

  getPublicList(limit = 20) {
    const list = [];
    this._rooms.forEach(r => {
      if (!r.isPrivate && r.status !== 'ended') list.push(r.toBrowseRow());
    });
    return list.slice(0, limit);
  }

  // ── Garbage collect ────────────────────────────────────────────────────────

  _gc() {
    const now   = Date.now();
    const limit = 90 * 60 * 1000; // 90 min
    let   count = 0;
    this._rooms.forEach((room, code) => {
      if (room.isEmpty() || now - room.createdAt > limit) {
        this._rooms.delete(code);
        count++;
      }
    });
    if (count > 0) log(`GC removed ${count} stale room(s). Active: ${this._rooms.size}`, 'GC');
  }
}

module.exports = { RoomManager, Room };
