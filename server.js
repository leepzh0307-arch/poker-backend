const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const APP_ID = 'b36db247620e4c78a58d146a3c602f93';
const APP_CERTIFICATE = '6a900e035ae949b396dca185d08c632a';

app.get('/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) return res.status(400).json({ error: '缺少频道名' });
  const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, 0, RtcRole.PUBLISHER, Math.floor(Date.now() / 1000) + 86400);
  res.json({ token });
});

const rooms = {};

io.on('connection', (socket) => {
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = { players: [{ id: socket.id, seatIndex: 0 }], host: socket.id, gameState: { deck: [], dealtCards: [] } };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', '房间不存在');
    const seatIndex = room.players.length;
    room.players.push({ id: socket.id, seatIndex });
    socket.join(roomId);
    socket.emit('playerJoined', { mySeatIndex: seatIndex, count: room.players.length });
    io.to(room.host).emit('playerJoined', { count: room.players.length });
    if (room.gameState) socket.emit('syncGameState', room.gameState);
  });

  socket.on('updateGameState', (roomId, newState) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.gameState = newState;
    io.to(roomId).emit('syncGameState', newState);
  });

  socket.on('flipCard', (roomId, cardInfo) => {
    io.to(roomId).emit('cardFlipped', cardInfo);
  });

  socket.on('disconnect', () => { /* 简单处理断开 */ });
});

server.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));