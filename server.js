const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TANK_SPEED = 2.0;
const BODY_ROTATE_SPEED = 0.03;
const TANK_SIZE = 30;
const BULLET_SPEED = 6;
const BULLET_RADIUS = 8;

// 800 x 800 の広めの正方形マップ
const MAP_WIDTH = 800;
const MAP_HEIGHT = 800;
const TILE_SIZE = 40;

// マップ全体に配置された障害物ブロック
const obstacles = [
  { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 4 },
  { x: 15, y: 4 }, { x: 15, y: 5 }, { x: 16, y: 4 },
  { x: 4, y: 15 }, { x: 4, y: 16 }, { x: 5, y: 15 },
  { x: 15, y: 15 }, { x: 15, y: 16 }, { x: 16, y: 15 },
  { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 11 }, { x: 10, y: 11 },
  { x: 2, y: 9 }, { x: 17, y: 9 }, { x: 9, y: 2 }, { x: 9, y: 17 }
];

let players = {};
let bullets = [];

// CPU（敵戦車）の初期化
let cpus = {
  'cpu_1': {
    x: 150,
    y: 150,
    bodyAngle: 0,
    score: 0,
    hp: 100,
    actionTimer: 0,
    targetAngle: 0
  },
  'cpu_2': {
    x: 650,
    y: 650,
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

// 弾を発射する共通関数
function shootBullet(shooterId, x, y, angle) {
  const bx = x + TANK_SIZE / 2 + Math.cos(angle) * 25;
  const by = y + TANK_SIZE / 2 + Math.sin(angle) * 25;

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
    x: 400,
    y: 700,
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

    // 一定間隔で思考（プレイヤーの方向を向く、またはランダム移動）
    if (cpu.actionTimer % 70 === 0) {
      let targetX = 400, targetY = 400;
      // 最も近いプレイヤーを探す
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

      // 確率で射撃
      if (Math.random() < 0.8) {
        shootBullet(id, cpu.x, cpu.y, cpu.bodyAngle);
      }
    }

    // 角度をスムーズに目標へ向ける
    let angleDiff = cpu.targetAngle - cpu.bodyAngle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    if (Math.abs(angleDiff) > 0.03) {
      cpu.bodyAngle += Math.sign(angleDiff) * BODY_ROTATE_SPEED;
    } else {
      // 前進
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
            p.x = 100 + Math.random() * 600;
            p.y = 100 + Math.random() * 600;
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
            c.x = 100 + Math.random() * 600;
            c.y = 100 + Math.random() * 600;
            if (players[b.playerId]) {
              players[b.playerId].score += 1; // プレイヤーが倒したらスコア加算
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

  // 全クライアントに状態送信（cpusも含める）
  io.emit('state', { players, cpus, bullets, obstacles });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
