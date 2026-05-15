// ─────────────────────────────────────────────────────────────────────────────
//  GAME ENGINE  —  Authoritative server physics at 20 tick / second
// ─────────────────────────────────────────────────────────────────────────────

const { log, clamp, dist2 } = require('./utils');

// ── Constants ─────────────────────────────────────────────────────────────────
const WORLD_W    = 4000;
const WORLD_H    = 4000;
const TICK_MS    = 50;           // 20 Hz
const FOOD_TARGET = 300;
const SEG_GAP    = 8;
const MAX_TURN   = 0.18;         // radians per tick

// ── Helpers ───────────────────────────────────────────────────────────────────
function rnd(lo, hi) { return Math.random() * (hi - lo) + lo; }
function foodRadius(size) { return size === 1 ? 9 : size === 2 ? 14 : size === 3 ? 20 : 30; }
function wormRadius(len)  { return Math.max(6, 7 + len * 0.034); }

function makeFood(count = 1) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const size = roll > 0.93 ? 4 : roll > 0.78 ? 3 : roll > 0.55 ? 2 : 1;
    result.push({
      id:   Math.random().toString(36).slice(2, 9),
      x:    rnd(40, WORLD_W - 40),
      y:    rnd(40, WORLD_H - 40),
      size,
      rare: size === 4,
      val:  size === 1 ? 1 : size === 2 ? 3 : size === 3 ? 8 : 25,
    });
  }
  return result;
}

function freshSegs(x, y, dir) {
  const segs = [];
  for (let i = 0; i < 8; i++) {
    segs.push({ x: x - i * SEG_GAP * Math.cos(dir), y: y - i * SEG_GAP * Math.sin(dir) });
  }
  return segs;
}

// ─────────────────────────────────────────────────────────────────────────────

class GameEngine {
  constructor(roomCode, room, io) {
    this.code   = roomCode;
    this.room   = room;
    this.io     = io;
    this.tick   = 0;
    this._timer = null;
    this.alive  = false;

    this.worms  = {};    // socketId → worm object
    this.foods  = [];    // food objects
    this.inputs = {};    // socketId → { dir, boosting }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    this.alive = true;
    this.foods = makeFood(FOOD_TARGET);
    this.room.getPlayerArray().forEach(p => this._spawnWorm(p));
    this._timer = setInterval(() => this._tick(), TICK_MS);
    log(`▶ Engine started — room ${this.code} — ${Object.keys(this.worms).length} worms`, 'GAME');
  }

  stop() {
    this.alive = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    log(`⏹ Engine stopped — room ${this.code}`, 'GAME');
  }

  // ── Player connects mid-game ───────────────────────────────────────────────

  addLatePlayer(player) {
    if (!this.worms[player.id]) this._spawnWorm(player);
  }

  removePlayer(id) {
    delete this.worms[id];
    delete this.inputs[id];
  }

  // ── Input from client ─────────────────────────────────────────────────────

  setInput(id, dir, boosting) {
    if (!this.worms[id] || this.worms[id].dead) return;
    this.inputs[id] = {
      dir:      typeof dir === 'number' && isFinite(dir) ? dir : (this.worms[id]?.dir || 0),
      boosting: !!boosting,
    };
  }

  // ── Full state for new joiner / reconnect ─────────────────────────────────

  getFullState() {
    return {
      worldW: WORLD_W,
      worldH: WORLD_H,
      tick:   this.tick,
      worms:  this._wormsArray(),
      foods:  this.foods,
    };
  }

  // ── TICK ──────────────────────────────────────────────────────────────────

  _tick() {
    if (!this.alive) return;
    this.tick++;

    const wormArr = Object.values(this.worms);

    // ── 1. Move worms ────────────────────────────────────────────────────────
    wormArr.forEach(w => {
      if (w.dead) return;
      const inp = this.inputs[w.id] || { dir: w.dir, boosting: false };

      // Smooth turning — clamp rotation per tick
      let da = inp.dir - w.dir;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      w.dir += clamp(da, -MAX_TURN, MAX_TURN);

      w.boosting = inp.boosting && w.segs.length > 10;
      const spd  = w.boosting ? 5.4 : 2.6;

      // Push new head
      w.segs.unshift({
        x: w.segs[0].x + Math.cos(w.dir) * spd,
        y: w.segs[0].y + Math.sin(w.dir) * spd,
      });
      w.segs.pop();

      // Boost shrink + food trail
      if (w.boosting && w.segs.length > 12 && Math.random() < 0.3) {
        w.segs.pop();
        if (Math.random() < 0.45) {
          this.foods.push(makeFood(1)[0]); // fast approach: just place near tail later
        }
      }
    });

    // ── 2. Food collection ───────────────────────────────────────────────────
    const eatenIds   = new Set();
    const eatEvents  = [];

    wormArr.forEach(w => {
      if (w.dead) return;
      const wr = wormRadius(w.segs.length) + 2;
      this.foods.forEach(f => {
        if (eatenIds.has(f.id)) return;
        const fr = foodRadius(f.size);
        if (dist2(w.segs[0], f) < (wr + fr) ** 2) {
          eatenIds.add(f.id);
          eatEvents.push({ wormId: w.id, foodId: f.id, val: f.val, rare: f.rare });
          for (let i = 0; i < f.val; i++) w.segs.push({ ...w.segs[w.segs.length - 1] });
          w.score += f.val;
          // Update room player record
          const rp = this.room.getPlayer(w.id);
          if (rp) rp.score = w.score;
        }
      });
    });

    // Remove eaten food
    this.foods = this.foods.filter(f => !eatenIds.has(f.id));
    // Respawn eaten food after a delay
    if (eatenIds.size > 0) {
      setTimeout(() => {
        if (this.alive) this.foods.push(...makeFood(eatenIds.size));
      }, 2000 + Math.random() * 2000);
    }
    // Top up food if under target
    if (this.foods.length < FOOD_TARGET - 20) {
      this.foods.push(...makeFood(5));
    }

    // ── 3. Collision detection ───────────────────────────────────────────────
    const deathEvents = [];
    const killEvents  = [];

    wormArr.forEach(w => {
      if (w.dead) return;
      const head = w.segs[0];

      // Wall collision
      if (head.x < 5 || head.x > WORLD_W - 5 || head.y < 5 || head.y > WORLD_H - 5) {
        this._killWorm(w, null, deathEvents, killEvents);
        return;
      }

      // Body collision with other worms
      for (const other of wormArr) {
        if (other.id === w.id || other.dead) continue;
        const wr = wormRadius(w.segs.length);
        for (let i = 2; i < other.segs.length; i++) {
          if (dist2(head, other.segs[i]) < (wr + wormRadius(other.segs.length) * 0.75) ** 2) {
            this._killWorm(w, other, deathEvents, killEvents);
            break;
          }
        }
        if (w.dead) break;
      }
    });

    // ── 4. Leaderboard ───────────────────────────────────────────────────────
    const lb = wormArr
      .filter(w => !w.dead)
      .sort((a, b) => b.segs.length - a.segs.length)
      .slice(0, 10)
      .map((w, i) => ({
        rank:  i + 1,
        id:    w.id,
        nick:  w.nick,
        skin:  w.skin,
        len:   w.segs.length,
        score: w.score,
        kills: w.kills,
      }));

    // ── 5. Broadcast delta ───────────────────────────────────────────────────
    const delta = {
      t:      this.tick,
      worms:  this._wormsArray(),
      lb,
      eaten:  eatEvents,
      deaths: deathEvents,
      kills:  killEvents,
    };

    // Send full food list every 4 ticks to reduce bandwidth
    if (this.tick % 4 === 0) delta.foods = this.foods;

    this.io.to(this.code).emit('game:tick', delta);
  }

  // ── Kill a worm ───────────────────────────────────────────────────────────

  _killWorm(w, killer, deathArr, killArr) {
    if (w.dead) return;
    w.dead = true;

    // Drop food from corpse
    const drop = Math.max(4, Math.floor(w.segs.length / 4));
    for (let i = 0; i < drop; i++) {
      const seg = w.segs[Math.floor(Math.random() * w.segs.length)];
      this.foods.push({
        id:   Math.random().toString(36).slice(2, 9),
        x:    seg.x + rnd(-25, 25),
        y:    seg.y + rnd(-25, 25),
        size: Math.random() < 0.1 ? 3 : Math.random() < 0.3 ? 2 : 1,
        rare: false,
        val:  1,
      });
    }

    deathArr.push({ id: w.id, killerId: killer?.id || null });

    if (killer) {
      killer.kills++;
      killer.score += 300;
      const rp = this.room.getPlayer(killer.id);
      if (rp) { rp.kills = killer.kills; rp.score = killer.score; }
      killArr.push({ killerId: killer.id, killerNick: killer.nick, victimId: w.id, victimNick: w.nick });
    }

    // Respawn after 4 seconds
    setTimeout(() => {
      if (!this.alive) return;
      w.segs  = freshSegs(rnd(200, WORLD_W - 200), rnd(200, WORLD_H - 200), Math.random() * Math.PI * 2);
      w.dir   = Math.atan2(w.segs[1].y - w.segs[0].y, w.segs[1].x - w.segs[0].x) + Math.PI;
      w.dead  = false;
      w.score = 0;
      this.io.to(this.code).emit('game:respawn', { id: w.id, segs: w.segs, dir: w.dir });
    }, 4000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _spawnWorm(player) {
    const x   = rnd(200, WORLD_W - 200);
    const y   = rnd(200, WORLD_H - 200);
    const dir = Math.random() * Math.PI * 2;
    this.worms[player.id] = {
      id:       player.id,
      nick:     player.nick,
      skin:     player.skin,
      segs:     freshSegs(x, y, dir),
      dir,
      boosting: false,
      dead:     false,
      score:    0,
      kills:    0,
    };
  }

  _wormsArray() {
    return Object.values(this.worms).map(w => ({
      id:       w.id,
      nick:     w.nick,
      skin:     w.skin,
      segs:     w.segs,
      dir:      w.dir,
      boosting: w.boosting,
      dead:     w.dead,
      score:    w.score,
      kills:    w.kills,
    }));
  }
}

module.exports = { GameEngine, WORLD_W, WORLD_H };
