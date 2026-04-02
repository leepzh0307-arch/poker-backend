const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const APP_ID = 'b36db247620e4c78a58d146a3c602f93';
const APP_CERTIFICATE = '6a900e035ae949b396dca185d08c632';

app.get('/agora-token', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: '缺少频道名 channelName' });
  }

  const uid = 0; 
  const role = RtcRole.PUBLISHER; 
  const expireTime = 86400;
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpireTime
    );
    res.json({ token: token });
  } catch (err) {
    console.error('Token生成失败:', err);
    res.status(500).json({ error: 'Token生成失败' });
  }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`玩家连接成功，ID：${socket.id}`);

  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = {
      players: [{ id: socket.id, seatIndex: 0 }],
      host: socket.id,
      gameState: null,
      config: null,
      votes: {}, 
      votingActive: false 
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId: roomId });
    console.log(`房间${roomId}创建成功，房主ID：${socket.id}`);
  });

  socket.on('joinRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', '房间不存在！');
      return;
    }

    const newSeatIndex = room.players.length;
    room.players.push({ id: socket.id, seatIndex: newSeatIndex });
    socket.join(roomId);

    socket.emit('playerJoined', { 
      mySeatIndex: newSeatIndex,
      count: room.players.length
    });

    io.to(room.host).emit('playerJoined', { count: room.players.length });

    if (room.config) socket.emit('syncConfig', room.config);
    if (room.gameState) socket.emit('syncGameState', room.gameState);
    
    console.log(`玩家${socket.id}加入房间${roomId}，座位号：${newSeatIndex}`);
  });

  socket.on('syncConfig', (roomId, config) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.config = config;
    io.to(roomId).emit('syncConfig', config);
  });

  socket.on('updateGameState', (roomId, newState) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.gameState = newState;
    io.to(roomId).emit('syncGameState', newState);
  });

  socket.on('flipCard', (roomId, cardInfo) => {
    const room = rooms[roomId];
    if (!room) return;
    
    if (room.gameState && room.gameState.dealtCards) {
      const card = room.gameState.dealtCards.find(c => c.cardId === cardInfo.cardId);
      if (card) card.isFlipped = true;
    }
    
    io.to(roomId).emit('cardFlipped', cardInfo);
  });

  socket.on('moveCard', (roomId, moveInfo) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;

    if (room.gameState && room.gameState.dealtCards) {
      const cardIndex = room.gameState.dealtCards.findIndex(card => card.cardId === moveInfo.cardId);
      if (cardIndex !== -1) {
        room.gameState.dealtCards[cardIndex].targetId = moveInfo.targetId;
        room.gameState.dealtCards[cardIndex].isCommunity = moveInfo.isCommunity;
        room.gameState.dealtCards[cardIndex].ownerSeatIndex = moveInfo.ownerSeatIndex;
        room.gameState.dealtCards[cardIndex].isFlipped = true;
      }
    }
    io.to(roomId).emit('cardMoved', moveInfo);
  });

  socket.on('startVote', (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.votingActive = true;
    room.votes = {};
    io.to(roomId).emit('voteStarted');
  });

  socket.on('submitVote', (roomId, voteInfo) => {
    const room = rooms[roomId];
    if (!room || !room.votingActive) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.votes[player.seatIndex] = voteInfo.approved;

    if (Object.keys(room.votes).length >= room.players.length) {
      finishVote(roomId);
    }
  });

  function finishVote(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const approvedSeats = Object.keys(room.votes).filter(seat => room.votes[seat]).map(Number);
    const approved = approvedSeats.length > 0;

    room.votingActive = false;
    io.to(roomId).emit('voteResult', { approved: approved, approvedSeats: approvedSeats });

    if (approved && room.gameState && room.gameState.dealtCards) {
      room.gameState.dealtCards.forEach(card => {
        if (!card.isCommunity && approvedSeats.includes(card.ownerSeatIndex)) {
          card.isFlipped = true;
          io.to(roomId).emit('cardFlipped', { cardId: card.cardId });
        }
      });
      io.to(roomId).emit('syncGameState', room.gameState);
    }
    console.log(`房间${roomId}投票结束，结果：${approved ? '通过' : '未通过'}`);
  }

  socket.on('disconnect', () => {
    console.log(`玩家断开连接：${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ 后端服务已启动！运行端口：${PORT}`);
  console.log(`⚠️  请确保已运行: npm install agora-access-token`);
});