const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
// 公网部署必须用平台分配的端口，本地默认3001
const PORT = process.env.PORT || 3001;

// 创建HTTP服务
const server = http.createServer(app);
// 初始化Socket.io，适配公网跨域
const io = new Server(server, {
  cors: {
    origin: "*", // 允许所有前端地址访问，部署用
    methods: ["GET", "POST"]
  }
});

// 存储房间信息
const rooms = {};

// Socket连接核心逻辑
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

    // 分配座位号
    const newSeatIndex = room.players.length;
    room.players.push({ id: socket.id, seatIndex: newSeatIndex });
    socket.join(roomId);

    // 通知加入者
    socket.emit('playerJoined', { 
      mySeatIndex: newSeatIndex,
      count: room.players.length
    });

    // 通知房主
    io.to(room.host).emit('playerJoined', { count: room.players.length });

    // 同步已有配置和牌局状态
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

  // 5. 同步翻牌动作
  socket.on('flipCard', (roomId, cardInfo) => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('cardFlipped', cardInfo);
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