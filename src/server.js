// ─────────────────────────────────────────────────────────────────────────────
//  ACTION ZONE — MULTIPLAYER SERVER
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');

const { RoomManager }      = require('./roomManager');
const registerHandlers    = require('./socketHandlers');
const { log }              = require('./utils');

const app    = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PORT        = parseInt(process.env.PORT || '3000', 10);

const io = new Server(server, {
  cors: {
    origin:  CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
  pingTimeout:  20000,
  pingInterval: 10000,
  transports: ['websocket', 'polling'],
  perMessageDeflate: {
    threshold: 1024,
  },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (_, res) => {
  res.json({
    status:  'ok',
    uptime:  process.uptime(),
    rooms:   rooms.count(),
    players: rooms.totalPlayers(),
    ts:      new Date().toISOString(),
  });
});

app.get('/rooms', (_, res) => {
  res.json(rooms.getPublicList());
});

app.get('/stats', (_, res) => {
  res.json(rooms.getStats());
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Action Zone API is running.' });
  }
});

const rooms   = new RoomManager();
const engines = {};

registerHandlers(io, rooms, engines);

server.listen(PORT, '0.0.0.0', () => {
  log(`🚀 Action Zone Server — port ${PORT}`);
  log(`🌐 Health check: http://localhost:${PORT}/health`);
  log(`📋 Room list:    http://localhost:${PORT}/rooms`);
});

process.on('SIGTERM', () => {
  log('SIGTERM received — shutting down gracefully');
  server.close(() => { log('Server closed'); process.exit(0); });
});

module.exports = { app, server, io };