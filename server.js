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
    { x: ship.x, y: ship.y, r: 60 },
    { x: ship.x + cos * 70, y: ship.y + sin * 70, r: 50 },
    { x: ship.x - cos * 70, y: ship.y - sin * 70, r: 50 }
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
    { id: 'town', x: 7500, y: 5625, radius: 1400, isTown: true, name: '🥔 ポテト港町' },
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
      y: 8200,
      angle: 0,
      speed: 0,
      maxSpeed: 6.5,
      hp: 100,
      maxHp: 100,
      wood: 0,
      coins: 100,
      ammo: { 1: 15, 2: 5, 3: 5 },
      leftCooldown: 0,
      rightCooldown: 0,
      helmsman: null,
      cannons: [
        { id: 'red_l1', side: 'left', offsetRelX: 0, offsetRelY: -55, gunner: null },
        { id: 'red_r1', side: 'right', offsetRelX: 0, offsetRelY: 55, gunner: null },
        { id: 'red_l2', side: 'left', offsetRelX: -60, offsetRelY: -55, gunner: null },
        { id: 'red_r2', side: 'right', offsetRelX: -60, offsetRelY: 55, gunner: null }
      ],
      watcher: null,
      isCpu: false
    }
  };

  if (isCpuMode) {
    const cpuPositions = [
      { x: 1500, y: 1500 }, 
      { x: 13500, y: 1500 }, 
      { x: 1500, y: 9500 }, 
      { x: 13500, y: 9500 }
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
    potatoes: Array.from({ length: 18 }, (_, i) => ({
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
      x: ship.x - 80,
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
        p.x = ship.x - 80;
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
        p.x = ship.x - 80;
        p.y = ship.y;
      }
    }
    io.to(socket.roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
  });

  socket.on('portAction', (actionType) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const ship = room.ships['red'];

    if (actionType === 'sellWood') {
      if (ship.wood > 0) {
        const earnings = ship.wood * 20;
        ship.coins += earnings;
        ship.wood = 0;
        socket.emit('shopMessage', `🪵 木材を売却して ${earnings} コイン獲得！`);
      } else {
        socket.emit('shopMessage', '売却する木材がありません。');
      }
    } else if (actionType === 'upgradeHp') {
      if (ship.coins >= 50) {
        ship.coins -= 50;
        ship.maxHp += 25;
        ship.hp = ship.maxHp;
        socket.emit('shopMessage', '❤️ 最大HPがアップしました！');
      } else {
        socket.emit('shopMessage', 'コインが足りません（50コイン必要）');
      }
    } else if (actionType === 'upgradeSpeed') {
      if (ship.coins >= 80) {
        ship.coins -= 80;
        ship.maxSpeed += 0.5;
        socket.emit('shopMessage', '⚡ 船のスピードがアップしました！');
      } else {
        socket.emit('shopMessage', 'コインが足りません（80コイン必要）');
      }
    }
    io.to(socket.roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
  });

  socket.on('repairShip', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const ship = room.ships['red'];
    if (ship.wood >= 2 && ship.hp < ship.maxHp) {
      ship.wood -= 2;
      ship.hp = Math.min(ship.maxHp, ship.hp + 25);
      io.to(socket.roomCode).emit('shipRepaired', { team: 'red', hp: ship.hp, wood: ship.wood });
    }
  });

  socket.on('shipControl', (controlData) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id];
    if (p && p.role === 'helmsman') {
      const s = room.ships['red'];
      let testShip = { ...s, x: controlData.x, y: controlData.y, angle: controlData.angle };
      let collided = false;
      if (checkShipIslandCollision(testShip, room.islands)) collided = true;

      for (let otherId in room.ships) {
        if (otherId !== 'red') {
          if (checkShipShipCollision(testShip, room.ships[otherId])) collided = true;
        }
      }

      if (!collided) {
        s.x = controlData.x;
        s.y = controlData.y;
      }
      s.angle = controlData.angle;
      s.speed = controlData.speed;
      socket.to(socket.roomCode).emit('shipMoved', s);
    }
  });

  socket.on('fireSideCannon', ({ side, ammoType }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    if (!room.isCpuMode) return; // ソロプレイ時のみ有効

    const p = room.players[socket.id];
    if (!p) return;
    const ship = room.ships['red'];
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
      const offsetRelX = -30;
      const offsetRelY = side === 'left' ? -55 : 55;
      const wx = ship.x + Math.cos(ship.angle) * offsetRelX - Math.sin(ship.angle) * offsetRelY;
      const wy = ship.y + Math.sin(ship.angle) * offsetRelX + Math.cos(ship.angle) * offsetRelY;

      const ball = {
        id: Math.random().toString(),
        team: 'red',
        ammoType: type,
        x: wx,
        y: wy,
        vx: Math.cos(ship.angle + (side === 'left' ? -Math.PI/2 : Math.PI/2)) * 18,
        vy: Math.sin(ship.angle + (side === 'left' ? -Math.PI/2 : Math.PI/2)) * 18,
        range: 0
      };

      room.cannonBalls.push(ball);
      io.to(roomCode).emit('cannonFired', ball);
      io.to(roomCode).emit('shipAmmoUpdate', { team: 'red', ammo: ship.ammo });
      socket.emit('sideCooldownStarted', { side, duration: 1500 });
    }
  });

  socket.on('collectPotato', (potatoId) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const potato = room.potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = room.ships['red'];
      ship.ammo[1] += 3;
      io.to(roomCode).emit('potatoCollected', { potatoId, team: 'red', ammo: ship.ammo });

      setTimeout(() => {
        if (room.potatoes) {
          potato.x = Math.random() * (WORLD_WIDTH - 1000) + 500;
          potato.y = Math.random() * (WORLD_HEIGHT - 1000) + 500;
          potato.collected = false;
          io.to(roomCode).emit('potatoRespawned', potato);
        }
      }, 5000);
    }
  });

  socket.on('gatherIsland', (islandId) => {
    const room = rooms[socket.roomCode];
    if (!room || room.status !== 'playing') return;
    const island = room.islands.find(isl => isl.id === islandId);
    const ship = room.ships['red'];

    if (island && !island.isTown && (island.wood > 0 || island.hasSpecialAmmo)) {
      if (island.wood > 0) {
        island.wood--;
        ship.wood += 1;
      }
      if (island.hasSpecialAmmo) {
        ship.ammo[island.ammoType] = (ship.ammo[island.ammoType] || 0) + 2;
        island.hasSpecialAmmo = false;
      }
      io.to(roomCode).emit('islandGathered', { islandId, shipWood: ship.wood, ammo: ship.ammo });

      setTimeout(() => {
        if (room.islands) {
          island.wood = 6;
          island.hasSpecialAmmo = true;
          io.to(roomCode).emit('islandRespawned', island);
        }
      }, 10000);
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      delete room.players[socket.id];
      if (room.status === 'playing') {
        io.to(roomCode).emit('playerDisconnected', socket.id);
        io.to(roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
      } else {
        io.to(roomCode).emit('lobbyUpdate', { players: room.players, status: room.status, roomCode });
      }
    }
  });
});

setInterval(() => {
  for (let roomCode in rooms) {
    const room = rooms[roomCode];
    if (room.status !== 'playing') continue;

    const redShip = room.ships['red'];
    if (!redShip) continue;

    if (room.isCpuMode) {
      for (let sId in room.ships) {
        const cpuShip = room.ships[sId];
        if (!cpuShip.isCpu || cpuShip.hp <= 0) continue;

        let dx = redShip.x - cpuShip.x;
        let dy = redShip.y - cpuShip.y;
        let dist = Math.hypot(dx, dy);

        let angleToPlayer = Math.atan2(dy, dx);
        if (dist > 350) {
          let angleDiff = angleToPlayer - cpuShip.angle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          cpuShip.angle += angleDiff * 0.03;
          cpuShip.speed = cpuShip.maxSpeed;
        } else {
          let sideAngle = angleToPlayer + Math.PI / 2;
          let angleDiff = sideAngle - cpuShip.angle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          cpuShip.angle += angleDiff * 0.05;
          cpuShip.speed = 1.0;
        }

        let nextX = cpuShip.x + Math.cos(cpuShip.angle) * cpuShip.speed;
        let nextY = cpuShip.y + Math.sin(cpuShip.angle) * cpuShip.speed;

        let testShip = { ...cpuShip, x: nextX, y: nextY };
        let collided = false;
        room.islands.forEach(isl => {
          if (checkShipIslandCollision(testShip, [isl])) collided = true;
        });

        if (!collided) {
          cpuShip.x = nextX;
          cpuShip.y = nextY;
        }
        cpuShip.x = Math.max(300, Math.min(WORLD_WIDTH - 300, cpuShip.x));
        cpuShip.y = Math.max(300, Math.min(WORLD_HEIGHT - 300, cpuShip.y));

        const now = Date.now();
        if (dist < 1000 && cpuShip.leftCooldown < now) {
          cpuShip.leftCooldown = now + 2000;
          room.cannonBalls.push({
            id: Math.random().toString(),
            team: cpuShip.id,
            ammoType: 1,
            x: cpuShip.x,
            y: cpuShip.y,
            vx: Math.cos(cpuShip.angle - Math.PI/2) * 15,
            vy: Math.sin(cpuShip.angle - Math.PI/2) * 15,
            range: 0
          });
        }
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
          if (dist < 100 && ship.hp > 0) {
            const damage = ball.ammoType === 2 ? 30 : 15;
            ship.hp -= damage;
            io.to(roomCode).emit('shipHit', { shipId: ship.id, hp: ship.hp });
            room.cannonBalls.splice(i, 1);

            if (ship.id === 'red' && ship.hp <= 0) {
              io.to(roomCode).emit('gameOver', { result: 'lose', message: '💀 敗北... 船が沈んでしまった！' });
              room.status = 'waiting';
            }

            if (ship.isCpu && ship.hp <= 0) {
              redShip.coins += 50;
            }

            if (room.isCpuMode) {
              let allCpuDead = true;
              for (let sId in room.ships) {
                if (room.ships[sId].isCpu && room.ships[sId].hp > 0) {
                  allCpuDead = false;
                  break;
                }
              }
              if (allCpuDead) {
                io.to(roomCode).emit('gameOver', { result: 'win', message: '🎉 勝利！すべての海賊船を制圧した！' });
                room.status = 'waiting';
              }
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
  console.log(`✨ Pig of Potato MMORPG サーバー起動: http://localhost:${PORT}`);
});
