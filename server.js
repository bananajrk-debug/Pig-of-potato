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

const ships = {
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
};

const players = {};

let potatoes = [];
for (let i = 1; i <= 40; i++) {
  potatoes.push({
    id: i,
    x: Math.random() * (WORLD_WIDTH - 600) + 300,
    y: Math.random() * (WORLD_HEIGHT - 600) + 300,
    collected: false
  });
}

let cannonBalls = [];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  const redCount = Object.values(players).filter(p => p.team === 'red').length;
  const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
  const team = redCount <= blueCount ? 'red' : 'blue';
  const ship = ships[team];

  players[socket.id] = {
    id: socket.id,
    team: team,
    x: ship.x,
    y: ship.y,
    role: 'free',
    activeCannonId: null,
    name: `${team === 'red' ? '赤' : '青'}チーム乗組員_${Math.floor(Math.random() * 90 + 10)}`
  };

  socket.emit('init', { id: socket.id, players, ships, potatoes, cannonBalls });
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('playerMove', (data) => {
    const p = players[socket.id];
    if (p && p.role === 'free') {
      p.x = data.x;
      p.y = data.y;
      socket.broadcast.emit('playerMoved', p);
    }
  });

  socket.on('interact', (actionData) => {
    const p = players[socket.id];
    const ship = ships[p.team];

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
    io.emit('gameStateUpdate', { players, ships });
  });

  // 舵を取っているプレイヤーからの正確な位置・角度を受け取って即時反映（カクつきゼロに）
  socket.on('shipControl', (controlData) => {
    const p = players[socket.id];
    if (p && p.role === 'helmsman') {
      const ship = ships[p.team];
      ship.x = controlData.x;
      ship.y = controlData.y;
      ship.angle = controlData.angle;
      ship.speed = controlData.speed;
      socket.broadcast.emit('shipMoved', ship);
    }
  });

  socket.on('fireCannon', (data) => {
    const p = players[socket.id];
    const ship = ships[p.team];
    if (p && p.role === 'cannon' && ship.cannonAmmo > 0) {
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
      cannonBalls.push(ball);
      io.emit('cannonFired', ball);
      io.emit('shipAmmoUpdate', { team: p.team, ammo: ship.cannonAmmo });
    }
  });

  socket.on('collectPotato', (potatoId) => {
    const p = players[socket.id];
    const potato = potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = ships[p.team];
      ship.cannonAmmo += 5; // ポテト獲得で弾が5発に増加

      io.emit('potatoCollected', { potatoId, team: p.team, ammo: ship.cannonAmmo });

      setTimeout(() => {
        potato.x = Math.random() * (WORLD_WIDTH - 600) + 300;
        potato.y = Math.random() * (WORLD_HEIGHT - 600) + 300;
        potato.collected = false;
        io.emit('potatoRespawned', potato);
      }, 5000);
    }
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      const ship = ships[p.team];
      if (ship.helmsman === socket.id) ship.helmsman = null;
      if (ship.watcher === socket.id) ship.watcher = null;
      ship.cannons.forEach(c => { if (c.gunner === socket.id) c.gunner = null; });
      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
      io.emit('gameStateUpdate', { players, ships });
    }
  });
});

// 砲弾の物理演算ループ
setInterval(() => {
  for (let i = cannonBalls.length - 1; i >= 0; i--) {
    let ball = cannonBalls[i];
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.range += 1;

    if (ball.range > 80) {
      cannonBalls.splice(i, 1);
      continue;
    }

    for (let shipId in ships) {
      let ship = ships[shipId];
      if (ship.id !== ball.team) {
        let dist = Math.hypot(ship.x - ball.x, ship.y - ball.y);
        if (dist < 110) {
          ship.hp -= 15;
          io.emit('shipHit', { shipId: ship.id, hp: ship.hp });
          cannonBalls.splice(i, 1);

          if (ship.hp <= 0) {
            io.emit('gameOver', `${ball.team === 'red' ? '赤チーム' : '青チーム'}の勝利！`);
            ship.hp = 100;
          }
          break;
        }
      }
    }
  }

  io.emit('serverTick', { ships, cannonBalls });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Pig of Potato v5 サーバー起動: http://localhost:${PORT}`);
});
