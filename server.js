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
const TURRET_ROTATE_SPEED = 0.04;
const TANK_SIZE = 30;
const BULLET_SPEED = 7;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const TILE_SIZE = 40;

const obstacles = [
  { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 },
  { x: 10, y: 2 }, { x: 10, y: 3 }, { x: 10, y: 4 },
  { x: 12, y: 9 }, { x: 13, y: 9 }, { x: 14, y: 9 },
  { x: 4, y: 10 }, { x: 5, y: 10 },
  { x: 15, y: 3 }, { x: 15, y: 4 },
  { x: 2, y: 12 }, { x: 17, y: 11 }
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
    x: 100,
    y: 100,
    bodyAngle: 0,    // 車体の向き
    turretOffset: 0, // 車体から見た砲身の相対角度
    score: 0,
    hp: 100
  };

  socket.on('input', (data) => {
    const player = players[socket.id];
    if (!player) return;

    // A / D で車体を左右に旋回
    if (data.turnLeft) player.bodyAngle -= BODY_ROTATE_SPEED;
    if (data.turnRight) player.bodyAngle += BODY_ROTATE_SPEED;

    // K / O で砲身を車体に対して独立回転
    if (data.turretLeft) player.turretOffset -= TURRET_ROTATE_SPEED;
    if (data.turretRight) player.turretOffset += TURRET_ROTATE_SPEED;

    // W / S で車体の向いている方向に前進・後退
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

    // 実際の砲身の向き（車体角度 + 相対角度）
    const currentTurretAngle = player.bodyAngle + player.turretOffset;

    const bx = player.x + TANK_SIZE / 2 + Math.cos(currentTurretAngle) * 25;
    const by = player.y + TANK_SIZE / 2 + Math.sin(currentTurretAngle) * 25;

    bullets.push({
      id: Math.random().toString(),
      playerId: socket.id,
      x: bx,
      y: by,
      dx: Math.cos(currentTurretAngle) * BULLET_SPEED,
      dy: Math.sin(currentTurretAngle) * BULLET_SPEED
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
    b.x += b.dx;
    b.y += b.dy;

    let hit = false;

    if (b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) {
      hit = true;
    } else {
      for (let obs of obstacles) {
        const obsX = obs.x * TILE_SIZE;
        const obsY = obs.y * TILE_SIZE;
        if (
          b.x >= obsX && b.x <= obsX + TILE_SIZE &&
          b.y >= obsY && b.y <= obsY + TILE_SIZE
        ) {
          hit = true;
          break;
        }
      }
    }

    if (!hit) {
      for (let id in players) {
        if (id === b.playerId) continue;
        let p = players[id];
        if (
          b.x >= p.x && b.x <= p.x + TANK_SIZE &&
          b.y >= p.y && b.y <= p.y + TANK_SIZE
        ) {
          hit = true;
          p.hp -= 20;
          if (p.hp <= 0) {
            p.hp = 100;
            p.x = 80 + Math.random() * 200;
            p.y = 80 + Math.random() * 200;
            if (players[b.playerId]) {
              players[b.playerId].score += 1;
            }
          }
          break;
        }
      }
    }

    if (hit) {
      bullets.splice(i, 1);
    }
  }

  io.emit('state', { players, bullets, obstacles });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
