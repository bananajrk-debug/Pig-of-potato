const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// server.js などのソースを公開しないよう、index.html だけを配信する
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ====== ゲーム設定 ======
const MAX_HP = 100;
const START_CREDITS = 3000;
const KILL_REWARD = 200;
const PLAYER_RESPAWN_MS = 3000;
const DUMMY_RESPAWN_MS = 4000;
const MAP_LIMIT = 29;
const MAX_SHOT_DISTANCE = 150;

// 武器データ（サーバーが正。クライアントは init で受け取る）
const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'クラシック',
    type: 'ハンドガン',
    cost: 0,
    damage: 26,
    headMult: 2,
    rate: 350,       // 発射間隔(ms)
    mag: 12,
    reload: 1500,    // リロード時間(ms)
    auto: false,
    spread: 0.004,
    recoil: 0.006,
    crosshair: 'cross',
    scope: false,
    color: 0xcccccc
  },
  rifle: {
    id: 'rifle',
    name: 'ファントム',
    type: 'アサルトライフル',
    cost: 2000,
    damage: 30,
    headMult: 2,
    rate: 95,
    mag: 30,
    reload: 2200,
    auto: true,
    spread: 0.018,
    recoil: 0.012,
    crosshair: 'ring',
    scope: false,
    color: 0x3a86ff
  },
  sniper: {
    id: 'sniper',
    name: 'オペレーター',
    type: 'スナイパー',
    cost: 2500,
    damage: 120,
    headMult: 2,
    rate: 1400,
    mag: 5,
    reload: 3000,
    auto: false,
    spread: 0.06,    // 非スコープ時の散布
    recoil: 0.03,
    crosshair: 'scope',
    scope: true,
    color: 0x2a9d8f
  }
};

const SPAWNS = [
  { x: -4, z: 24 },
  { x: 0, z: 25 },
  { x: 4, z: 24 },
  { x: -8, z: 22 },
  { x: 8, z: 22 }
];

// 練習用ダミー（動かない的）
const dummies = {};
[
  { x: 18, z: -25 },
  { x: -18, z: -25 },
  { x: 0, z: -24 },
  { x: 0, z: -4 },
  { x: -22, z: -8 },
  { x: 22, z: -8 }
].forEach((pos, i) => {
  const id = `dummy${i}`;
  dummies[id] = { id, x: pos.x, y: 0, z: pos.z, hp: MAX_HP, alive: true };
});

const players = {};

// ====== ユーティリティ ======
function num(v, def = 0) {
  return Number.isFinite(v) ? v : def;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}
function publicPlayer(p) {
  return { x: p.x, y: p.y, z: p.z, rotationY: p.rotationY, alive: p.alive, name: p.name };
}
function stateOf(p) {
  return {
    hp: p.hp,
    credits: p.credits,
    weapon: p.weapon,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive
  };
}
function sendState(id) {
  const p = players[id];
  if (p) io.to(id).emit('state', stateOf(p));
}
function vec(v) {
  return { x: num(v && v.x), y: num(v && v.y), z: num(v && v.z) };
}

function publicPlayers() {
  const out = {};
  Object.keys(players).forEach((id) => {
    out[id] = publicPlayer(players[id]);
  });
  return out;
}
function publicDummies() {
  const out = {};
  Object.keys(dummies).forEach((id) => {
    const d = dummies[id];
    out[id] = { x: d.x, y: d.y, z: d.z, alive: d.alive };
  });
  return out;
}

// ====== 接続 ======
io.on('connection', (socket) => {
  console.log(`プレイヤーが接続しました: ${socket.id}`);

  const spawn = randomSpawn();
  players[socket.id] = {
    id: socket.id,
    name: 'Player-' + socket.id.slice(0, 4),
    x: spawn.x,
    y: 0,
    z: spawn.z,
    rotationY: 0,
    hp: MAX_HP,
    alive: true,
    credits: START_CREDITS,
    weapon: 'pistol',
    lastShot: 0,
    kills: 0,
    deaths: 0
  };
  const me = players[socket.id];

  // 初期データ送信
  socket.emit('init', {
    id: socket.id,
    weapons: WEAPONS,
    players: publicPlayers(),
    dummies: publicDummies(),
    spawn: { x: me.x, z: me.z },
    you: stateOf(me)
  });

  // 他のプレイヤーに新参加者を通知
  socket.broadcast.emit('newPlayer', { id: socket.id, player: publicPlayer(me) });

  // ---- 移動・視点 ----
  socket.on('move', (d) => {
    const p = players[socket.id];
    if (!p || !p.alive || !d) return;
    p.x = clamp(num(d.x, p.x), -MAP_LIMIT, MAP_LIMIT);
    p.y = clamp(num(d.y, p.y), 0, 5);
    p.z = clamp(num(d.z, p.z), -MAP_LIMIT, MAP_LIMIT);
    p.rotationY = num(d.rotationY, p.rotationY);
    socket.broadcast.emit('playerMoved', { id: socket.id, player: publicPlayer(p) });
  });

  // ---- 射撃（クライアントがRaycastで当たった相手を申告、サーバーが検証してダメージ計算）----
  socket.on('shoot', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive || !data) return;

    const w = WEAPONS[p.weapon];
    const now = Date.now();
    if (now - p.lastShot < w.rate * 0.7) return; // 連射速度チート対策（通信ゆらぎ分の余裕）
    p.lastShot = now;

    const origin = vec(data.origin);
    const direction = vec(data.direction);

    // 弾道エフェクトを他プレイヤーに共有
    socket.broadcast.emit('playerShot', {
      id: socket.id,
      origin,
      direction,
      color: w.color
    });

    const targetId = data.targetId;
    if (!targetId || targetId === socket.id) return;

    let target = null;
    let isDummy = false;
    if (players[targetId]) {
      target = players[targetId];
    } else if (dummies[targetId]) {
      target = dummies[targetId];
      isDummy = true;
    }
    if (!target || !target.alive) return;

    // 距離チェック
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    if (Math.sqrt(dx * dx + dz * dz) > MAX_SHOT_DISTANCE) return;

    const headshot = !!data.headshot;
    const damage = Math.round(w.damage * (headshot ? w.headMult : 1));
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp <= 0;

    socket.emit('hitConfirm', { targetId, damage, killed, headshot });

    if (!isDummy) sendState(targetId);

    if (killed) {
      target.alive = false;
      p.kills += 1;
      p.credits += KILL_REWARD;

      const victimName = isDummy ? 'ダミー' : target.name;
      io.emit('targetDied', {
        id: targetId,
        killerId: socket.id,
        killerName: p.name,
        victimName,
        headshot
      });
      sendState(socket.id);

      if (isDummy) {
        setTimeout(() => {
          target.hp = MAX_HP;
          target.alive = true;
          io.emit('targetRespawn', { id: targetId, x: target.x, z: target.z });
        }, DUMMY_RESPAWN_MS);
      } else {
        target.deaths += 1;
        sendState(targetId);
        setTimeout(() => {
          const t = players[targetId];
          if (!t) return;
          const sp = randomSpawn();
          t.x = sp.x;
          t.y = 0;
          t.z = sp.z;
          t.hp = MAX_HP;
          t.alive = true;
          io.emit('targetRespawn', { id: targetId, x: sp.x, z: sp.z });
          sendState(targetId);
        }, PLAYER_RESPAWN_MS);
      }
    }
  });

  // ---- 武器購入 ----
  socket.on('buy', (weaponId) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    const w = WEAPONS[weaponId];
    if (!w) return;
    if (p.weapon === weaponId) return;
    if (p.credits < w.cost) {
      socket.emit('buyResult', { ok: false, message: 'クレジットが足りません' });
      return;
    }
    p.credits -= w.cost;
    p.weapon = weaponId;
    socket.emit('buyResult', { ok: true, weapon: weaponId });
    sendState(socket.id);
  });

  // ---- 切断 ----
  socket.on('disconnect', () => {
    console.log(`プレイヤーが切断しました: ${socket.id}`);
    delete players[socket.id];
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
