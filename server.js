const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

// 存储房间信息
const rooms = {};

io.on('connection', (socket) => {
  console.log(`玩家连接成功，ID：${socket.id}`);

  // 1. 创建房间
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = {
      players: [{ id: socket.id, seatIndex: 0 }],
      host: socket.id,
      gameState: null,
      config: null,
      votes: {}, // 新增：投票状态
      votingActive: false // 新增：是否正在投票
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId: roomId });
    console.log(`房间${roomId}创建成功，房主ID：${socket.id}`);
  });

  // 2. 加入房间
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

  // 3. 房主同步游戏配置
  socket.on('syncConfig', (roomId, config) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.config = config;
    io.to(roomId).emit('syncConfig', config);
    console.log(`房间${roomId}配置已同步`);
  });

  // 4. 同步牌局状态
  socket.on('updateGameState', (roomId, newState) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    room.gameState = newState;
    io.to(roomId).emit('syncGameState', newState);
  });

  // 5. 翻牌事件
  socket.on('flipCard', (roomId, cardInfo) => {
    const room = rooms[roomId];
    if (!room) return;

    const isHost = socket.id === room.host;
    const player = room.players.find(p => p.id === socket.id);
    const isMyCard = player && cardInfo.ownerSeatIndex === player.seatIndex;
    const isCommunityCard = cardInfo.ownerSeatIndex === undefined;

    if (isHost || isMyCard || isCommunityCard) {
      io.to(roomId).emit('cardFlipped', cardInfo);
      console.log(`房间${roomId}卡牌${cardInfo.cardId}翻牌同步成功`);
    } else {
      socket.emit('error', '你没有权限翻这张牌！');
      console.log(`玩家${socket.id}尝试无权限翻牌，已拦截`);
    }
  });

  // --- 新功能1：投票系统 ---
  socket.on('startVote', (roomId) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    if (room.votingActive) {
      socket.emit('error', '当前已有投票进行中');
      return;
    }

    room.votingActive = true;
    room.votes = {};
    io.to(roomId).emit('voteStarted');
    console.log(`房间${roomId}投票已发起`);
  });

  socket.on('submitVote', (roomId, voteInfo) => {
    const room = rooms[roomId];
    if (!room || !room.votingActive) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // 记录投票
    room.votes[player.seatIndex] = voteInfo.approved;
    console.log(`房间${roomId}玩家${player.seatIndex}投票：${voteInfo.approved ? '同意' : '拒绝'}`);

    // 检查是否所有玩家都投票了
    if (Object.keys(room.votes).length >= room.players.length) {
      finishVote(roomId);
    }
  });

  function finishVote(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // 统计同意的玩家
    const approvedSeats = Object.keys(room.votes).filter(seat => room.votes[seat]).map(Number);
    const approved = approvedSeats.length > 0;

    room.votingActive = false;
    io.to(roomId).emit('voteResult', { approved: approved, approvedSeats: approvedSeats });

    // 如果投票通过，公布同意的玩家手牌
    if (approved && room.gameState && room.gameState.dealtCards) {
      room.gameState.dealtCards.forEach(card => {
        if (!card.isCommunity && approvedSeats.includes(card.ownerSeatIndex)) {
          card.isFlipped = true;
          io.to(roomId).emit('cardFlipped', { cardId: card.cardId });
        }
      });
      // 更新牌局状态
      io.to(roomId).emit('syncGameState', room.gameState);
    }

    console.log(`房间${roomId}投票结束，结果：${approved ? '通过' : '未通过'}`);
  }

  // --- 新功能2：卡牌移动 ---
  socket.on('moveCard', (roomId, moveInfo) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;

    // 更新牌局状态
    if (room.gameState && room.gameState.dealtCards) {
      const cardIndex = room.gameState.dealtCards.findIndex(card => card.cardId === moveInfo.cardId);
      if (cardIndex !== -1) {
        room.gameState.dealtCards[cardIndex].targetId = moveInfo.targetId;
        room.gameState.dealtCards[cardIndex].isCommunity = moveInfo.isCommunity;
        room.gameState.dealtCards[cardIndex].ownerSeatIndex = moveInfo.ownerSeatIndex;
      }
    }

    // 同步给所有人
    io.to(roomId).emit('cardMoved', moveInfo);
    console.log(`房间${roomId}卡牌移动：${moveInfo.cardId} -> ${moveInfo.targetId}`);
  });

  // 玩家断开连接
  socket.on('disconnect', () => {
    console.log(`玩家${socket.id}断开连接`);
  });
});

// 启动服务
server.listen(PORT, () => {
  console.log(`✅ 后端服务已启动！运行端口：${PORT}`);
});