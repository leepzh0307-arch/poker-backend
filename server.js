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
      config: null
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

  // 5. 翻牌事件（🔥 新增权限校验）
  socket.on('flipCard', (roomId, cardInfo) => {
    const room = rooms[roomId];
    if (!room) return;

    // 权限校验
    const isHost = socket.id === room.host;
    const player = room.players.find(p => p.id === socket.id);
    const isMyCard = player && cardInfo.ownerSeatIndex === player.seatIndex;
    const isCommunityCard = cardInfo.ownerSeatIndex === undefined;

    // 只有房主 或 翻自己的牌/公共牌，才允许广播
    if (isHost || isMyCard || isCommunityCard) {
      io.to(roomId).emit('cardFlipped', cardInfo);
      console.log(`房间${roomId}卡牌${cardInfo.cardId}翻牌同步成功`);
    } else {
      socket.emit('error', '你没有权限翻这张牌！');
      console.log(`玩家${socket.id}尝试无权限翻牌，已拦截`);
    }
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