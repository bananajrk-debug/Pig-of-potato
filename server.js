const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 3000;

// 2つのチームの大型船
const ships = {
  red: {
    id: 'red',
    name: 'レッドポテト号',
    color: '#e74c3c',
    x: 800,
    y: 1500,
    angle: 0,
    speed: 0,
    hp: 100,
    cannonAmmo: 10,
    helmsman: null, // 舵を取っているプレイヤーID
    cannons: [
      { id: 'red_l1', side: 'left', offsetRelX: -20, offsetRelY: -35, gunner: null },
      { id: 'red_r1', side: 'right', offsetRelX: -20, offsetRelY: 35, gunner: null }
    ],
    watcher: null
  },
  blue: {
    id: 'blue',
    name: 'ブルーマッシュ号',
    color: '#3498db',
    x: 3200,
    y: 1500,
    angle: Math.PI,
    speed: 0,
    hp: 100,
    cannonAmmo: 10,
    helmsman: null,
    cannons: [
      { id: 'blue_l1', side: 'left', offsetRelX: -20, offsetRelY: -35, gunner: null },
      { id: 'blue_r1', side: 'right', offsetRelX: -20, offsetRelY: 35, gunner: null }
    ],
    watcher: null
  }
};

// プレイヤー管理
const players = {};

// 海に浮かぶじゃがいも（お宝 兼 弾薬）
let potatoes = [];
for (let i = 1; i <= 20; i++) {
  potatoes.push({
    id: i,
    x: Math.random() * (WORLD_WIDTH - 400) + 200,
    y: Math.random() * (WORLD_HEIGHT - 400) + 200,
    collected: false
  });
}

// 飛んでいるじゃがいも弾
let cannonBalls = [];

io.on('connection', (socket) => {
  console.log(`プレイヤーが接続: ${socket.id}`);

  // チームを自動割り当て（赤または青）
  const redCount = Object.values(players).filter(p => p.team === 'red').length;
  const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
  const team = redCount <= blueCount ? 'red' : 'blue';

  const ship = ships[team];

  players[socket.id] = {
    id: socket.id,
    team: team,
    x: ship.x + (Math.random() * 60 - 30),
    y: ship.y + (Math.random() * 60 - 30),
    role: 'free', // 'free', 'helmsman', 'cannon', 'watcher'
    activeCannonId: null,
    name: `${team === 'red' ? '赤' : '青'}の豚乗組員_${Math.floor(Math.random() * 90 + 10)}`
  };

  socket.emit('init', { id: socket.id, players, ships, potatoes });
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // プレイヤーの移動
  socket.on('playerMove', (data) => {
    const p = players[socket.id];
    if (p && p.role === 'free') {
      p.x = data.x;
      p.y = data.y;
      socket.broadcast.emit('playerMoved', p);
    }
  });

  // インタラクション要求（Eキー：舵・大砲・見張り台に乗る・降りる）
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
      }
    } else if (actionData.type === 'cannon') {
      const cannon = ship.cannons.find(c => c.id === actionData.cannonId);
      if (p.role === 'free' && cannon && !cannon.gunner) {
        cannon.gunner = socket.id;
        p.role = 'cannon';
        p.activeCannonId = cannon.id;
      } else if (p.role === 'cannon') {
        const currentCannon = ship.cannons.find(c => c.id === p.activeCannonId);
        if (currentCannon) currentCannon.gunner = null;
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
      }
    }
    io.emit('gameStateUpdate', { players, ships });
  });

  // 船の操舵更新（舵を取っている人のみ）
  socket.on('shipControl', (controlData) => {
    const p = players[socket.id];
    if (p && p.role === 'helmsman') {
      const ship = ships[p.team];
      ship.angle = controlData.angle;
      ship.speed = controlData.speed;
    }
  });

  // 大砲発射
  socket.on('fireCannon', (data) => {
    const p = players[socket.id];
    const ship = ships[p.team];
    if (p && p.role === 'cannon' && ship.cannonAmmo > 0) {
      ship.cannonAmmo--;

      // 弾の生成
      const ball = {
        id: Math.random().toString(),
        team: p.team,
        x: data.x,
        y: data.y,
        vx: Math.cos(data.angle) * 12,
        vy: Math.sin(data.angle) * 12,
        range: 0
      };
      cannonBalls.push(ball);
      io.emit('cannonFired', ball);
      io.emit('shipAmmoUpdate', { team: p.team, ammo: ship.cannonAmmo });
    }
  });

  // じゃがいも回収
  socket.on('collectPotato', (potatoId) => {
    const p = players[socket.id];
    const potato = potatoes.find(pt => pt.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      const ship = ships[p.team];
      ship.cannonAmmo += 3; // 拾うと弾が3つ増える

      io.emit('potatoCollected', { potatoId, team: p.team, ammo: ship.cannonAmmo });

      // 7秒後にリスポーン
      setTimeout(() => {
        potato.x = Math.random() * (WORLD_WIDTH - 400) + 200;
        potato.y = Math.random() * (WORLD_HEIGHT - 400) + 200;
        potato.collected = false;
        io.emit('potatoRespawned', potato);
      }, 7000);
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

// ゲームの物理演算ループ（船の移動、砲弾の判定）
setInterval(() => {
  // 船の位置更新
  for (let id in ships) {
    let ship = ships[id];
    if (ship.speed !== 0) {
      ship.x += Math.cos(ship.angle) * ship.speed;
      ship.y += Math.sin(ship.angle) * ship.speed;

      // マップ境界制限
      ship.x = Math.max(150, Math.min(WORLD_WIDTH - 150, ship.x));
      ship.y = Math.max(150, Math.min(WORLD_HEIGHT - 150, ship.y));
    }
  }

  // 砲弾の移動とヒット判定
  for (let i = cannonBalls.length - 1; i >= 0; i--) {
    let ball = cannonBalls[i];
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.range += 1;

    // 射程切れ
    if (ball.range > 50) {
      cannonBalls.splice(i, 1);
      continue;
    }

    // 敵船とのヒット判定
    for (let shipId in ships) {
      let ship = ships[shipId];
      if (ship.id !== ball.team) {
        let dist = Math.hypot(ship.x - ball.x, ship.y - ball.y);
        if (dist < 60) {
          // 命中！
          ship.hp -= 10;
          io.emit('shipHit', { shipId: ship.id, hp: ship.hp });
          cannonBalls.splice(i, 1);

          if (ship.hp <= 0) {
            io.emit('gameOver', `${ball.team === 'red' ? '赤チーム（レッドポテト号）' : '青チーム（ブルーマッシュ号）'}の勝利！`);
            ship.hp = 100; // リセット
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
  console.log(`✨ Pig of Potato v2 サーバー起動: http://localhost:${PORT}`);
});
