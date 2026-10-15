const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_WIDTH = 6000;
const WORLD_HEIGHT = 4500;

// ルームごとのゲームデータを管理
const rooms = {};

function createInitialRoomState() {
  return {
    ships: {
      red: {
        id: 'red',
        name: 'レッドポテト号',
        color: '#e74c3c',
        x: 1500,
        y: 2250,
        angle: 0,
        speed: 0,
        maxSpeed: 6.5,
        hp: 100,
        cannonAmmo: 15,
        helmsman: null,
        cannons: [
          { id: 'red_l1', side: 'left', offsetRelX: 0, offsetRelY: -65, gunner: null },
          { id: 'red_r1', side: 'right', offsetRelX: 0, offsetRelY: 65, gunner: null },
          { id: 'red_l2', side: 'left', offsetRelX: -80, offsetRelY: -65, gunner: null },
          { id: 'red_r2', side: 'right', offsetRelX: -80, offsetRelY: 65, gunner: null }
        ],
        watcher: null
      },
      blue: {
        id: 'blue',
        name: 'ブルーマッシュ号',
        color: '#3498db',
        x: 4500,
        y: 2250,
        angle: Math.PI,
        speed: 0,
        maxSpeed: 6.5,
        hp: 100,
        cannonAmmo: 15,
        helmsman: null,
        cannons: [
          { id: 'blue_l1', side: 'left', offsetRelX: 0, offsetRelY: -65, gunner: null },
          { id: 'blue_r1', side: 'right', offsetRelX: 0, offsetRelY: 65, gunner: null },
          { id: 'blue_l2', side: 'left', offsetRelX: -80, offsetRelY: -65, gunner: null },
          { id: 'blue_r2', side: 'right', offsetRelX: -80, offsetRelY: 65, gunner: null }
        ],
        watcher: null
      }
    },
    players: {},
    potatoes: Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      x: Math.random() * (WORLD_WIDTH - 600) + 300,
      y: Math.random() * (WORLD_HEIGHT - 600) + 300,
      collected: false
    })),
    cannonBalls: []
  };
}

io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);

  // ルーム参加・作成処理
  socket.on('joinRoom', ({ roomName, playerName }) => {
    socket.join(roomName);
    socket.roomName = roomName;

    if (!rooms[roomName]) {
      rooms[roomName] = createInitialRoomState();
    }
    const room = rooms[roomName];

    const redCount = Object.values(room.players).filter(p => p.team === 'red').length;
    const blueCount = Object.values(room.players).filter(p => p.team === 'blue').length;
    const team = redCount <= blueCount ? 'red' : 'blue';
    const ship = room.ships[team];

    room.players[socket.id] = {
      id: socket.id,
      team: team,
      x: ship.x,
      y: ship.y,
      role: 'free',
      activeCannonId: null,
      name: playerName || `${team === 'red' ? '赤' : '青'}乗組員`
    };

    socket.emit('init', { id: socket.id, players: room.players, ships: room.ships, potatoes: room.potatoes, cannonBalls: room.cannonBalls });
    socket.to(roomName).emit('newPlayer', room.players[socket.id]);
  });

  socket.on('playerMove', (data) => {
    const room = rooms[socket.roomName];
    if (room && room.players[socket.id]) {
      const p = room.players[socket.id];
      if (p.role === 'free') {
        p.x = data.x;
        p.y = data.y;
        socket.to(socket.roomName).emit('playerMoved', p);
      }
    }
  });

  socket.on('interact', (actionData) => {
    const room = rooms[socket.roomName];
    if (!room) return;
    const p = room.players[socket.id];
    const ship = room.ships[p.team];

    if (actionData.type === 'helm') {
      if (p.role === 'free' && !ship.helmsman) {
        ship.helmsman = socket.id;
        p.role = 'helmsman';
      } else if (p.role === 'helmsman') {
        ship.helmsman = null;
        p.role = 'free';
        p.x = ship.x - Math.cos(ship.angle) * 100;
        p.y = ship.y - Math.sin(ship.angle) * 100;
      }
    } else if (actionData.type === 'cannon') {
      const cannon = ship.cannons.find(c => c.id === actionData.cannonId);
      if (p.role === 'free' && cannon && !cannon.gunner) {
        cannon.gunner = socket.id;
        p.role = 'cannon';
        p.activeCannonId = cannon.id;
      } else if (p.role === 'cannon') {
        const currentCannon = ship.cannons.find(c => c.id === p.activeCannonId);
        if (currentCannon) {
          currentCannon.gunner = null;
          p.x = ship.x + Math.cos(ship.angle) * currentCannon.offsetRelX - Math.sin(ship.angle) * (currentCannon.side === 'left' ? 20 : -20);
          p.y = ship.y + Math.sin(ship.angle) * currentCannon.offsetRelX + Math.cos(ship.angle) * (currentCannon.side === 'left' ? 20 : -20);
        }
        p.role = 'free';
        p.activeCannonId = null;
      }
    } else if (actionData.type === 'watcher') {
      if (p.role === 'free' && !ship.watcher) {
        ship.watcher = socket.id;
        p.role = 'watcher';
      } else if (p.role === 'watcher') {
        ship.watcher = null;
        p.role = 'free';
        p.x = ship.x;
        p.y = ship.y;
      }
    }
    io.to(socket.roomName).emit('gameStateUpdate', { players: room.players, ships: room.ships });
  });

  socket.on('shipControl', (controlData) => {
    const room = rooms[socket.roomName];
    if (!room) return;
    const p = room.players[socket.id];
    if (p && p.role === 'helmsman') {
      const s = room.ships[p.team];
      s.x = controlData.x;
      s.y = controlData.y;
      s.angle = controlData.angle;
      s.speed = controlData.speed;
      socket.to(socket.roomName).emit('shipMoved', s);
    }
  });

  // 大砲発射（2秒のリロード制限つき）
  socket.on('fireCannon', (data) => {
    const room = rooms[socket.roomName];
    if (!room) return;
    const p = room.players[socket.id];
    const ship = room.ships[p.team];
    
    const now = Date.now();
    if (p && p.role === 'cannon' && ship.cannonAmmo > 0) {
      if (p.lastFireTime && now - p.lastFireTime < 2000) {
        return; // リロード中のため発射不可
      }
      p.lastFireTime = now;
      ship.cannonAmmo--;

      const ball = {
        id: Math.random().toString(),
        team: p.team,
        x: data.x,
        y: data.y,
        vx: Math.cos(data.angle) * 18,
        vy: Math.sin(data.angle) * 18,
        range: 0
      };
      room.cannonBalls.push(ball);
      io.to(socket.roomName).emit('cannonFired', ball);
      io.to(socket.roomName).emit('shipAmmoUpdate', { team: p.team, ammo: ship.cannonAmmo });
      socket.emit('reloadStarted', 2000);
    }
  });

  socket.on('collectPotato', (potatoId) => {
    const room = rooms[socket.roomName];
    if (!room) return;
    const p = room.players[socket.id];
    const potato = room.potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = room.ships[p.team];
      ship.cannonAmmo += 5;

      io.to(socket.roomName).emit('potatoCollected', { potatoId, team: p.team, ammo: ship.cannonAmmo });

      setTimeout(() => {
        if (room.potatoes) {
          potato.x = Math.random() * (WORLD_WIDTH - 600) + 300;
          potato.y = Math.random() * (WORLD_HEIGHT - 600) + 300;
          potato.collected = false;
          io.to(socket.roomName).emit('potatoRespawned', potato);
        }
      }, 5000);
    }
  });

  socket.on('disconnect', () => {
    const roomName = socket.roomName;
    if (roomName && rooms[roomName]) {
      const room = rooms[roomName];
      const p = room.players[socket.id];
      if (p) {
        const ship = room.ships[p.team];
        if (ship.helmsman === socket.id) ship.helmsman = null;
        if (ship.watcher === socket.id) ship.watcher = null;
        ship.cannons.forEach(c => { if (c.gunner === socket.id) c.gunner = null; });
        delete room.players[socket.id];
        io.to(roomName).emit('playerDisconnected', socket.id);
        io.to(roomName).emit('gameStateUpdate', { players: room.players, ships: room.ships });
      }
    }
  });
});

setInterval(() => {
  for (let roomName in rooms) {
    const room = rooms[roomName];

    for (let i = room.cannonBalls.length - 1; i >= 0; i--) {
      let ball = room.cannonBalls[i];
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.range += 1;

      if (ball.range > 80) {
        room.cannonBalls.splice(i, 1);
        continue;
      }

      for (let shipId in room.ships) {
        let ship = room.ships[shipId];
        if (ship.id !== ball.team) {
          let dist = Math.hypot(ship.x - ball.x, ship.y - ball.y);
          if (dist < 110) {
            ship.hp -= 15;
            io.to(roomName).emit('shipHit', { shipId: ship.id, hp: ship.hp });
            room.cannonBalls.splice(i, 1);

            if (ship.hp <= 0) {
              io.to(roomName).emit('gameOver', `${ball.team === 'red' ? '赤チーム' : '青チーム'}の勝利！`);
              ship.hp = 100;
            }
            break;
          }
        }
      }
    }

    io.to(roomName).emit('serverTick', { ships: room.ships, cannonBalls: room.cannonBalls });
  }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Pig of Potato v6 サーバー起動: http://localhost:${PORT}`);
});
