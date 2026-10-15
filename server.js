const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_WIDTH = 15000;
const WORLD_HEIGHT = 11250;

const rooms = {};

function getShipCircles(ship) {
  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  return [
    { x: ship.x, y: ship.y, r: 50 },
    { x: ship.x + cos * 60, y: ship.y + sin * 60, r: 40 },
    { x: ship.x - cos * 60, y: ship.y - sin * 60, r: 40 }
  ];
}

function checkShipIslandCollision(ship, islands) {
  const circles = getShipCircles(ship);
  for (let isl of islands) {
    for (let c of circles) {
      if (Math.hypot(c.x - isl.x, c.y - isl.y) < isl.radius + c.r) {
        return true;
      }
    }
  }
  return false;
}

function checkShipShipCollision(shipA, shipB) {
  const circlesA = getShipCircles(shipA);
  const circlesB = getShipCircles(shipB);
  for (let ca of circlesA) {
    for (let cb of circlesB) {
      if (Math.hypot(ca.x - cb.x, ca.y - cb.y) < ca.r + cb.r) {
        return true;
      }
    }
  }
  return false;
}

function createInitialRoomState(isCpuMode = false) {
  const islands = [
    { id: 'town', x: 7500, y: 5625, radius: 1200, isTown: true, name: '🥔 ポテト港町' },
    { id: 1, x: 3500, y: 3000, radius: 600, wood: 6, hasSpecialAmmo: true, ammoType: 2 },
    { id: 2, x: 11500, y: 3000, radius: 600, wood: 6, hasSpecialAmmo: true, ammoType: 3 },
    { id: 3, x: 3500, y: 8500, radius: 750, wood: 8, hasSpecialAmmo: true, ammoType: 2 }
  ];

  const ships = {
    red: {
      id: 'red',
      name: 'レッドポテト号',
      color: '#e74c3c',
      x: 7500,
      y: 7800, // 港町の外の安全な海上に配置
      angle: 0,
      speed: 0,
      maxSpeed: 6.5,
      hp: 100,
      maxHp: 100,
      wood: 0,
      coins: 100,
      powerLevel: 1,
      ammo: { 1: 15, 2: 5, 3: 5 },
      leftCooldown: 0,
      rightCooldown: 0,
      helmsman: null,
      cannons: [
        { id: 'red_l1', side: 'left', offsetRelX: 0, offsetRelY: -50, gunner: null },
        { id: 'red_r1', side: 'right', offsetRelX: 0, offsetRelY: 50, gunner: null },
        { id: 'red_l2', side: 'left', offsetRelX: -60, offsetRelY: -50, gunner: null },
        { id: 'red_r2', side: 'right', offsetRelX: -60, offsetRelY: 50, gunner: null }
      ],
      watcher: null,
      isCpu: false
    }
  };

  if (isCpuMode) {
    const cpuPositions = [
      { x: 3000, y: 3000 }, { x: 12000, y: 3000 },
      { x: 2500, y: 9000 }, { x: 12500, y: 9000 }
    ];
    for (let i = 0; i < 4; i++) {
      const cpuId = `cpu${i + 1}`;
      ships[cpuId] = {
        id: cpuId,
        name: `海賊CPU #${i + 1}`,
        color: '#3498db',
        x: cpuPositions[i].x,
        y: cpuPositions[i].y,
        angle: Math.PI,
        speed: 0,
        maxSpeed: 5.6,
        hp: 50,
        maxHp: 50,
        wood: 0,
        coins: 0,
        ammo: { 1: 50, 2: 2, 3: 2 },
        leftCooldown: 0,
        rightCooldown: 0,
        helmsman: null,
        cannons: [],
        watcher: null,
        isCpu: true
      };
    }
  }

  return {
    status: 'waiting',
    isCpuMode: isCpuMode,
    ships: ships,
    players: {},
    islands: islands,
    potatoes: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      x: Math.random() * (WORLD_WIDTH - 1000) + 500,
      y: Math.random() * (WORLD_HEIGHT - 1000) + 500,
      collected: false
    })),
    cannonBalls: []
  };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, playerName, bodyColor, isCpu }) => {
    if (!roomCode || roomCode.length !== 4) return;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!rooms[roomCode]) {
      rooms[roomCode] = createInitialRoomState(isCpu);
    } else if (isCpu) {
      rooms[roomCode].isCpuMode = true;
    }
    const room = rooms[roomCode];
    const ship = room.ships['red'];

    room.players[socket.id] = {
      id: socket.id,
      team: 'red',
      x: ship.x,
      y: ship.y,
      role: 'free',
      activeCannonId: null,
      name: playerName || 'ポテト船長',
      bodyColor: bodyColor || '#e67e22',
      ready: false
    };

    io.to(roomCode).emit('lobbyUpdate', { players: room.players, status: room.status, roomCode });
  });

  socket.on('changeColor', (color) => {
    const room = rooms[socket.roomCode];
    if (room && room.players[socket.id]) {
      room.players[socket.id].bodyColor = color;
      io.to(socket.roomCode).emit('lobbyUpdate', { players: room.players, status: room.status, roomCode: socket.roomCode });
    }
  });

  socket.on('toggleReady', () => {
    const room = rooms[socket.roomCode];
    if (room && room.status === 'waiting' && room.players[socket.id]) {
      room.players[socket.id].ready = !room.players[socket.id].ready;
      io.to(socket.roomCode).emit('lobbyUpdate', { players: room.players, status: room.status, roomCode: socket.roomCode });
    }
  });

  socket.on('startGame', ({ roomCode }) => {
    const code = roomCode || socket.roomCode;
    const room = rooms[code];
    if (room) {
      room.status = 'playing';
      for (let id in room.players) {
        let p = room.players[id];
        let ship = room.ships[p.team];
        p.x = ship.x;
        p.y = ship.y;
        p.role = 'free';
        p.activeCannonId = null;
      }

      io.to(code).emit('gameStart', { 
        players: room.players, 
        ships: room.ships, 
        islands: room.islands, 
        potatoes: room.potatoes,
        roomCode: code
      });
    }
  });

  socket.on('playerMove', (data) => {
    const room = rooms[socket.roomCode];
    if (room && room.status === 'playing' && room.players[socket.id]) {
      const p = room.players[socket.id];
      if (p.role === 'free') {
        p.x = data.x;
        p.y = data.y;
        socket.to(socket.roomCode
