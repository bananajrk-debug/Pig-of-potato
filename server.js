const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TANK_SPEED = 2.5;
const BODY_ROTATE_SPEED = 0.04;
const TANK_SIZE = 30;
const BULLET_SPEED = 6;
const BULLET_RADIUS = 8;

const MAP_WIDTH = 480;
const MAP_HEIGHT = 720;
const TILE_SIZE = 40;

const obstacles = [
  { x: 3, y: 3 }, { x: 3, y: 4 },
  { x: 8, y: 3 }, { x: 8, y: 4 },
  { x: 5, y: 8 }, { x: 6, y: 8 },
  { x: 3, y: 13 }, { x: 3, y: 14 },
  { x: 8, y: 13 }, { x: 8, y: 14 }
];

let players = {};
let bullets = [];

function checkCollision(x, y, size) {
  if (x < 0 || x + size > MAP_WIDTH || y < 0 || y + size > MAP_HEIGHT) {
    return true;
  }
  for (let obs of obstacles) {
    const obsX = obs.x * TILE_SIZE;
    const obsY = obs.y * TILE_SIZE;
    if (
      x < obsX + TILE_SIZE &&
      x + size > obsX &&
      y < obsY + TILE_SIZE &&
      y + size > obsY
    ) {
      return true;
    }
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('プレイヤー接続:', socket.id);

  players[socket.id] = {
    x: 220,
    y: 600,
    bodyAngle: -Math.PI / 2, // 初期は上向き
    score: 0,
    hp: 100
  };

  socket.on('input', (data) => {
    const player = players[socket.id];
    if (!player) return;

    if (data.turnLeft) player.bodyAngle -= BODY_ROTATE_SPEED;
    if (data.turnRight) player.bodyAngle += BODY_ROTATE_SPEED;

    let moveStep = 0;
    if (data.forward) moveStep = TANK_SPEED;
    if (data.backward) moveStep = -TANK_SPEED;

    if (moveStep !== 0) {
      let newX = player.x + Math.cos(player.bodyAngle) * moveStep;
      let newY = player.y + Math.sin(player.bodyAngle) * moveStep;

      if (!checkCollision(newX, player.y, TANK_SIZE)) player.x = newX;
      if (!checkCollision(player.x, newY, TANK_SIZE)) player.y = newY;
    }
  });

  socket.on('shoot', () => {
    const player = players[socket.id];
    if (!player) return;

    // 車体の向き（正面）から弾を発射
    const bx = player.x + TANK_SIZE / 2 + Math.cos(player.bodyAngle) * 25;
    const by = player.y + TANK_SIZE / 2 + Math.sin(player.bodyAngle) * 25;

    bullets.push({
      id: Math.random().toString(),
      playerId: socket.id,
      x: bx,
      y: by,
      dx: Math.cos(player.bodyAngle) * BULLET_SPEED,
      dy: Math.sin(player.bodyAngle) * BULLET_SPEED,
      bouncesLeft: 1 // 1回までバウンド
    });
  });

  socket.on('disconnect', () => {
    console.log('プレイヤー切断:', socket.id);
    delete players[socket.id];
  });
});

setInterval(() => {
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    let prevX = b.x;
    let prevY = b.y;

    b.x += b.dx;
    b.y += b.dy;

    let destroyed = false;

    // 壁とのバウンド
    if (b.x - BULLET_RADIUS < 0) {
      b.x = BULLET_RADIUS;
      if (b.bouncesLeft > 0) { b.dx = -b.dx; b.bouncesLeft--; } else { destroyed = true; }
    } else if (b.x + BULLET_RADIUS > MAP_WIDTH) {
      b.x = MAP_WIDTH - BULLET_RADIUS;
      if (b.bouncesLeft > 0) { b.dx = -b.dx; b.bouncesLeft--; } else { destroyed = true; }
    }
    if (b.y - BULLET_RADIUS < 0) {
      b.y = BULLET_RADIUS;
      if (b.bouncesLeft > 0) { b.dy = -b.dy; b.bouncesLeft--; } else { destroyed = true; }
    } else if (b.y + BULLET_RADIUS > MAP_HEIGHT) {
      b.y = MAP_HEIGHT - BULLET_RADIUS;
      if (b.bouncesLeft > 0) { b.dy = -b.dy; b.bouncesLeft--; } else { destroyed = true; }
    }

    // 障害物ブロックとのバウンド
    if (!destroyed) {
      for (let obs of obstacles) {
        const obsX = obs.x * TILE_SIZE;
        const obsY = obs.y * TILE_SIZE;

        if (
          b.x + BULLET_RADIUS > obsX &&
          b.x - BULLET_RADIUS < obsX + TILE_SIZE &&
          b.y + BULLET_RADIUS > obsY &&
          b.y - BULLET_RADIUS < obsY + TILE_SIZE
        ) {
          if (b.bouncesLeft > 0) {
            b.bouncesLeft--;
            if (prevX + BULLET_RADIUS <= obsX || prevX - BULLET_RADIUS >= obsX + TILE_SIZE) {
              b.dx = -b.dx;
              b.x = prevX;
            } else {
              b.dy = -b.dy;
              b.y = prevY;
            }
          } else {
            destroyed = true;
          }
          break;
        }
      }
    }

    // プレイヤーへの衝突
    if (!destroyed) {
      for (let id in players) {
        if (id === b.playerId) continue;
        let p = players[id];
        if (
          b.x >= p.x && b.x <= p.x + TANK_SIZE &&
          b.y >= p.y && b.y <= p.y + TANK_SIZE
        ) {
          destroyed = true;
          p.hp -= 20;
          if (p.hp <= 0) {
            p.hp = 100;
            p.x = 60 + Math.random() * 360;
            p.y = 100 + Math.random() * 500;
            if (players[b.playerId]) {
              players[b.playerId].score += 1;
            }
          }
          break;
        }
      }
    }

    if (destroyed) {
      bullets.splice(i, 1);
    }
  }

  io.emit('state', { players, bullets, obstacles });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
