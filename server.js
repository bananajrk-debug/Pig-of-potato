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

const rooms = {};

function createInitialRoomState() {
  // 小島の生成
  const islands = [
    { id: 1, x: 1500, y: 1200, radius: 180, wood: 5, hasSpecialAmmo: true, ammoType: 2 }, // 爆発弾の島
    { id: 2, x: 4500, y: 1200, radius: 180, wood: 5, hasSpecialAmmo: true, ammoType: 3 }, // 貫通・炎弾の島
    { id: 3, x: 3000, y: 3300, radius: 220, wood: 8, hasSpecialAmmo: true, ammoType: 2 }, // 木が多い島
    { id: 4, x: 1200, y: 3200, radius: 160, wood: 4, hasSpecialAmmo: false },
    { id: 5, x: 4800, y: 3200, radius: 160, wood: 4, hasSpecialAmmo: false }
  ];

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
        maxHp: 100,
        wood: 0,
        // 砲弾ストック：1:通常弾, 2:爆発弾, 3:特製散弾
        ammo: { 1: 5, 2: 0, 3: 0 }, 
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
        maxHp: 100,
        wood: 0,
        ammo: { 1: 5, 2: 0, 3: 0 },
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
    potatoes: Array.from({ length: 30 }, (_, i) => ({
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

  // 4桁のルームコード参加
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!roomCode || roomCode.length !== 4) return;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!rooms[roomCode]) {
      rooms[roomCode] = createInitialRoomState();
    }
    const room = rooms[roomCode];

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

    socket.emit('init', { 
      id: socket.id, 
      players: room.players, 
      ships: room.ships, 
      islands: room.islands, 
      potatoes: room.potatoes, 
      cannonBalls: room.cannonBalls 
    });
    socket.to(roomCode).emit('newPlayer', room.players[socket.id]);
  });

  socket.on('playerMove', (data) => {
    const room = rooms[socket.roomCode];
    if (room && room.players[socket.id]) {
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
    io.to(socket.roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
  });

  // 船の修理（木を消費してHP回復）
  socket.on('repairShip', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
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
    if (!room) return;
    const p = room.players[socket.id];
    if (p && p.role === 'helmsman') {
      const s = room.ships[p.team];
      s.x = controlData.x;
      s.y = controlData.y;
      s.angle = controlData.angle;
      s.speed = controlData.speed;
      socket.to(socket.roomCode).emit('shipMoved', s);
    }
  });

  // 砲弾発射（種類対応 1:通常, 2:爆発弾, 3:特製弾）
  socket.on('fireCannon', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const p = room.players[socket.id];
    const ship = room.ships[p.team];
    const ammoType = data.ammoType || 1;

    const now = Date.now();
    if (p && p.role === 'cannon' && ship.ammo[ammoType] > 0) {
      if (p.lastFireTime && now - p.lastFireTime < 2000) {
        return; // 2秒リロード
      }
      p.lastFireTime = now;
      ship.ammo[ammoType]--;

      const ball = {
        id: Math.random().toString(),
        team: p.team,
        ammoType: ammoType,
        x: data.x,
        y: data.y,
        vx: Math.cos(data.angle) * (ammoType === 2 ? 14 : 18),
        vy: Math.sin(data.angle) * (ammoType === 2 ? 14 : 18),
        range: 0
      };
      room.cannonBalls.push(ball);
      io.to(socket.roomCode).emit('cannonFired', ball);
      io.to(socket.roomCode).emit('shipAmmoUpdate', { team: p.team, ammo: ship.ammo });
      socket.emit('reloadStarted', 2000);
    }
  });

  // 海上のポテト回収
  socket.on('collectPotato', (potatoId) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const p = room.players[socket.id];
    const potato = room.potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = room.ships[p.team];
      ship.ammo[1] += 3; // 通常弾3発補充

      io.to(socket.roomCode).emit('potatoCollected', { potatoId, team: p.team, ammo: ship.ammo });

      setTimeout(() => {
        if (room.potatoes) {
          potato.x = Math.random() * (WORLD_WIDTH - 600) + 300;
          potato.y = Math.random() * (WORLD_HEIGHT - 600) + 300;
          potato.collected = false;
          io.to(socket.roomCode).emit('potatoRespawned', potato);
        }
      }, 5000);
    }
  });

  // 島からの資源（木・効果付き砲弾）回収
  socket.on('gatherIsland', (islandId) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const p = room.players[socket.id];
    const island = room.islands.find(isl => isl.id === islandId);
    const ship = room.ships[p.team];

    if (island && (island.wood > 0 || island.hasSpecialAmmo)) {
      if (island.wood > 0) {
        island.wood--;
        ship.wood += 1;
      }
      if (island.hasSpecialAmmo) {
        ship.ammo[island.ammoType] = (ship.ammo[island.ammoType] || 0) + 2; // 特殊弾2発獲得
        island.hasSpecialAmmo = false;
      }
      io.to(socket.roomCode).emit('islandGathered', { islandId, shipWood: ship.wood, ammo: ship.ammo });

      // 一定時間後に島を復活
      setTimeout(() => {
        if (room.islands) {
          island.wood = 4;
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
        const ship = room.ships[p.team];
        if (ship.helmsman === socket.id) ship.helmsman = null;
        if (ship.watcher === socket.id) ship.watcher = null;
        ship.cannons.forEach(c => { if (c.gunner === socket.id) c.gunner = null; });
        delete room.players[socket.id];
        io.to(roomCode).emit('playerDisconnected', socket.id);
        io.to(roomCode).emit('gameStateUpdate', { players: room.players, ships: room.ships });
      }
    }
  });
});

setInterval(() => {
  for (let roomCode in rooms) {
    const room = rooms[roomCode];

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
            // 弾の種類によるダメージ変動（2:爆発弾は高ダメージ）
            const damage = ball.ammoType === 2 ? 30 : 15;
            ship.hp -= damage;
            io.to(roomCode).emit('shipHit', { shipId: ship.id, hp: ship.hp });
            room.cannonBalls.splice(i, 1);

            if (ship.hp <= 0) {
              io.to(roomCode).emit('gameOver', `${ball.team === 'red' ? '赤チーム' : '青チーム'}の勝利！`);
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
  console.log(`✨ Pig of Potato v7 サーバー起動: http://localhost:${PORT}`);
});
