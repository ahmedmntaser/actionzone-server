// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O/1/I)

/**
 * Generate a human-readable 6-character room code.
 */
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  return code;
}

/**
 * Timestamped logger.
 */
function log(msg, level = 'INFO') {
  const ts  = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const pad = level.padEnd(5);
  console.log(`[${ts}] [${pad}] ${msg}`);
}

/**
 * Clamp a number between lo and hi.
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Squared distance between two points (avoids sqrt for perf).
 */
function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Strip HTML-dangerous chars from user input.
 */
function sanitize(str = '', maxLen = 120) {
  return String(str)
    .replace(/[<>"'`]/g, '')
    .trim()
    .slice(0, maxLen);
}

module.exports = { generateRoomCode, log, clamp, dist2, sanitize };
