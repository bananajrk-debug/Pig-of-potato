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

// =====================================================
//  ゲーム設定
// =====================================================
const MAX_HP = 100;
const WIN_SCORE = 5;              // 5点先取
const SWAP_AFTER_ROUNDS = 4;      // 4ラウンド終了で攻守交代
const BUY_MS = 12000;             // 準備（購入）フェーズ
const LIVE_MS = 100000;           // 戦闘フェーズ
const FUSE_MS = 35000;            // 樽の導火線
const ROUND_END_MS = 5000;
const MATCH_END_MS = 12000;
const PLANT_MS = 3500;            // 樽の設置ゲージ
const DEFUSE_MS = 6000;           // 樽の解除ゲージ
const DEFUSE_RADIUS = 3.2;
const START_CREDITS = 2500;
const CREDIT_CAP = 9000;
const KILL_REWARD = 200;
const WIN_REWARD = 3000;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;
const DEFUSE_REWARD = 300;
const MAX_SHOT_DISTANCE = 220;
const MAP_LIMIT_X = 24;
const MAP_LIMIT_Z = 34;
const DROWN_Y = -6;
const BOT_COUNT = 3;              // 相手チームが不在のとき置く動かない的の数

// 設置サイト（防衛側の船の上）
const SITES = [
  { id: 'A', name: '船首楼', x: 11, y: 1.1, z: -21.5, r: 4.2 },
  { id: 'B', name: '大砲甲板', x: 11, y: 0, z: 7, r: 4.2 }
];

// ---- 武器（サーバーが正）----
const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'フリントロック', type: 'ピストル', cost: 0,
    damage: 28, headMult: 2, pellets: 1, rate: 350, mag: 12, reload: 1500,
    auto: false, spread: 0.004, recoil: 0.012, crosshair: 'cross', scope: false,
    falloff: { start: 25, end: 70, min: 0.7 }, color: 0xffd27a
  },
  shotgun: {
    id: 'shotgun', name: 'ブランダーバス', type: 'ショットガン', cost: 1100,
    damage: 14, headMult: 1.5, pellets: 8, rate: 850, mag: 6, reload: 2400,
    auto: false, spread: 0.075, recoil: 0.05, crosshair: 'ring', scope: false,
    falloff: { start: 6, end: 24, min: 0.15 }, color: 0xff7a3a
  },
  rifle: {
    id: 'rifle', name: 'ブッカニア・ライフル', type: 'アサルトライフル', cost: 2900,
    damage: 30, headMult: 2, pellets: 1, rate: 95, mag: 30, reload: 2300,
    auto: true, spread: 0.014, recoil: 0.012, crosshair: 'cross', scope: false,
    falloff: { start: 35, end: 90, min: 0.8 }, color: 0x3a86ff
  },
  sniper: {
    id: 'sniper', name: 'ロングバレル・マスケット', type: 'スナイパー', cost: 4300,
    damage: 115, headMult: 2, pellets: 1, rate: 1400, mag: 5, reload: 3200,
    auto: false, spread: 0.07, recoil: 0.04, crosshair: 'dot', scope: true,
    falloff: { start: 999, end: 1000, min: 1 }, color: 0x2a9d8f
  }
};

// ---- アビリティ ----
const ABILITIES = {
  smoke:   { id: 'smoke',   name: '煙幕樽',         cooldown: 22000, desc: '照準地点に煙幕を展開（9秒）' },
  blink:   { id: 'blink',   name: 'ブリンク',       cooldown: 12000, desc: '視線方向へ瞬間移動' },
  grenade: { id: 'grenade', name: '炸裂樽',         cooldown: 20000, desc: '火薬樽を投げ込み範囲爆破' },
  haste:   { id: 'haste',   name: 'ラム酒ダッシュ', cooldown: 16000, desc: '4秒間 移動速度アップ' },
  scan:    { id: 'scan',    name: '望遠鏡スキャン', cooldown: 22000, desc: '4秒間 全ての敵を透視（味方に共有）' },
  heal:    { id: 'heal',    name: '応急手当',       cooldown: 25000, desc: '自分と近くの味方を回復' }
};

// ---- キャラクター ----
const CHARACTERS = {
  captain: {
    id: 'captain', name: 'キャプテン・レッド', role: '指揮官',
    q: 'smoke', e: 'blink',
    desc: '海賊団を率いる赤髭の船長。煙幕で視界を奪い、ブリンクで戦場を切り裂く。'
  },
  gunner: {
    id: 'gunner', name: '砲術長 ガンナー', role: '爆破担当',
    q: 'grenade', e: 'haste',
    desc: '樽爆弾のスペシャリスト。炸裂樽で敵を追い出し、ラム酒で一気に駆け抜ける。'
  },
  navigator: {
    id: 'navigator', name: '航海士 ナビ', role: '偵察',
    q: 'scan', e: 'blink',
    desc: '望遠鏡で敵の位置を見抜く索敵のプロ。ブリンクで高台へ素早く移動できる。'
  },
  surgeon: {
    id: 'surgeon', name: '船医 ドクター', role: '支援',
    q: 'heal', e: 'smoke',
    desc: '仲間の傷を癒やす腕利きの船医。煙幕で安全に設置・解除をサポートする。'
  }
};

// スポーン（役割ごとに別の船）。船の中心 x: 攻撃=-11 / 防衛=+11
const SPAWN_Y = 2.2;
function spawnPoints(role) {
  const cx = role === 'attack' ? -11 : 11;
  const pts = [];
  [-3.5, -1.75, 0, 1.75, 3.5].forEach((dx) => {
    pts.push({ x: cx + dx, y: SPAWN_Y, z: 18.5 });
    pts.push({ x: cx + dx, y: SPAWN_Y, z: 20.8 });
  });
  return pts;
}

// =====================================================
//  状態
// =====================================================
const players = {};
const match = {
  phase: 'waiting', // waiting | buy | live | planted | roundEnd | matchEnd
  round: 0,
  score: { A: 0, B: 0 },
  attackTeam: 'A',
  phaseEndsAt: 0,
  bomb: null,
  smokes: []
};
let smokeSeq = 1;
let lastBroadcast = 0;

// =====================================================
//  ユーティリティ
// =====================================================
function num(v, def = 0) {
  return Number.isFinite(v) ? v : def;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function vec(v) {
  return { x: num(v && v.x), y: num(v && v.y), z: num(v && v.z) };
}
function otherTeam(t) {
  return t === 'A' ? 'B' : 'A';
}
function roleOf(p) {
  return p.team === match.attackTeam ? 'attack' : 'defend';
}
function matchPlayers() {
  return Object.values(players).filter((p) => p.inMatch);
}
function realMatchPlayers() {
  return matchPlayers().filter((p) => !p.isBot);
}
function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function dist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
function capCredits(p) {
  p.credits = Math.min(CREDIT_CAP, p.credits);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    character: p.character,
    x: p.x, y: p.y, z: p.z,
    rotationY: p.rotationY,
    pitch: p.pitch,
    alive: p.alive,
    weapon: p.weapon,
    isBot: !!p.isBot,
    kills: p.kills,
    deaths: p.deaths
  };
}
function publicPlayers() {
  const out = {};
  matchPlayers().forEach((p) => {
    out[p.id] = publicPlayer(p);
  });
  return out;
}
function stateOf(p) {
  const now = Date.now();
  return {
    hp: p.hp,
    credits: p.credits,
    weapon: p.weapon,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive,
    team: p.team,
    character: p.character,
    q: Math.max(0, p.abilityReady.q - now),
    e: Math.max(0, p.abilityReady.e - now),
    haste: Math.max(0, p.hasteUntil - now)
  };
}
function sendState(p) {
  if (p && !p.isBot) io.to(p.id).emit('state', stateOf(p));
}
function matchPayload() {
  const now = Date.now();
  return {
    phase: match.phase,
    round: match.round,
    score: match.score,
    attackTeam: match.attackTeam,
    winScore: WIN_SCORE,
    swapAfter: SWAP_AFTER_ROUNDS,
    timeLeft: Math.max(0, match.phaseEndsAt - now),
    bomb: match.bomb
      ? {
          x: match.bomb.x, y: match.bomb.y, z: match.bomb.z,
          site: match.bomb.site,
          timeLeft: Math.max(0, match.bomb.explodeAt - now)
        }
      : null
  };
}
function broadcastMatch() {
  lastBroadcast = Date.now();
  io.to('match').emit('matchState', matchPayload());
}
function broadcastOnline() {
  const total = Object.values(players).filter((p) => !p.isBot).length;
  io.emit('online', { total, inMatch: realMatchPlayers().length });
}
function emitMatch(ev, data) {
  io.to('match').emit(ev, data);
}
function notice(p, text) {
  if (p && !p.isBot) io.to(p.id).emit('notice', text);
}

// =====================================================
//  ボット（相手チームが空のときの動かない的）
// =====================================================
function ensureBots() {
  Object.keys(players).forEach((id) => {
    if (players[id].isBot) delete players[id];
  });
  const real = { A: 0, B: 0 };
  realMatchPlayers().forEach((p) => { real[p.team] += 1; });
  if (real.A + real.B === 0) return;
  ['A', 'B'].forEach((team) => {
    if (real[team] > 0) return;
    const chars = Object.keys(CHARACTERS);
    for (let i = 0; i < BOT_COUNT; i++) {
      const id = `bot-${team}${i}`;
      players[id] = {
        id, name: `見習い水夫${i + 1}`, character: chars[i % chars.length],
        inMatch: true, isBot: true, team,
        x: 0, y: 0, z: 0, rotationY: 0, pitch: 0,
        hp: MAX_HP, alive: true, credits: 0, weapon: 'pistol',
        lastShot: 0, kills: 0, deaths: 0,
        abilityReady: { q: 0, e: 0 }, hasteUntil: 0, interact: null
      };
    }
  });
}

// =====================================================
//  ラウンド / マッチ進行
// =====================================================
function placeAtSpawn(p, idx) {
  const pts = spawnPoints(roleOf(p));
  const sp = pts[(idx === undefined ? Math.floor(Math.random() * pts.length) : idx) % pts.length];
  p.x = sp.x; p.y = sp.y; p.z = sp.z;
  p.rotationY = 0; p.pitch = 0;
}

function resetToWaiting() {
  Object.keys(players).forEach((id) => {
    if (players[id].isBot) delete players[id];
  });
  match.phase = 'waiting';
  match.round = 0;
  match.score = { A: 0, B: 0 };
  match.attackTeam = 'A';
  match.bomb = null;
  match.smokes = [];
  match.phaseEndsAt = 0;
}

function startMatch() {
  match.score = { A: 0, B: 0 };
  match.round = 0;
  match.attackTeam = 'A';
  matchPlayers().forEach((p) => {
    p.credits = START_CREDITS;
    p.weapon = 'pistol';
    p.kills = 0;
    p.deaths = 0;
  });
  startRound();
}

function startRound() {
  if (realMatchPlayers().length === 0) {
    resetToWaiting();
    return;
  }
  match.round += 1;
  match.bomb = null;
  match.smokes = [];
  ensureBots();
  match.phase = 'buy';
  match.phaseEndsAt = Date.now() + BUY_MS;

  const counters = { attack: 0, defend: 0 };
  matchPlayers().forEach((p) => {
    const role = roleOf(p);
    placeAtSpawn(p, counters[role]++);
    p.hp = MAX_HP;
    p.alive = true;
    p.interact = null;
    p.hasteUntil = 0;
    p.abilityReady = { q: 0, e: 0 };
  });

  emitMatch('roundStart', {
    round: match.round,
    attackTeam: match.attackTeam,
    score: match.score,
    players: publicPlayers()
  });
  realMatchPlayers().forEach(sendState);
  broadcastMatch();
}

function endRound(winnerTeam, reason) {
  if (match.phase !== 'live' && match.phase !== 'planted') return;
  match.score[winnerTeam] += 1;
  matchPlayers().forEach((p) => {
    p.interact = null;
    if (p.isBot) return;
    p.credits += p.team === winnerTeam ? WIN_REWARD : LOSS_REWARD;
    capCredits(p);
  });
  const matchOver = match.score[winnerTeam] >= WIN_SCORE;
  match.phase = matchOver ? 'matchEnd' : 'roundEnd';
  match.phaseEndsAt = Date.now() + (matchOver ? MATCH_END_MS : ROUND_END_MS);

  emitMatch('roundEnd', {
    winnerTeam, reason, score: match.score, round: match.round,
    attackTeam: match.attackTeam, matchOver
  });
  if (matchOver) emitMatch('matchEnd', { winnerTeam, score: match.score });
  realMatchPlayers().forEach(sendState);
  broadcastMatch();
}

function checkRoundEnd() {
  if (match.phase !== 'live' && match.phase !== 'planted') return;
  const alive = { A: 0, B: 0 };
  matchPlayers().forEach((p) => { if (p.alive) alive[p.team] += 1; });
  const atk = match.attackTeam;
  const def = otherTeam(atk);
  if (alive[def] === 0) {
    endRound(atk, 'eliminated');
  } else if (alive[atk] === 0 && match.phase === 'live') {
    endRound(def, 'eliminated');
  }
}

// =====================================================
//  ダメージ / 死亡
// =====================================================
function applyDamage(attacker, target, dmg, meta) {
  if (!target || !target.alive) return false;
  target.hp = Math.max(0, target.hp - dmg);
  const killed = target.hp <= 0;
  if (attacker && !attacker.isBot) {
    io.to(attacker.id).emit('hitConfirm', {
      targetId: target.id, damage: dmg, killed, headshot: !!meta.headshot
    });
  }
  if (!target.isBot) {
    io.to(target.id).emit('damaged', {
      damage: dmg,
      from: attacker ? { x: attacker.x, z: attacker.z } : null
    });
  }
  if (killed) killPlayer(target, attacker, meta);
  else sendState(target);
  return killed;
}

function killPlayer(target, attacker, meta) {
  target.alive = false;
  target.hp = 0;
  target.deaths += 1;
  target.weapon = 'pistol';
  cancelInteract(target);
  if (attacker && attacker.id !== target.id) {
    attacker.kills += 1;
    if (!attacker.isBot) {
      attacker.credits += KILL_REWARD;
      capCredits(attacker);
    }
  }
  emitMatch('targetDied', {
    id: target.id,
    killerId: attacker ? attacker.id : null,
    killerName: attacker ? attacker.name : (meta.cause === 'drown' ? '海' : '事故'),
    victimName: target.name,
    weapon: meta.weapon || (meta.cause || null),
    headshot: !!meta.headshot
  });
  sendState(target);
  if (attacker) sendState(attacker);
  checkRoundEnd();
}

function falloffFactor(w, d) {
  const f = w.falloff;
  if (!f || d <= f.start) return 1;
  if (d >= f.end) return f.min;
  return 1 - (1 - f.min) * ((d - f.start) / (f.end - f.start));
}

// =====================================================
//  樽（爆弾）の設置 / 解除
// =====================================================
function cancelInteract(p) {
  if (p && p.interact) {
    p.interact = null;
    if (!p.isBot) io.to(p.id).emit('interactProgress', { kind: null, progress: 0 });
  }
}

function siteAt(p) {
  return SITES.find((s) => dist2(p, s) <= s.r && Math.abs(p.y - s.y) < 2.6) || null;
}

function validInteract(p, it) {
  if (!p.alive || !p.inMatch) return false;
  if (dist2(p, { x: it.sx, z: it.sz }) > 0.9) return false;
  if (it.kind === 'plant') {
    return match.phase === 'live' && !match.bomb && roleOf(p) === 'attack' && !!siteAt(p);
  }
  if (it.kind === 'defuse') {
    return match.phase === 'planted' && match.bomb && roleOf(p) === 'defend' &&
      dist2(p, match.bomb) <= DEFUSE_RADIUS && Math.abs(p.y - match.bomb.y) < 2.6;
  }
  return false;
}

function completeInteract(p, it) {
  p.interact = null;
  io.to(p.id).emit('interactProgress', { kind: null, progress: 0 });
  if (it.kind === 'plant') {
    const site = siteAt(p);
    const now = Date.now();
    match.bomb = {
      x: p.x, y: p.y, z: p.z, site: site ? site.id : '?',
      plantedAt: now, explodeAt: now + FUSE_MS
    };
    match.phase = 'planted';
    match.phaseEndsAt = match.bomb.explodeAt;
    p.credits += PLANT_REWARD;
    capCredits(p);
    sendState(p);
    emitMatch('bombPlanted', {
      x: p.x, y: p.y, z: p.z, site: site ? site.id : '?', siteName: site ? site.name : '',
      timeLeft: FUSE_MS, by: p.name
    });
    broadcastMatch();
  } else if (it.kind === 'defuse') {
    p.credits += DEFUSE_REWARD;
    capCredits(p);
    sendState(p);
    emitMatch('bombDefused', { by: p.name });
    endRound(otherTeam(match.attackTeam), 'defused');
  }
}

function processInteractions(now) {
  realMatchPlayers().forEach((p) => {
    const it = p.interact;
    if (!it) return;
    const dt = now - it.last;
    it.last = now;
    if (!validInteract(p, it)) {
      cancelInteract(p);
      return;
    }
    it.progress += dt;
    const need = it.kind === 'plant' ? PLANT_MS : DEFUSE_MS;
    io.to(p.id).emit('interactProgress', { kind: it.kind, progress: Math.min(1, it.progress / need) });
    if (it.progress >= need) completeInteract(p, it);
  });
}

// =====================================================
//  メインティック
// =====================================================
setInterval(() => {
  const now = Date.now();
  if (match.phase === 'waiting') return;

  match.smokes = match.smokes.filter((s) => s.until > now);

  switch (match.phase) {
    case 'buy':
      if (now >= match.phaseEndsAt) {
        match.phase = 'live';
        match.phaseEndsAt = now + LIVE_MS;
        broadcastMatch();
      }
      break;
    case 'live':
      if (now >= match.phaseEndsAt) endRound(otherTeam(match.attackTeam), 'time');
      break;
    case 'planted':
      if (match.bomb && now >= match.bomb.explodeAt) {
        emitMatch('bombExploded', { x: match.bomb.x, y: match.bomb.y, z: match.bomb.z });
        endRound(match.attackTeam, 'exploded');
      }
      break;
    case 'roundEnd':
      if (now >= match.phaseEndsAt) {
        if (match.round === SWAP_AFTER_ROUNDS) {
          match.attackTeam = otherTeam(match.attackTeam);
          matchPlayers().forEach((p) => {
            p.credits = START_CREDITS;
            p.weapon = 'pistol';
          });
          emitMatch('sidesSwapped', { attackTeam: match.attackTeam });
        }
        startRound();
      }
      break;
    case 'matchEnd':
      if (now >= match.phaseEndsAt) {
        if (realMatchPlayers().length > 0) startMatch();
        else resetToWaiting();
      }
      break;
    default:
      break;
  }

  processInteractions(now);
  if (match.phase !== 'waiting' && now - lastBroadcast >= 1000) broadcastMatch();
}, 100);

// =====================================================
//  接続
// =====================================================
function leaveMatch(p, socket) {
  if (!p.inMatch) return;
  cancelInteract(p);
  p.inMatch = false;
  p.alive = false;
  if (socket) socket.leave('match');
  emitMatch('disconnectPlayer', p.id);
  if (realMatchPlayers().length === 0) {
    resetToWaiting();
  } else {
    checkRoundEnd();
  }
  broadcastOnline();
}

io.on('connection', (socket) => {
  console.log(`プレイヤーが接続しました: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    name: 'Pirate-' + socket.id.slice(0, 4),
    character: 'captain',
    inMatch: false,
    isBot: false,
    team: 'A',
    x: 0, y: 0, z: 0, rotationY: 0, pitch: 0,
    hp: MAX_HP,
    alive: false,
    credits: START_CREDITS,
    weapon: 'pistol',
    lastShot: 0,
    kills: 0,
    deaths: 0,
    abilityReady: { q: 0, e: 0 },
    hasteUntil: 0,
    interact: null
  };

  socket.emit('init', {
    id: socket.id,
    weapons: WEAPONS,
    characters: CHARACTERS,
    abilities: ABILITIES,
    sites: SITES,
    config: {
      winScore: WIN_SCORE, swapAfter: SWAP_AFTER_ROUNDS,
      plantMs: PLANT_MS, defuseMs: DEFUSE_MS, defuseRadius: DEFUSE_RADIUS
    }
  });
  broadcastOnline();

  // ---- ロビー：名前 / キャラ設定 ----
  socket.on('setProfile', (d) => {
    const p = players[socket.id];
    if (!p || !d || p.inMatch) return;
    if (typeof d.name === 'string') {
      const n = d.name.trim().slice(0, 12);
      if (n) p.name = n;
    }
    if (typeof d.character === 'string' && CHARACTERS[d.character]) p.character = d.character;
  });

  // ---- マッチ参加 ----
  socket.on('joinMatch', (d) => {
    const p = players[socket.id];
    if (!p || p.inMatch) return;
    if (d && typeof d.name === 'string') {
      const n = d.name.trim().slice(0, 12);
      if (n) p.name = n;
    }
    if (d && typeof d.character === 'string' && CHARACTERS[d.character]) p.character = d.character;

    const counts = { A: 0, B: 0 };
    realMatchPlayers().forEach((q) => { counts[q.team] += 1; });
    p.team = counts.A <= counts.B ? 'A' : 'B';
    p.inMatch = true;
    p.credits = START_CREDITS;
    p.weapon = 'pistol';
    p.kills = 0;
    p.deaths = 0;
    p.hp = MAX_HP;
    p.hasteUntil = 0;
    p.abilityReady = { q: 0, e: 0 };
    p.interact = null;
    socket.join('match');

    if (match.phase === 'buy') {
      p.alive = true;
      placeAtSpawn(p);
    } else if (match.phase === 'waiting') {
      p.alive = true;
      placeAtSpawn(p);
    } else {
      p.alive = false; // 進行中の試合では次のラウンドから参加
      p.hp = 0;
      placeAtSpawn(p);
    }

    const now = Date.now();
    socket.emit('joined', {
      team: p.team,
      you: stateOf(p),
      match: matchPayload(),
      players: publicPlayers(),
      smokes: match.smokes.map((s) => ({
        id: s.id, x: s.x, y: s.y, z: s.z, r: s.r, duration: Math.max(0, s.until - now)
      }))
    });
    socket.to('match').emit('newPlayer', { id: p.id, player: publicPlayer(p) });

    if (match.phase === 'waiting') startMatch();
    broadcastOnline();
  });

  socket.on('leaveMatch', () => {
    const p = players[socket.id];
    if (!p) return;
    leaveMatch(p, socket);
  });

  // ---- 移動・視点 ----
  socket.on('move', (d) => {
    const p = players[socket.id];
    if (!p || !p.inMatch || !p.alive || !d) return;
    if (match.phase === 'buy') return; // 準備フェーズは移動不可
    p.x = clamp(num(d.x, p.x), -MAP_LIMIT_X, MAP_LIMIT_X);
    p.y = clamp(num(d.y, p.y), -30, 40);
    p.z = clamp(num(d.z, p.z), -MAP_LIMIT_Z, MAP_LIMIT_Z);
    p.rotationY = num(d.rotationY, p.rotationY);
    p.pitch = clamp(num(d.pitch, p.pitch), -1.5, 1.5);
    if (p.y < DROWN_Y) {
      applyDamage(null, p, 999, { cause: 'drown' });
      return;
    }
    socket.to('match').emit('playerMoved', { id: p.id, player: publicPlayer(p) });
  });

  // ---- 射撃（クライアントがRaycastの結果を申告、サーバーが検証）----
  socket.on('shoot', (data) => {
    const p = players[socket.id];
    if (!p || !p.inMatch || !p.alive || !data) return;
    if (match.phase !== 'live' && match.phase !== 'planted') return;

    const w = WEAPONS[p.weapon];
    const now = Date.now();
    if (now - p.lastShot < w.rate * 0.7) return; // 連射チート対策（通信ゆらぎ分の余裕）
    p.lastShot = now;
    cancelInteract(p);

    socket.to('match').emit('playerShot', {
      id: p.id,
      origin: vec(data.origin),
      direction: vec(data.direction),
      weapon: w.id,
      color: w.color
    });

    const hits = Array.isArray(data.hits) ? data.hits.slice(0, 8) : [];
    let pelletsLeft = w.pellets;
    hits.forEach((h) => {
      if (!h || pelletsLeft <= 0) return;
      const target = players[h.targetId];
      if (!target || target.id === p.id || !target.alive || !target.inMatch) return;
      if (target.team === p.team) return; // フレンドリーファイア無効
      const n = clamp(Math.floor(num(h.n, 0)), 0, pelletsLeft);
      pelletsLeft -= n;
      const hd = clamp(Math.floor(num(h.h, 0)), 0, pelletsLeft);
      pelletsLeft -= hd;
      if (n + hd === 0) return;
      const d = dist3(p, target);
      if (d > MAX_SHOT_DISTANCE) return;
      const factor = falloffFactor(w, d);
      const dmg = Math.max(1, Math.round(factor * w.damage * (n + hd * w.headMult)));
      applyDamage(p, target, dmg, { weapon: w.id, headshot: hd > 0 });
    });
  });

  // ---- 武器購入（準備フェーズのみ）----
  socket.on('buy', (weaponId) => {
    const p = players[socket.id];
    if (!p || !p.inMatch || !p.alive) return;
    if (match.phase !== 'buy') {
      socket.emit('buyResult', { ok: false, message: '購入できるのは準備フェーズだけです' });
      return;
    }
    const w = WEAPONS[weaponId];
    if (!w || p.weapon === weaponId) return;
    if (p.credits < w.cost) {
      socket.emit('buyResult', { ok: false, message: 'クレジットが足りません' });
      return;
    }
    p.credits -= w.cost;
    p.weapon = weaponId;
    socket.emit('buyResult', { ok: true, weapon: weaponId });
    sendState(p);
    socket.to('match').emit('playerMoved', { id: p.id, player: publicPlayer(p) });
  });

  // ---- 設置 / 解除（Fキー長押し）----
  socket.on('interact', (d) => {
    const p = players[socket.id];
    if (!p || !p.inMatch || !p.alive) return;
    if (!d || !d.on) {
      cancelInteract(p);
      return;
    }
    if (p.interact) return;
    let kind = null;
    if (match.phase === 'live' && roleOf(p) === 'attack' && !match.bomb) {
      if (siteAt(p)) kind = 'plant';
      else { notice(p, '設置サイトの中で実行してください'); return; }
    } else if (match.phase === 'planted' && roleOf(p) === 'defend' && match.bomb) {
      if (dist2(p, match.bomb) <= DEFUSE_RADIUS) kind = 'defuse';
      else { notice(p, '樽に近づいてください'); return; }
    }
    if (!kind) return;
    p.interact = { kind, progress: 0, last: Date.now(), sx: p.x, sz: p.z };
  });

  // ---- アビリティ ----
  socket.on('ability', (d) => {
    const p = players[socket.id];
    if (!p || !p.inMatch || !p.alive || !d) return;
    if (match.phase !== 'live' && match.phase !== 'planted') return;
    const slot = d.slot === 'e' ? 'e' : 'q';
    const ch = CHARACTERS[p.character];
    const abId = ch[slot];
    const ab = ABILITIES[abId];
    const now = Date.now();
    if (now < p.abilityReady[slot]) {
      socket.emit('abilityResult', { slot, ok: false, message: 'クールダウン中' });
      return;
    }
    p.abilityReady[slot] = now + ab.cooldown;
    cancelInteract(p);

    // 照準地点（距離制限つき）
    const maxD = abId === 'smoke' ? 40 : 30;
    let aim = d.aim ? vec(d.aim) : { x: p.x, y: p.y, z: p.z };
    const dd = dist3(p, aim);
    if (dd > maxD) {
      const k = maxD / dd;
      aim = { x: p.x + (aim.x - p.x) * k, y: p.y + (aim.y - p.y) * k, z: p.z + (aim.z - p.z) * k };
    }

    switch (abId) {
      case 'smoke': {
        const s = { id: smokeSeq++, x: aim.x, y: aim.y, z: aim.z, r: 4.3, until: now + 9000 };
        match.smokes.push(s);
        emitMatch('smoke', { id: s.id, x: s.x, y: s.y, z: s.z, r: s.r, duration: 9000 });
        break;
      }
      case 'grenade': {
        const delay = 1100;
        emitMatch('grenade', {
          from: { x: p.x, y: p.y + 1.5, z: p.z },
          to: aim, delay
        });
        const thrower = p.id;
        setTimeout(() => {
          if (match.phase !== 'live' && match.phase !== 'planted') return;
          const R = 6;
          emitMatch('explosion', { x: aim.x, y: aim.y, z: aim.z, r: R, kind: 'grenade' });
          const owner = players[thrower];
          matchPlayers().forEach((t) => {
            if (!t.alive) return;
            if (owner && t.team === owner.team && t.id !== owner.id) return;
            const dist = dist3(t, { x: aim.x, y: aim.y, z: aim.z });
            if (dist > R) return;
            let dmg = Math.round(95 * (1 - dist / R));
            if (owner && t.id === owner.id) dmg = Math.round(dmg * 0.5);
            if (dmg <= 0) return;
            applyDamage(owner || null, t, dmg, { weapon: 'grenade', cause: 'grenade' });
          });
        }, delay);
        break;
      }
      case 'haste':
        p.hasteUntil = now + 4000;
        socket.emit('haste', { duration: 4000 });
        break;
      case 'scan':
        realMatchPlayers().forEach((t) => {
          if (t.team === p.team) io.to(t.id).emit('scan', { duration: 4000, by: p.name });
        });
        break;
      case 'heal': {
        const R = 6.5;
        matchPlayers().forEach((t) => {
          if (!t.alive || t.team !== p.team) return;
          if (t.id !== p.id && dist3(t, p) > R) return;
          const amount = t.id === p.id ? 60 : 40;
          t.hp = Math.min(MAX_HP, t.hp + amount);
          sendState(t);
        });
        emitMatch('healFx', { x: p.x, y: p.y, z: p.z, r: R });
        break;
      }
      default:
        break;
    }

    socket.emit('abilityResult', { slot, ok: true, ability: abId, cooldown: ab.cooldown });
    sendState(p);
  });

  // ---- 切断 ----
  socket.on('disconnect', () => {
    console.log(`プレイヤーが切断しました: ${socket.id}`);
    const p = players[socket.id];
    if (p) {
      leaveMatch(p, null);
      delete players[socket.id];
    }
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
