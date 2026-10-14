const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TANK_SPEED = 2.2;
const BODY_ROTATE_SPEED = 0.035;
const TANK_SIZE = 28;
const BULLET_SPEED = 6;
const BULLET_RADIUS = 7;

// 600 x 600 の画面に収まりやすい正方形マップ
const MAP_WIDTH = 600;
const MAP_HEIGHT = 600;
const TILE_SIZE = 40;

// マップ全体にバランスよく配置した障害物ブロック（15x15グリッド）
const obstacles = [
  { x: 3, y: 3 }, { x: 3, y: 4 },
  { x: 11, y: 3 }, { x: 11, y: 4 },
  { x: 7, y: 7 }, { x: 7, y: 8 },
  { x: 3, y: 11 }, { x: 3, y: 12 },
  { x: 11, y: 11 }, { x: 11, y: 12 }
];

let players = {};
let bullets = [];

// CPU（敵戦車）の初期化
let cpus = {
  'cpu_1': {
    x: 100,
    y: 100,
    bodyAngle: 0,
    score: 0,
    hp: 100,
    actionTimer: 0,
    targetAngle: 0
  },
  'cpu_2': {
    x: 500,
    y: 500,
    bodyAngle: Math.PI,
    score: 0,
    hp: 100,
    actionTimer: 0,
    targetAngle: Math.PI
  }
};

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

function shootBullet(shooterId, x, y, angle) {
  const bx = x + TANK_SIZE / 2 + Math.cos(angle) * 22;
  const by = y + TANK_SIZE / 2 + Math.sin(angle) * 22;

  bullets.push({
    id: Math.random().toString(),
    playerId: shooterId,
    x: bx,
    y: by,
    dx: Math.cos(angle) * BULLET_SPEED,
    dy: Math.sin(angle) * BULLET_SPEED,
    bouncesLeft: 1 // 壁1回バウンド
  });
}

io.on('connection', (socket) => {
  console.log('プレイヤー接続:', socket.id);

  players[socket.id] = {
    x: 300,
    y: 520,
    bodyAngle: -Math.PI / 2,
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
    shootBullet(socket.id, player.x, player.y, player.bodyAngle);
  });

  socket.on('disconnect', () => {
    console.log('プレイヤー切断:', socket.id);
    delete players[socket.id];
  });
});

// ゲームループ（60fps）
setInterval(() => {
  // --- CPUのAI処理 ---
  for (let id in cpus) {
    let cpu = cpus[id];
    cpu.actionTimer++;

    if (cpu.actionTimer % 60 === 0) {
      let targetX = 300, targetY = 300;
      let minDst = Infinity;
      for (let pId in players) {
        let p = players[pId];
        let dst = Math.hypot(p.x - cpu.x, p.y - cpu.y);
        if (dst < minDst) {
          minDst = dst;
          targetX = p.x;
          targetY = p.y;
        }
      }

      cpu.targetAngle = Math.atan2(targetY - cpu.y, targetX - cpu.x);

      if (Math.random() < 0.7) {
        shootBullet(id, cpu.x, cpu.y, cpu.bodyAngle);
      }
    }

    let angleDiff = cpu.targetAngle - cpu.bodyAngle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    if (Math.abs(angleDiff) > 0.04) {
      cpu.bodyAngle += Math.sign(angleDiff) * BODY_ROTATE_SPEED;
    } else {
      let newX = cpu.x + Math.cos(cpu.bodyAngle) * TANK_SPEED;
      let newY = cpu.y + Math.sin(cpu.bodyAngle) * TANK_SPEED;
      if (!checkCollision(newX, cpu.y, TANK_SIZE)) cpu.x = newX;
      if (!checkCollision(cpu.x, newY, TANK_SIZE)) cpu.y = newY;
    }
  }

  // --- 弾の移動と衝突判定 ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    let prevX = b.x;
    let prevY = b.y;

    b.x += b.dx;
    b.y += b.dy;

    let destroyed = false;

    // 壁バウンド
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

    // プレイヤーへのダメージ判定
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
            p.x = 80 + Math.random() * 440;
            p.y = 80 + Math.random() * 440;
            if (players[b.playerId]) {
              players[b.playerId].score += 1;
            }
          }
          break;
        }
      }
    }

    // CPUへのダメージ判定
    if (!destroyed) {
      for (let id in cpus) {
        if (id === b.playerId) continue;
        let c = cpus[id];
        if (
          b.x >= c.x && b.x <= c.x + TANK_SIZE &&
          b.y >= c.y && b.y <= c.y + TANK_SIZE
        ) {
          destroyed = true;
          c.hp -= 20;
          if (c.hp <= 0) {
            c.hp = 100;
            c.x = 80 + Math.random() * 440;
            c.y = 80 + Math.random() * 440;
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

  io.emit('state', { players, cpus, bullets, obstacles });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
