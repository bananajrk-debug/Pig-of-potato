const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// マップをさらに広大に拡張 (15000 x 11250)
const WORLD_WIDTH = 15000;
const WORLD_HEIGHT = 11250;

const rooms = {};

function createInitialRoomState(isCpuMode = false) {
  const islands = [
    { id: 1, x: 3500, y: 3000, radius: 900, wood: 8, hasSpecialAmmo: true, ammoType: 2 },
    { id: 2, x: 11500, y: 3000, radius: 900, wood: 8, hasSpecialAmmo: true, ammoType: 3 },
    { id: 3, x: 7500, y: 8000, radius: 1100, wood: 12, hasSpecialAmmo: true, ammoType: 2 },
    { id: 4, x: 3000, y: 8500, radius: 800, wood: 6, hasSpecialAmmo: false },
    { id: 5, x: 12000, y: 8500, radius: 800, wood: 6, hasSpecialAmmo: false }
  ];

  return {
    status: 'waiting',
    isCpuMode: isCpuMode,
    ships: {
      red: {
        id: 'red',
        name: 'レッドポテト号',
        color: '#e74c3c',
        x: 3500,
        y: 5625,
        angle: 0,
        speed: 0,
        maxSpeed: 6.5,
        hp: 100,
        maxHp: 100,
        wood: 0,
        ammo: { 1: 15, 2: 5, 3: 5 },
        leftCooldown: 0,
        rightCooldown: 0,
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
        name: 'ブルーマッシュ号 (CPU)',
        color: '#3498db',
        x: 11500,
        y: 5625,
        angle: Math.PI,
        speed: 0,
        maxSpeed: 6.0,
        hp: 100,
        maxHp: 100,
        wood: 0,
        ammo: { 1: 15, 2: 5, 3: 5 },
        leftCooldown: 0,
        rightCooldown: 0,
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
    islands: islands,
    potatoes: Array.from({ length: 70 }, (_, i) => ({
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
    }
    const room = rooms[roomCode];

    const redCount = Object.values(room.players).filter(p => p.team === 'red').length;
    const blueCount = Object.values(room.players).filter(p => p.team === 'blue').length;
    
    let team = 'red';
    if (!room.isCpuMode) {
      team = redCount <= blueCount ? 'red' : 'blue';
    }

    const ship = room.ships[team];

    room.players[socket.id] = {
      id: socket.id,
      team: team,
      x: ship.x,
      y: ship.y,
      role: 'free',
      activeCannonId: null,
      name: playerName || `${team === 'red' ? '赤' : '青'}乗組員`,
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
        socket.to(socket.roomCode).emit('playerMoved', p);
      }
    }
  });

  socket.on('interact', (actionData) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
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
    io.to(socket.roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
  });

  socket.on('repairShip', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    const ship = room.ships[p.team];
    if (ship.wood >= 2 && ship.hp < ship.maxHp) {
      ship.wood -= 2;
      ship.hp = Math.min(ship.maxHp, ship.hp + 25);
      io.to(socket.roomCode).emit('shipRepaired', { team: p.team, hp: ship.hp, wood: ship.wood });
    }
  });

  socket.on('shipControl', (controlData) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    if (p && p.role === 'helmsman') {
      const s = room.ships[p.team];
      
      let nextX = controlData.x;
      let nextY = controlData.y;
      let collided = false;

      // 島との衝突判定
      room.islands.forEach(isl => {
        if (Math.hypot(nextX - isl.x, nextY - isl.y) < isl.radius + 130) {
          collided = true;
        }
      });

      // 船同士が重ならないための厳格な衝突・反発判定
      for (let otherId in room.ships) {
        if (otherId !== s.id) {
          let otherShip = room.ships[otherId];
          if (Math.hypot(nextX - otherShip.x, nextY - otherShip.y) < 320) {
            collided = true;
          }
        }
      }

      if (!collided) {
        s.x = nextX;
        s.y = nextY;
      }
      s.angle = controlData.angle;
      s.speed = controlData.speed;
      
      socket.to(socket.roomCode).emit('shipMoved', s);
    }
  });

  socket.on('fireSideCannon', ({ side, ammoType }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    if (!p) return;
    const ship = room.ships[p.team];
    const type = ammoType || 1;

    const now = Date.now();
    if (ship.ammo[type] > 0) {
      if (side === 'left') {
        if (ship.leftCooldown > now) return;
        ship.leftCooldown = now + 1500;
      } else if (side === 'right') {
        if (ship.rightCooldown > now) return;
        ship.rightCooldown = now + 1500;
      } else {
        return;
      }

      ship.ammo[type]--;

      const offsetRelX = -40;
      const offsetRelY = side === 'left' ? -65 : 65;
      const wx = ship.x + Math.cos(ship.angle) * offsetRelX - Math.sin(ship.angle) * offsetRelY;
      const wy = ship.y + Math.sin(ship.angle) * offsetRelX + Math.cos(ship.angle) * offsetRelY;

      const ball = {
        id: Math.random().toString(),
        team: p.team,
        ammoType: type,
        x: wx,
        y: wy,
        vx: Math.cos(ship.angle + (side === 'left' ? -Math.PI/2 : Math.PI/2)) * (type === 2 ? 14 : 18),
        vy: Math.sin(ship.angle + (side === 'left' ? -Math.PI/2 : Math.PI/2)) * (type === 2 ? 14 : 18),
        range: 0
      };

      room.cannonBalls.push(ball);
      io.to(socket.roomCode).emit('cannonFired', ball);
      io.to(socket.roomCode).emit('shipAmmoUpdate', { team: p.team, ammo: ship.ammo });
      socket.emit('sideCooldownStarted', { side, duration: 1500 });
    }
  });

  socket.on('collectPotato', (potatoId) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    const potato = room.potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = room.ships[p.team];
      ship.ammo[1] += 3;

      io.to(socket.roomCode).emit('potatoCollected', { potatoId, team: p.team, ammo: ship.ammo });

      setTimeout(() => {
        if (room.potatoes) {
          potato.x = Math.random() * (WORLD_WIDTH - 1000) + 500;
          potato.y = Math.random() * (WORLD_HEIGHT - 1000) + 500;
          potato.collected = false;
          io.to(socket.roomCode).emit('potatoRespawned', potato);
        }
      }, 5000);
    }
  });

  socket.on('gatherIsland', (islandId) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    const island = room.islands.find(isl => isl.id === islandId);
    const ship = room.ships[p.team];

    if (island && (island.wood > 0 || island.hasSpecialAmmo)) {
      if (island.wood > 0) {
        island.wood--;
        ship.wood += 1;
      }
      if (island.hasSpecialAmmo) {
        ship.ammo[island.ammoType] = (ship.ammo[island.ammoType] || 0) + 2;
        island.hasSpecialAmmo = false;
      }
      io.to(socket.roomCode).emit('islandGathered', { islandId, shipWood: ship.wood, ammo: ship.ammo });

      setTimeout(() => {
        if (room.islands) {
          island.wood = 6;
          island.hasSpecialAmmo = true;
          io.to(socket.roomCode).emit('islandRespawned', island);
        }
      }, 10000);
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      const p = room.players[socket.id];
      if (p) {
        if (room.status === 'playing') {
          const ship = room.ships[p.team];
          if (ship.helmsman === socket.id) ship.helmsman = null;
          if (ship.watcher === socket.id) ship.watcher = null;
          ship.cannons.forEach(c => { if (c.gunner === socket.id) c.gunner = null; });
        }
        delete room.players[socket.id];
        if (room.status === 'playing') {
          io.to(roomCode).emit('playerDisconnected', socket.id);
          io.to(roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
        } else {
          io.to(roomCode).emit('lobbyUpdate', { players: room.players, status: room.status, roomCode });
        }
      }
    }
  });
});

setInterval(() => {
  for (let roomCode in rooms) {
    const room = rooms[roomCode];
    if (room.status !== 'playing') continue;

    if (room.isCpuMode) {
      const blueShip = room.ships.blue;
      const redShip = room.ships.red;

      let targetAngle = Math.atan2(redShip.y - blueShip.y, redShip.x - blueShip.x);
      let angleDiff = targetAngle - blueShip.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      if (angleDiff > 0.05) blueShip.angle += 0.03;
      else if (angleDiff < -0.05) blueShip.angle -= 0.03;

      let dist = Math.hypot(redShip.x - blueShip.x, redShip.y - blueShip.y);
      if (dist > 600) {
        blueShip.speed = blueShip.maxSpeed;
      } else {
        blueShip.speed = 2.0;
      }

      let nextX = blueShip.x + Math.cos(blueShip.angle) * blueShip.speed;
      let nextY = blueShip.y + Math.sin(blueShip.angle) * blueShip.speed;
      
      let collided = false;
      room.islands.forEach(isl => {
        if (Math.hypot(nextX - isl.x, nextY - isl.y) < isl.radius + 130) collided = true;
      });
      if (Math.hypot(nextX - redShip.x, nextY - redShip.y) < 320) collided = true;

      if (!collided) {
        blueShip.x = nextX;
        blueShip.y = nextY;
      }
      blueShip.x = Math.max(300, Math.min(WORLD_WIDTH - 300, blueShip.x));
      blueShip.y = Math.max(300, Math.min(WORLD_HEIGHT - 300, blueShip.y));

      const now = Date.now();
      if (dist < 1800 && blueShip.ammo[1] > 0 && blueShip.leftCooldown < now) {
        blueShip.leftCooldown = now + 2000;
        blueShip.ammo[1]--;
        room.cannonBalls.push({
          id: Math.random().toString(),
          team: 'blue',
          ammoType: 1,
          x: blueShip.x,
          y: blueShip.y,
          vx: Math.cos(blueShip.angle - Math.PI/2) * 18,
          vy: Math.sin(blueShip.angle - Math.PI/2) * 18,
          range: 0
        });
      }
    }

    for (let i = room.cannonBalls.length - 1; i >= 0; i--) {
      let ball = room.cannonBalls[i];
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.range += 1;

      if (ball.range > 120) {
        room.cannonBalls.splice(i, 1);
        continue;
      }

      for (let shipId in room.ships) {
        let ship = room.ships[shipId];
        if (ship.id !== ball.team) {
          let dist = Math.hypot(ship.x - ball.x, ship.y - ball.y);
          if (dist < 120) {
            const damage = ball.ammoType === 2 ? 30 : 15;
            ship.hp -= damage;
            io.to(roomCode).emit('shipHit', { shipId: ship.id, hp: ship.hp });
            room.cannonBalls.splice(i, 1);

            if (ship.hp <= 0) {
              io.to(roomCode).emit('gameOver', `${ball.team === 'red' ? '赤チーム' : '青チーム'}の勝利！`);
              room.status = 'waiting';
              ship.hp = 100;
            }
            break;
          }
        }
      }
    }

    io.to(roomCode).emit('serverTick', { ships: room.ships, cannonBalls: room.cannonBalls });
  }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Pig of Potato v20 サーバー起動: http://localhost:${PORT}`);
});
