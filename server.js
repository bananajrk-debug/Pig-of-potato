'use strict';
// =====================================================
//  POLY PIRATES  -  海戦版 サーバー
//  Node.js + Express + Socket.io
//  ・舵 / 大砲 / 修理 / 敗北時の大爆発  ・セーブデータ永続化  ・フレンド  ・CPU(Bot)
// =====================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 3e5 });

// server.js などのソースを公開しないよう、index.html だけを配信する
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

// =====================================================
//  ゲーム設定
// =====================================================
const TICK_MS = 33;
const SNAP_EVERY = 2;               // 2tickごとにスナップショット送信 (約15Hz)
const DECK = 2.0;                   // 甲板の高さ（船ローカル）
const MAX_HULL = 100;               // 船体耐久
const SEA_RADIUS = 140;             // 海域の半径
const SHIP_MAX_SPEED = 6.5;
const SHIP_TURN = 0.5;              // rad/s
const BALL_SPEED = 58;
const GRAV = 16;
const CANNON_RELOAD = 3000;         // ms
const CANNON_DMG = 16;              // 船体への基本ダメージ
const BALL_DIRECT_DMG = 55;         // 砲弾の直撃ダメージ（人）
const BALL_SPLASH_DMG = 45;
const BALL_SPLASH_R = 3.4;
const LEAK_PER_SEC = 0.3;           // 穴1つあたりの浸水ダメージ/秒
const REPAIR_MS = 1800;
const REPAIR_HP = 4;
const MAX_HOLES = 8;
const MAX_WOOD = 5;
const RESPAWN_MS = 5000;
const SINK_BLAST_MS = 4400;         // 大破 → 大爆発までの連鎖爆発の時間
const SINK_TOTAL_MS = 9500;         // 大爆発シネマ全体
const RESULT_MS = 6500;             // 結果表示 → 自動再戦
const CREW_PER_SHIP = 4;            // 1隻あたりの乗員（足りない分はCPUが補充）
const MAX_HUMANS_PER_SHIP = 8;
const WIN_CREDITS = 500;
const LOSE_CREDITS = 150;
const CREDIT_CAP = 999999;

// ---- 船の形状 (z, 半幅) 船尾→船首 ----
const HULL = [[12.8, 3.6], [11, 4.2], [6, 4.5], [-3, 4.5], [-8, 3.8], [-11.5, 2.2], [-14.5, 0.2]];
function halfW(z) {
  if (z > HULL[0][0] || z < HULL[HULL.length - 1][0]) return 0;
  for (let i = 0; i < HULL.length - 1; i++) {
    const a = HULL[i], b = HULL[i + 1];
    if (z <= a[0] && z >= b[0]) {
      const t = (a[0] - z) / (a[0] - b[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return 0;
}
const CANNON_Z = [-5, -0.5, 4];
const CANNONS = [];
[-1, 1].forEach((side) => {
  CANNON_Z.forEach((z) => {
    CANNONS.push({ idx: CANNONS.length, side, z, x: side * 3.3, sx: side * 2.1 });
  });
});
const HELM_POS = { x: 0, z: 9.0 };
const HELM_STAND = { x: 0, z: 10.1 };
const CRATES = [{ x: -2.4, z: 10.8 }, { x: 2.4, z: -9 }];
const SPAWNS = [[0, 7], [-1.2, 5.6], [1.2, 5.6], [0, 3.6], [-1, 1.8], [1, 1.8], [0, -6.5], [-1, -8]];

// ---- 武器 ----
const WEAPONS = {
  pistol: { dmg: 30, rate: 450, pellets: 1, spread: 0.006, range: 95, head: 2 },
  blunder: { dmg: 13, rate: 1100, pellets: 7, spread: 0.07, range: 38, head: 1.5 },
  cutlass: { dmg: 34, rate: 600, melee: true, range: 2.9 }
};

// ---- スキン ----
const SKINS = {
  classic: { cost: 0 },
  navy: { cost: 400 },
  forest: { cost: 600 },
  bone: { cost: 900 },
  shadow: { cost: 1200 },
  gold: { cost: 2000 }
};

// =====================================================
//  永続化（アップデートしても消えないセーブデータ）
//   ・データは ./data/players.json に保存（DATA_DIR 環境変数で場所を変更可）
//   ・コード(server.js / index.html)を差し替えても data フォルダを残せば引き継がれます
//   ・書き込みは「一時ファイル→リネーム」＋ .bak バックアップで破損に強い
//   ・項目が増えても migrate() が既定値を補うので、旧セーブがそのまま読めます
// =====================================================
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');
const DB_BAK = path.join(DATA_DIR, 'players.json.bak');
const DB_VERSION = 1;
let db = { version: DB_VERSION, profiles: {} }; // token -> profile
const byCode = {};                               // friendCode -> profile
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let saveTimer = null;

function makeCode() {
  for (let n = 0; n < 200; n++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!byCode[c]) return c;
  }
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}
function cleanName(n, fallback = '海賊') {
  const s = String(n == null ? '' : n).replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 12);
  return s || fallback;
}
function numIn(v, a, b, def = 0) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.max(a, Math.min(b, Math.floor(v)));
}
function migrate(p) {
  const d = {
    id: crypto.randomBytes(6).toString('hex'), code: null, name: '海賊',
    credits: 500, wins: 0, losses: 0, kills: 0, deaths: 0, hits: 0, plays: 0,
    skin: 'classic', skins: ['classic'], friends: [], requests: [],
    createdAt: Date.now(), updatedAt: Date.now()
  };
  Object.keys(d).forEach((k) => { if (p[k] === undefined) p[k] = d[k]; });
  p.name = cleanName(p.name);
  ['credits', 'wins', 'losses', 'kills', 'deaths', 'hits', 'plays'].forEach((k) => { p[k] = numIn(p[k], 0, CREDIT_CAP, 0); });
  p.skins = Array.isArray(p.skins) ? p.skins.filter((s) => SKINS[s]) : ['classic'];
  if (!p.skins.includes('classic')) p.skins.push('classic');
  if (!SKINS[p.skin] || !p.skins.includes(p.skin)) p.skin = 'classic';
  p.friends = Array.isArray(p.friends) ? p.friends.filter((c) => typeof c === 'string').slice(0, 100) : [];
  p.requests = Array.isArray(p.requests)
    ? p.requests.filter((r) => r && typeof r.code === 'string').map((r) => ({ code: r.code, name: cleanName(r.name), at: r.at || Date.now() })).slice(0, 30)
    : [];
  if (!p.code || typeof p.code !== 'string') p.code = makeCode();
  return p;
}
function loadDb() {
  const tryRead = (f) => {
    try {
      if (!fs.existsSync(f)) return null;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      return j && j.profiles ? j : null;
    } catch (e) {
      console.error('セーブデータの読み込みに失敗:', f, e.message);
      return null;
    }
  };
  const loaded = tryRead(DB_FILE) || tryRead(DB_BAK);
  if (loaded) db = loaded;
  db.version = DB_VERSION;
  Object.keys(db.profiles).forEach((t) => {
    const p = db.profiles[t];
    if (p.code && byCode[p.code]) p.code = null; // コード重複の保険
    db.profiles[t] = migrate(p);
    byCode[db.profiles[t].code] = db.profiles[t];
  });
  console.log(`セーブデータ: ${Object.keys(db.profiles).length}人分を読み込みました (${DATA_DIR})`);
}
function saveNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_BAK);
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('セーブに失敗:', e.message);
  }
}
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 2500);
}
function touch(profile) {
  profile.updatedAt = Date.now();
  scheduleSave();
}
function createProfile(token, backup) {
  const p = migrate({ code: null });
  if (backup && typeof backup === 'object') {
    // ブラウザ側のバックアップから復元（サーバーのデータが失われた場合の保険）
    p.name = cleanName(backup.name);
    p.credits = numIn(backup.credits, 0, 200000, p.credits);
    ['wins', 'losses', 'kills', 'deaths', 'hits', 'plays'].forEach((k) => { p[k] = numIn(backup[k], 0, 100000, 0); });
    if (Array.isArray(backup.skins)) p.skins = backup.skins.filter((s) => SKINS[s]);
    if (!p.skins.includes('classic')) p.skins.push('classic');
    p.skin = SKINS[backup.skin] && p.skins.includes(backup.skin) ? backup.skin : 'classic';
    if (Array.isArray(backup.friends)) {
      p.friends = backup.friends.filter((c) => typeof c === 'string' && /^[A-Z0-9]{4,8}$/.test(c)).slice(0, 100);
    }
    if (typeof backup.code === 'string' && /^[A-Z0-9]{6}$/.test(backup.code) && !byCode[backup.code]) p.code = backup.code;
  }
  if (!p.code || byCode[p.code]) p.code = makeCode();
  db.profiles[token] = p;
  byCode[p.code] = p;
  touch(p);
  return p;
}
function publicProfile(p) {
  return {
    id: p.id, code: p.code, name: p.name, credits: p.credits, wins: p.wins, losses: p.losses,
    kills: p.kills, deaths: p.deaths, hits: p.hits, plays: p.plays,
    skin: p.skin, skins: p.skins, friends: p.friends
  };
}
loadDb();
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => { saveNow(); process.exit(0); }));

// =====================================================
//  ユーティリティ
// =====================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, def = 0) => (Number.isFinite(v) ? v : def);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (n) => Math.round(n * 100) / 100;
const other = (t) => (t === 'A' ? 'B' : 'A');
function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// =====================================================
//  状態
// =====================================================
const players = {};     // id -> player（人間とBot）
const onlineByCode = {}; // friendCode -> player
const match = { phase: 'idle', phaseAt: 0, winner: null, loser: null, blasted: false };
let balls = [];
let ballSeq = 1;
let botSeq = 1;

function makeShip(team) {
  return {
    team, x: 0, z: 0, h: 0, speed: 0, throttle: 0, wheel: 0, hp: MAX_HULL,
    holes: [], holeSeq: 1, helm: null, sunk: false, vx: 0, vz: 0,
    cannons: CANNONS.map(() => ({ op: null, resv: null, yaw: 0, pitch: 0.15, cd: 0 }))
  };
}
const ships = { A: makeShip('A'), B: makeShip('B') };
function resetShips() {
  Object.assign(ships.A, makeShip('A'), { x: -42, z: 12, h: -Math.PI / 2 });
  Object.assign(ships.B, makeShip('B'), { x: 42, z: -12, h: Math.PI / 2 });
}
resetShips();

function basePlayer(id) {
  return {
    id, isBot: false, socket: null, profile: null, name: '海賊', team: null,
    ship: null, x: 0, y: DECK, z: 0, yaw: 0, pitch: 0,
    hp: 100, alive: false, wood: 0, weapon: 'pistol', mount: null, repair: null,
    lastShot: 0, lastMelee: 0, respawnAt: 0, inMatch: false, skin: 'classic', mk: 0, md: 0
  };
}
const crew = () => Object.values(players).filter((p) => p.inMatch);
const humans = () => crew().filter((p) => !p.isBot);
const allHumans = () => Object.values(players).filter((p) => !p.isBot && p.profile);

// ---- 座標変換 ----
function l2w(s, lx, lz) {
  const c = Math.cos(s.h), sn = Math.sin(s.h);
  return { x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c };
}
function w2l(s, wx, wz) {
  const c = Math.cos(s.h), sn = Math.sin(s.h);
  const dx = wx - s.x, dz = wz - s.z;
  return { x: dx * c - dz * sn, z: dx * sn + dz * c };
}
function worldPos(p) {
  if (!p.ship) return { x: p.x, y: p.y, z: p.z };
  const w = l2w(ships[p.ship], p.x, p.z);
  return { x: w.x, y: p.y, z: w.z };
}
function cannonDir(c, yaw, pitch) {
  const hx = c.side * Math.cos(yaw), hz = -Math.sin(yaw);
  const cp = Math.cos(pitch);
  return { x: hx * cp, y: Math.sin(pitch), z: hz * cp };
}
function muzzleWorld(s, c) {
  const w = l2w(s, c.side * 3.9, c.z);
  return { x: w.x, y: DECK + 0.85, z: w.z };
}
function insideHull(lx, lz, y) {
  if (lz > HULL[0][0] || lz < HULL[HULL.length - 1][0]) return false;
  return Math.abs(lx) <= halfW(lz) + 0.1 && y >= -1.3 && y <= 3.6;
}

// ---- 送信ヘルパー ----
function emitFx(o) { io.to('match').emit('fx', o); }
function notice(p, text) { if (p && !p.isBot && p.socket) p.socket.emit('notice', text); }
function stateOf(p) {
  return {
    hp: Math.round(p.hp), wood: p.wood, alive: p.alive, team: p.team,
    credits: p.profile ? p.profile.credits : 0,
    mount: p.mount ? { type: p.mount.type, idx: p.mount.idx } : null,
    respawn: p.alive ? 0 : Math.max(0, p.respawnAt - Date.now()),
    kills: p.mk, deaths: p.md
  };
}
function sendState(p) {
  if (p && !p.isBot && p.socket) p.socket.emit('st', stateOf(p));
}
function addCredits(p, n) {
  if (!p || p.isBot || !p.profile) return;
  p.profile.credits = clamp(p.profile.credits + n, 0, CREDIT_CAP);
  touch(p.profile);
}

// =====================================================
//  配置・Bot管理
// =====================================================
function placeOnDeck(p) {
  const sp = pick(SPAWNS);
  p.ship = p.team;
  p.x = sp[0] + rand(-0.3, 0.3);
  p.z = sp[1] + rand(-0.3, 0.3);
  p.y = DECK;
  p.yaw = ships[p.team].h;
  p.pitch = 0;
}
const BOT_NAMES = ['赤髭', '黒ひげ', '砲手ジャック', 'ビリー', 'メアリー', 'ケイト', '隻眼トム', 'ドレイク', 'アン', 'サルバ', 'ロビン', '鉄腕マルコ'];
function spawnBot(team) {
  const b = basePlayer('bot' + (botSeq++));
  b.isBot = true;
  b.name = pick(BOT_NAMES) + '(CPU)';
  b.team = team;
  b.inMatch = true;
  b.skin = pick(Object.keys(SKINS));
  b.duty = 'gun';
  b.aiT = rand(0.5, 2);
  b.noAimT = 0;
  b.repT = 0;
  b.hp = 100;
  b.alive = true;
  placeOnDeck(b);
  players[b.id] = b;
  return b;
}
function removePlayerFromPosts(p) {
  releaseMount(p);
  p.repair = null;
}
function fillBots() {
  ['A', 'B'].forEach((team) => {
    const hs = humans().filter((p) => p.team === team).length;
    const target = Math.max(CREW_PER_SHIP, hs);
    const bots = crew().filter((p) => p.isBot && p.team === team);
    let need = target - hs - bots.length;
    while (need > 0) { spawnBot(team); need--; }
    while (need < 0 && bots.length) {
      const b = bots.pop();
      removePlayerFromPosts(b);
      delete players[b.id];
      need++;
    }
  });
}
function clearBots() {
  Object.values(players).forEach((p) => {
    if (p.isBot) { removePlayerFromPosts(p); delete players[p.id]; }
  });
}

// =====================================================
//  試合の進行（ラウンド制なし・船が大破した方の負け）
// =====================================================
function setPhase(ph) {
  match.phase = ph;
  match.phaseAt = Date.now();
  io.to('match').emit('phase', { phase: ph });
}
function startBattle() {
  resetShips();
  balls = [];
  clearBots();
  match.winner = null; match.loser = null; match.blasted = false;
  crew().forEach((p) => {
    p.alive = true; p.hp = 100; p.wood = 0; p.mount = null; p.repair = null; p.mk = 0; p.md = 0;
    placeOnDeck(p);
  });
  fillBots();
  setPhase('live');
  io.to('match').emit('battleStart', {});
  humans().forEach((p) => {
    p.socket.emit('respawn', { ship: p.ship, x: p.x, y: p.y, z: p.z, h: ships[p.ship].h });
    sendState(p);
  });
}
function goIdle() {
  clearBots();
  balls = [];
  match.phase = 'idle';
  match.phaseAt = Date.now();
}
function startSink(loser) {
  match.loser = loser;
  match.winner = other(loser);
  match.blasted = false;
  balls = [];
  setPhase('sinking');
  ['A', 'B'].forEach((k) => { ships[k].throttle = 0; });
  crew().forEach((p) => { if (p.mount && p.mount.type === 'helm') releaseMount(p); p.repair = null; });
  io.to('match').emit('sinkStart', { team: loser });
}
function blast() {
  const s = ships[match.loser];
  s.sunk = true;
  crew().forEach((p) => {
    if (p.ship !== match.loser) return;
    releaseMount(p);
    if (p.isBot) { p.alive = false; p.ship = null; return; }
    const w = worldPos(p);
    p.ship = null; p.x = w.x; p.z = w.z; p.y = 0.4;
    p.socket.emit('eject', { x: p.x, y: p.y, z: p.z });
  });
  emitFx({ t: 'blast', s: match.loser, x: r2(s.x), z: r2(s.z) });
}
function awardResult() {
  humans().forEach((p) => {
    const win = p.team === match.winner;
    const pr = p.profile;
    if (!pr) return;
    pr.plays++;
    if (win) pr.wins++; else pr.losses++;
    const reward = win ? WIN_CREDITS : LOSE_CREDITS;
    addCredits(p, reward);
    p.socket.emit('result', { winner: match.winner, win, reward });
    p.socket.emit('profile', { profile: publicProfile(pr) });
    sendState(p);
  });
  scheduleSave();
}

// =====================================================
//  ダメージ・死亡・マウント
// =====================================================
function releaseMount(p) {
  const m = p.mount;
  if (!m) return;
  const sh = ships[m.ship];
  if (sh) {
    if (m.type === 'helm' && sh.helm === p.id) sh.helm = null;
    if (m.type === 'cannon' && sh.cannons[m.idx].op === p.id) sh.cannons[m.idx].op = null;
  }
  p.mount = null;
}
function applyDamage(victim, dmg, attacker, weapon, head) {
  if (!victim || !victim.alive || dmg <= 0) return;
  victim.hp -= dmg;
  victim.repair = null;
  if (!victim.isBot && victim.socket) {
    const aw = attacker ? worldPos(attacker) : null;
    victim.socket.emit('dmg', { x: aw ? r2(aw.x) : null, z: aw ? r2(aw.z) : null, dmg: Math.round(dmg) });
  }
  if (attacker && !attacker.isBot && attacker.socket && attacker.id !== victim.id) {
    attacker.socket.emit('hitm', { head: !!head, kill: victim.hp <= 0 });
  }
  if (victim.hp > 0) { sendState(victim); return; }
  victim.hp = 0;
  victim.alive = false;
  victim.md++;
  victim.respawnAt = Date.now() + RESPAWN_MS;
  releaseMount(victim);
  victim.repair = null;
  if (victim.profile) { victim.profile.deaths++; touch(victim.profile); }
  if (attacker && attacker.id !== victim.id) {
    attacker.mk++;
    if (attacker.profile) { attacker.profile.kills++; addCredits(attacker, 60); }
    sendState(attacker);
  }
  io.to('match').emit('feed', {
    k: attacker ? attacker.name : '', kt: attacker ? attacker.team : null,
    v: victim.name, vt: victim.team, w: weapon
  });
  sendState(victim);
}
function respawn(p) {
  const sh = ships[p.team];
  if (!sh || sh.sunk) return;
  p.alive = true; p.hp = 100; p.wood = 0; p.mount = null; p.repair = null;
  placeOnDeck(p);
  if (!p.isBot && p.socket) {
    p.socket.emit('respawn', { ship: p.ship, x: p.x, y: p.y, z: p.z, h: sh.h });
    sendState(p);
  }
}

// =====================================================
//  大砲
// =====================================================
function fireCannon(sh, idx, owner) {
  const st = sh.cannons[idx];
  if (match.phase !== 'live' || st.cd > 0 || sh.sunk) return false;
  st.cd = CANNON_RELOAD;
  const c = CANNONS[idx];
  const dl = cannonDir(c, st.yaw, st.pitch);
  const cs = Math.cos(sh.h), sn = Math.sin(sh.h);
  const dw = { x: dl.x * cs + dl.z * sn, y: dl.y, z: -dl.x * sn + dl.z * cs };
  const m = muzzleWorld(sh, c);
  balls.push({
    id: ballSeq++, team: owner.team, ship: sh.team, owner: owner.id,
    x: m.x, y: m.y, z: m.z,
    vx: dw.x * BALL_SPEED + sh.vx, vy: dw.y * BALL_SPEED, vz: dw.z * BALL_SPEED + sh.vz, life: 9
  });
  emitFx({ t: 'fire', s: sh.team, i: idx, x: r2(m.x), y: r2(m.y), z: r2(m.z), dx: r2(dw.x), dy: r2(dw.y), dz: r2(dw.z) });
  return true;
}
function addHole(sh, lx, lz) {
  const hz = clamp(lz, -11.5, 11.8);
  const hw = Math.max(1, halfW(hz) - 0.8);
  const hx = clamp(lx, -hw, hw);
  if (sh.holes.length >= MAX_HOLES) return null;
  if (sh.holes.some((h) => Math.hypot(h.x - hx, h.z - hz) < 1.6)) return null;
  const h = { id: sh.holeSeq++, x: hx, z: hz };
  sh.holes.push(h);
  return h;
}
function hitShip(sh, ball, lx, ly, lz) {
  sh.hp -= CANNON_DMG;
  const hole = addHole(sh, lx, lz);
  const w = { x: ball.x, y: ball.y, z: ball.z };
  emitFx({ t: 'shipHit', s: sh.team, x: r2(w.x), y: r2(w.y), z: r2(w.z), hole: hole ? hole.id : 0 });
  const owner = players[ball.owner];
  if (owner && !owner.isBot && owner.profile) { owner.profile.hits++; addCredits(owner, 25); }
  // 爆風ダメージ
  crew().forEach((q) => {
    if (!q.alive || q.team === ball.team) return;
    const qw = worldPos(q);
    const d = Math.hypot(qw.x - w.x, (qw.y + 1) - w.y, qw.z - w.z);
    if (d < BALL_SPLASH_R) applyDamage(q, BALL_SPLASH_DMG * (1 - d / BALL_SPLASH_R), owner || null, 'cannon', false);
  });
}
function updateBalls(dt) {
  const keep = [];
  for (const b of balls) {
    let dead = false;
    const sub = 2;
    for (let n = 0; n < sub && !dead; n++) {
      const h = dt / sub;
      b.vy -= GRAV * h;
      b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      // プレイヤー直撃
      for (const q of crew()) {
        if (!q.alive || q.team === b.team) continue;
        const qw = worldPos(q);
        if (Math.hypot(qw.x - b.x, qw.y + 1 - b.y, qw.z - b.z) < 1.15) {
          emitFx({ t: 'boom', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
          applyDamage(q, BALL_DIRECT_DMG, players[b.owner] || null, 'cannon', false);
          dead = true;
          break;
        }
      }
      if (dead) break;
      // 船体
      for (const k of ['A', 'B']) {
        const sh = ships[k];
        if (k === b.ship || sh.sunk) continue;
        const l = w2l(sh, b.x, b.z);
        if (insideHull(l.x, l.z, b.y)) { hitShip(sh, b, l.x, b.y, l.z); dead = true; break; }
      }
      if (dead) break;
      if (b.y < 0) {
        emitFx({ t: 'splash', x: r2(b.x), z: r2(b.z) });
        dead = true;
      }
    }
    b.life -= dt;
    if (!dead && b.life > 0) keep.push(b);
  }
  balls = keep;
}

// =====================================================
//  船の物理
// =====================================================
function updateShip(s, dt) {
  if (s.sunk) { s.speed = 0; s.vx = 0; s.vz = 0; return; }
  if (!s.helm) s.wheel += clamp(-s.wheel, -0.6 * dt, 0.6 * dt);
  const target = s.throttle * SHIP_MAX_SPEED;
  const acc = target > s.speed ? 1.1 : 1.8;
  s.speed += clamp(target - s.speed, -acc * dt, acc * dt);
  const steer = 0.3 + 0.7 * Math.min(1, s.speed / 3);
  s.h = wrap(s.h - s.wheel * SHIP_TURN * steer * dt);
  s.vx = -Math.sin(s.h) * s.speed;
  s.vz = -Math.cos(s.h) * s.speed;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const r = Math.hypot(s.x, s.z);
  if (r > SEA_RADIUS) {
    const k = SEA_RADIUS / r;
    s.x *= k; s.z *= k;
    s.speed *= 0.985;
  }
}
function shipCollide() {
  const a = ships.A, b = ships.B;
  if (a.sunk || b.sunk) return;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 0.01;
  const min = 13;
  if (d < min) {
    const push = (min - d) / 2, nx = dx / d, nz = dz / d;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
    a.speed *= 0.97; b.speed *= 0.97;
  }
}
function fixHole(sh, hole, p) {
  const i = sh.holes.findIndex((h) => h.id === hole.id);
  if (i < 0) return;
  sh.holes.splice(i, 1);
  sh.hp = Math.min(MAX_HULL, sh.hp + REPAIR_HP);
  p.wood = Math.max(0, p.wood - 1);
  p.repair = null;
  if (!p.isBot) { addCredits(p, 15); sendState(p); }
  emitFx({ t: 'fixed', s: sh.team, id: hole.id });
}

// =====================================================
//  CPU（Bot）AI  -- 舵取り・大砲・修理・白兵戦
// =====================================================
function faceLocal(b, dx, dz) {
  if (!b.ship) return;
  const s = ships[b.ship];
  const c = Math.cos(s.h), sn = Math.sin(s.h);
  const wx = dx * c + dz * sn, wz = -dx * sn + dz * c;
  b.yaw = Math.atan2(-wx, -wz);
}
function walkTo(b, tx, tz, dt, spd) {
  spd = spd || 3.2;
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d < 0.12) return true;
  const st = Math.min(d, spd * dt);
  b.x += (dx / d) * st;
  b.z += (dz / d) * st;
  const hw = Math.max(0.5, halfW(b.z) - 0.45);
  b.x = clamp(b.x, -hw, hw);
  b.z = clamp(b.z, -12.5, 12.2);
  faceLocal(b, dx / d, dz / d);
  return d - st < 0.12;
}
function solveAim(sh, en, c) {
  const m = muzzleWorld(sh, c);
  let tx = en.x, tz = en.z;
  const ty = 1.0;
  let t = 0;
  let pitch = 0, d = 0, dx = 0, dz = 0;
  for (let i = 0; i < 3; i++) {
    dx = tx - m.x; dz = tz - m.z; d = Math.hypot(dx, dz) || 0.01;
    const dy = ty - m.y;
    const V = BALL_SPEED;
    const disc = V * V * V * V - GRAV * (GRAV * d * d + 2 * dy * V * V);
    if (disc < 0) return null;
    const tan = (V * V - Math.sqrt(disc)) / (GRAV * d);
    pitch = Math.atan(tan);
    t = d / (V * Math.cos(pitch));
    tx = en.x + (en.vx - sh.vx) * t;
    tz = en.z + (en.vz - sh.vz) * t;
  }
  dx = tx - m.x; dz = tz - m.z;
  const cs = Math.cos(sh.h), sn = Math.sin(sh.h);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  const yaw = Math.atan2(-lz, c.side * lx);
  if (Math.abs(yaw) > 0.55 || pitch < -0.08 || pitch > 0.56 || d > 170) return null;
  return { yaw, pitch, d };
}
function claimCannon(b, sh, en) {
  const loc = w2l(sh, en.x, en.z);
  const side = loc.x >= 0 ? 1 : -1;
  let best = -1, bs = 1e9;
  CANNONS.forEach((c) => {
    const st = sh.cannons[c.idx];
    if (st.op) return;
    if (st.resv && st.resv !== b.id && players[st.resv] && players[st.resv].alive) return;
    const score = (c.side === side ? 0 : 100) + Math.hypot(c.sx - b.x, c.z - b.z);
    if (score < bs) { bs = score; best = c.idx; }
  });
  sh.cannons.forEach((st, i) => { if (st.resv === b.id && i !== best) st.resv = null; });
  if (best >= 0) sh.cannons[best].resv = b.id;
  return best;
}
function botGun(b, sh, en, dt) {
  if (b.mount && b.mount.type === 'cannon') {
    const c = CANNONS[b.mount.idx], st = sh.cannons[b.mount.idx];
    if (st.op !== b.id) { b.mount = null; return; }
    const aim = solveAim(sh, en, c);
    if (aim) {
      b.noAimT = 0;
      st.yaw += clamp(aim.yaw - st.yaw, -1.3 * dt, 1.3 * dt);
      st.pitch += clamp(aim.pitch - st.pitch, -0.8 * dt, 0.8 * dt);
      b.aiT -= dt;
      if (st.cd <= 0 && b.aiT <= 0 && Math.abs(aim.yaw - st.yaw) < 0.05 && Math.abs(aim.pitch - st.pitch) < 0.03) {
        const sy = st.yaw, sp = st.pitch;
        st.yaw += rand(-0.035, 0.035);   // 命中のばらつき
        st.pitch += rand(-0.02, 0.02);
        fireCannon(sh, b.mount.idx, b);
        st.yaw = sy; st.pitch = sp;
        b.aiT = rand(0.4, 1.6);
      }
      const dl = cannonDir(c, st.yaw, st.pitch);
      faceLocal(b, dl.x, dl.z);
    } else {
      b.noAimT += dt;
      if (b.noAimT > 2.5) { releaseMount(b); b.noAimT = 0; }
    }
    return;
  }
  const idx = claimCannon(b, sh, en);
  if (idx < 0) { walkTo(b, 0, 4, dt); return; }
  const c = CANNONS[idx];
  if (walkTo(b, c.sx, c.z, dt)) {
    const st = sh.cannons[idx];
    st.op = b.id; st.resv = null;
    b.mount = { type: 'cannon', idx, ship: b.team };
    b.x = c.sx; b.z = c.z;
  }
}
function botHelm(b, sh, en, dt) {
  if (!(b.mount && b.mount.type === 'helm')) {
    if (sh.helm && sh.helm !== b.id) { b.duty = 'gun'; return; }
    if (walkTo(b, HELM_STAND.x, HELM_STAND.z, dt)) {
      sh.helm = b.id;
      b.mount = { type: 'helm', idx: 0, ship: b.team };
      b.x = HELM_STAND.x; b.z = HELM_STAND.z;
      faceLocal(b, 0, -1);
    }
    return;
  }
  if (sh.helm !== b.id) { b.mount = null; return; }
  const dx = en.x - sh.x, dz = en.z - sh.z, dist = Math.hypot(dx, dz);
  const by = Math.atan2(-dx, -dz);
  const off = Math.PI / 2 + 0.5 * clamp((30 - dist) / 20, 0, 1) - 0.7 * clamp((dist - 50) / 50, 0, 1);
  const c1 = by + off, c2 = by - off;
  let tgt = Math.abs(wrap(c1 - sh.h)) < Math.abs(wrap(c2 - sh.h)) ? c1 : c2;
  const r = Math.hypot(sh.x, sh.z);
  if (r > 100) tgt = Math.atan2(sh.x, sh.z);
  const diff = wrap(tgt - sh.h);
  const want = clamp(-diff * 2.2, -1, 1);
  sh.wheel += clamp(want - sh.wheel, -1.5 * dt, 1.5 * dt);
  sh.throttle = r > 100 ? 0.6 : dist > 75 ? 0.85 : dist < 28 ? 0.5 : 0.6;
}
function botRepair(b, sh, en, dt) {
  if (!sh.holes.length) { botGun(b, sh, en, dt); return; }
  if (b.mount) releaseMount(b);
  if (b.wood < 1) {
    let cr = CRATES[0], bd = 1e9;
    CRATES.forEach((c) => { const d = Math.hypot(c.x - b.x, c.z - b.z); if (d < bd) { bd = d; cr = c; } });
    if (walkTo(b, cr.x, cr.z, dt) || bd < 1.2) b.wood = MAX_WOOD;
    return;
  }
  let hole = sh.holes[0], hd = 1e9;
  sh.holes.forEach((h) => { const d = Math.hypot(h.x - b.x, h.z - b.z); if (d < hd) { hd = d; hole = h; } });
  if (hd > 1.1) { walkTo(b, hole.x, hole.z, dt); b.repT = 0; return; }
  b.repT += dt;
  if (b.repT >= REPAIR_MS / 1000) { b.repT = 0; fixHole(sh, hole, b); }
}
function assignDuties(team) {
  const sh = ships[team];
  const bots = crew().filter((p) => p.isBot && p.team === team && p.alive);
  const humanHelm = sh.helm && players[sh.helm] && !players[sh.helm].isBot;
  let i = 0;
  bots.forEach((b) => { if (b.duty === 'helm' && (humanHelm || i > 0)) b.duty = 'gun'; });
  const hasHelmBot = bots.some((b) => b.duty === 'helm');
  const hasRepairBot = bots.some((b) => b.duty === 'repair');
  if (!humanHelm && !hasHelmBot && bots.length) { bots[0].duty = 'helm'; }
  if (!hasRepairBot) {
    const cand = bots.find((b) => b.duty !== 'helm');
    if (cand && bots.length >= 2) cand.duty = 'repair';
  }
}
function botThink(b, dt) {
  if (!b.alive) return;
  const sh = ships[b.team], en = ships[other(b.team)];
  if (!b.ship || !sh || sh.sunk) return;
  // 乗り込んできた敵を迎撃
  let threat = null, td = 99;
  crew().forEach((q) => {
    if (q.team === b.team || !q.alive || q.ship !== b.ship) return;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d < td) { td = d; threat = q; }
  });
  if (threat && td < 16 && b.duty !== 'helm') {
    if (b.mount) releaseMount(b);
    if (td > 1.9) {
      walkTo(b, threat.x, threat.z, dt, 3.7);
    } else if (Date.now() - b.lastMelee > 900) {
      b.lastMelee = Date.now();
      applyDamage(threat, 17, b, 'cutlass', false);
      emitFx({ t: 'swing', id: b.id });
    }
    return;
  }
  if (b.duty === 'helm') botHelm(b, sh, en, dt);
  else if (b.duty === 'repair') botRepair(b, sh, en, dt);
  else botGun(b, sh, en, dt);
}

// =====================================================
//  シミュレーション
// =====================================================
let dutyTimer = 0;
function simulate(dt, now) {
  const A = ships.A, B = ships.B;
  const live = match.phase === 'live';
  updateShip(A, dt);
  updateShip(B, dt);
  shipCollide();
  [A, B].forEach((s) => s.cannons.forEach((c) => { if (c.cd > 0) c.cd = Math.max(0, c.cd - dt * 1000); }));

  if (live) {
    // 浸水
    [A, B].forEach((s) => { if (s.holes.length) s.hp -= s.holes.length * LEAK_PER_SEC * dt; });
    // Bot
    dutyTimer -= dt;
    if (dutyTimer <= 0) { dutyTimer = 1; assignDuties('A'); assignDuties('B'); }
    crew().forEach((p) => { if (p.isBot) botThink(p, dt); });
    // 人間の修理
    humans().forEach((p) => {
      if (!p.repair) return;
      const sh = p.ship ? ships[p.ship] : null;
      const hole = sh ? sh.holes.find((h) => h.id === p.repair.id) : null;
      if (!p.alive || !hole || p.mount || p.wood < 1 || Math.hypot(p.x - hole.x, p.z - hole.z) > 2.7) { p.repair = null; return; }
      if (now - p.repair.start >= REPAIR_MS) fixHole(sh, hole, p);
    });
    updateBalls(dt);
  } else {
    balls = [];
  }

  // リスポーン
  crew().forEach((p) => {
    if (!p.alive && now >= p.respawnAt && live) respawn(p);
  });

  // 敗北判定
  if (live && (A.hp <= 0 || B.hp <= 0)) {
    A.hp = Math.max(0, A.hp); B.hp = Math.max(0, B.hp);
    startSink(A.hp <= B.hp ? 'A' : 'B');
  }

  if (match.phase === 'sinking') {
    const t = now - match.phaseAt;
    if (!match.blasted && t >= SINK_BLAST_MS) { match.blasted = true; blast(); }
    if (t >= SINK_TOTAL_MS) { setPhase('result'); awardResult(); }
  } else if (match.phase === 'result') {
    if (now - match.phaseAt >= RESULT_MS) {
      if (humans().length > 0) startBattle(); else goIdle();
    }
  }
}

function broadcastSnap(now) {
  const sh = {};
  ['A', 'B'].forEach((k) => {
    const s = ships[k];
    sh[k] = {
      x: r2(s.x), z: r2(s.z), h: r2(s.h), sp: r2(s.speed), th: r2(s.throttle), wh: r2(s.wheel),
      hp: Math.max(0, Math.round(s.hp * 10) / 10), sk: s.sunk ? 1 : 0,
      hl: s.holes.map((h) => [h.id, r2(h.x), r2(h.z)]),
      hm: s.helm || 0,
      cn: s.cannons.map((c) => [r2(c.yaw), r2(c.pitch), Math.round(c.cd), c.op || 0])
    };
  });
  const pl = crew().map((p) => ({
    id: p.id, n: p.name, t: p.team, s: p.ship || 0,
    x: r2(p.x), y: r2(p.y), z: r2(p.z), yw: r2(p.yaw), pt: r2(p.pitch),
    a: p.alive ? 1 : 0, hp: Math.round(p.hp), w: p.weapon, sk: p.skin, b: p.isBot ? 1 : 0,
    m: p.mount ? p.mount.type[0] : 0
  }));
  io.to('match').emit('snap', {
    ph: match.phase, pt: now - match.phaseAt, sh, pl,
    bl: balls.map((b) => [b.id, r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz)])
  });
}
function broadcastOnline() {
  const hs = allHumans();
  io.emit('online', {
    total: hs.length, inMatch: humans().length, phase: match.phase,
    hpA: Math.round(ships.A.hp), hpB: Math.round(ships.B.hp)
  });
}

let lastTick = Date.now();
let tickN = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  tickN++;
  try {
    if (match.phase !== 'idle') simulate(dt, now);
    if (match.phase !== 'idle' && tickN % SNAP_EVERY === 0) broadcastSnap(now);
    if (tickN % 60 === 0) broadcastOnline();
    if (tickN % 30 === 0) humans().forEach(sendState);
  } catch (e) {
    console.error('tick error', e);
  }
}, TICK_MS);

// =====================================================
//  フレンド
// =====================================================
function friendsPayload(profile) {
  const friends = profile.friends.map((code) => {
    const q = byCode[code];
    if (!q) return null;
    const op = onlineByCode[code];
    return { code, name: q.name, online: !!op, inMatch: !!(op && op.inMatch), skin: q.skin, wins: q.wins };
  }).filter(Boolean);
  const requests = profile.requests.map((r) => ({ code: r.code, name: (byCode[r.code] || {}).name || r.name }));
  return { friends, requests };
}
function pushFriends(profile) {
  const op = profile && onlineByCode[profile.code];
  if (op && op.socket) op.socket.emit('friends', friendsPayload(profile));
}
function notifyFriendsOf(profile) {
  profile.friends.forEach((code) => { const q = byCode[code]; if (q) pushFriends(q); });
}
function makeFriends(a, b) {
  if (!a.friends.includes(b.code)) a.friends.push(b.code);
  if (!b.friends.includes(a.code)) b.friends.push(a.code);
  a.requests = a.requests.filter((r) => r.code !== b.code);
  b.requests = b.requests.filter((r) => r.code !== a.code);
  touch(a); touch(b);
  pushFriends(a); pushFriends(b);
}

// =====================================================
//  射撃（ヒットスキャン）
// =====================================================
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t;
}
function rayPlayers(p, o, d, range) {
  let best = null, bt = range;
  crew().forEach((q) => {
    if (q.team === p.team || !q.alive) return;
    const w = worldPos(q);
    const parts = [
      { y: 1.68, r: 0.3, head: true }, { y: 1.15, r: 0.5, head: false }, { y: 0.55, r: 0.45, head: false }
    ];
    parts.forEach((pt) => {
      const t = raySphere(o, d, { x: w.x, y: w.y + pt.y, z: w.z }, pt.r);
      if (t >= 0 && t < bt) { bt = t; best = { q, t, head: pt.head }; }
    });
  });
  return best;
}
function normV(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function vecIn(v) {
  return { x: num(v && v.x), y: num(v && v.y), z: num(v && v.z) };
}

// =====================================================
//  Socket.io
// =====================================================
function leaveMatch(p) {
  if (!p.inMatch) return;
  removePlayerFromPosts(p);
  p.inMatch = false;
  p.alive = false;
  p.ship = null;
  if (p.socket) p.socket.leave('match');
  io.to('match').emit('gone', { id: p.id });
  if (match.phase !== 'idle') {
    if (humans().length === 0) goIdle();
    else fillBots();
  }
  if (p.profile) notifyFriendsOf(p.profile);
  broadcastOnline();
}

io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);
  const p = basePlayer(socket.id);
  p.socket = socket;
  players[socket.id] = p;
  let lastFriendReq = 0;

  const ready = () => p.profile && p.inMatch;
  const playing = () => p.profile && p.inMatch && p.alive && match.phase === 'live';

  // ---- 認証（セーブデータの読み込み / 新規作成）----
  socket.on('auth', (d) => {
    if (p.profile) return;
    d = d || {};
    let token = typeof d.token === 'string' && /^[a-f0-9]{32}$/.test(d.token) ? d.token : null;
    let profile = token ? db.profiles[token] : null;
    if (!profile) {
      if (!token) token = crypto.randomBytes(16).toString('hex');
      profile = createProfile(token, d.backup);
    }
    if (d.name && !profile.plays && profile.name === '海賊') profile.name = cleanName(d.name);
    // 同じアカウントの別接続は切り替える
    const old = onlineByCode[profile.code];
    if (old && old !== p && old.socket) {
      old.socket.emit('notice', '別の画面でログインされました');
      old.socket.disconnect(true);
    }
    p.profile = profile;
    p.name = profile.name;
    p.skin = profile.skin;
    onlineByCode[profile.code] = p;
    socket.emit('profile', { token, profile: publicProfile(profile) });
    socket.emit('friends', friendsPayload(profile));
    notifyFriendsOf(profile);
    broadcastOnline();
    touch(profile);
  });

  socket.on('setName', (n) => {
    if (!p.profile) return;
    p.profile.name = cleanName(n, p.profile.name);
    p.name = p.profile.name;
    touch(p.profile);
    socket.emit('profile', { profile: publicProfile(p.profile) });
    notifyFriendsOf(p.profile);
  });

  // ---- スキン ----
  socket.on('buySkin', (id) => {
    const pr = p.profile;
    if (!pr || !SKINS[id] || pr.skins.includes(id)) return;
    if (pr.credits < SKINS[id].cost) { socket.emit('notice', 'クレジットが足りません'); return; }
    pr.credits -= SKINS[id].cost;
    pr.skins.push(id);
    pr.skin = id;
    p.skin = id;
    touch(pr);
    socket.emit('profile', { profile: publicProfile(pr) });
    socket.emit('notice', 'スキンを購入しました！');
  });
  socket.on('equipSkin', (id) => {
    const pr = p.profile;
    if (!pr || !SKINS[id] || !pr.skins.includes(id)) return;
    pr.skin = id;
    p.skin = id;
    touch(pr);
    socket.emit('profile', { profile: publicProfile(pr) });
  });

  // ---- フレンド ----
  socket.on('friendAdd', (code) => {
    const pr = p.profile;
    if (!pr) return;
    if (Date.now() - lastFriendReq < 800) return;
    lastFriendReq = Date.now();
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const target = byCode[code];
    if (!target) { socket.emit('notice', 'そのフレンドコードは見つかりません'); return; }
    if (target === pr) { socket.emit('notice', '自分自身は追加できません'); return; }
    if (pr.friends.includes(code)) { socket.emit('notice', 'すでにフレンドです'); return; }
    if (pr.requests.some((r) => r.code === code)) { makeFriends(pr, target); socket.emit('notice', `${target.name} とフレンドになりました！`); return; }
    if (target.requests.some((r) => r.code === pr.code)) { socket.emit('notice', 'すでに申請済みです'); return; }
    if (target.requests.length >= 30) { socket.emit('notice', '相手の申請が埋まっています'); return; }
    target.requests.push({ code: pr.code, name: pr.name, at: Date.now() });
    touch(target);
    socket.emit('notice', `${target.name} にフレンド申請を送りました`);
    const op = onlineByCode[target.code];
    if (op && op.socket) {
      op.socket.emit('notice', `${pr.name} からフレンド申請が届きました`);
      pushFriends(target);
    }
  });
  socket.on('friendRespond', (d) => {
    const pr = p.profile;
    if (!pr || !d) return;
    const code = String(d.code || '');
    const idx = pr.requests.findIndex((r) => r.code === code);
    if (idx < 0) return;
    const other_ = byCode[code];
    if (d.accept && other_) {
      makeFriends(pr, other_);
      socket.emit('notice', `${other_.name} とフレンドになりました！`);
    } else {
      pr.requests.splice(idx, 1);
      touch(pr);
      pushFriends(pr);
    }
  });
  socket.on('friendRemove', (code) => {
    const pr = p.profile;
    if (!pr) return;
    code = String(code || '');
    pr.friends = pr.friends.filter((c) => c !== code);
    const q = byCode[code];
    if (q) { q.friends = q.friends.filter((c) => c !== pr.code); touch(q); pushFriends(q); }
    touch(pr);
    pushFriends(pr);
  });

  // ---- 出航（ロビー→戦場）----
  socket.on('join', (d) => {
    if (!p.profile || p.inMatch) return;
    d = d || {};
    p.name = p.profile.name;
    p.skin = p.profile.skin;
    // チーム決定：フレンドの船に合流 / 人数の少ない船
    let team = null;
    if (d.friendCode) {
      const f = onlineByCode[String(d.friendCode)];
      if (f && f.inMatch && p.profile.friends.includes(f.profile.code)) team = f.team;
    }
    const cnt = { A: 0, B: 0 };
    humans().forEach((q) => { cnt[q.team]++; });
    if (!team) team = cnt.A === cnt.B ? (Math.random() < 0.5 ? 'A' : 'B') : (cnt.A < cnt.B ? 'A' : 'B');
    if (cnt[team] >= MAX_HUMANS_PER_SHIP) team = other(team);
    p.team = team;
    p.inMatch = true;
    p.hp = 100; p.alive = true; p.wood = 0; p.mount = null; p.repair = null; p.mk = 0; p.md = 0;
    p.weapon = 'pistol';
    socket.join('match');
    if (match.phase === 'idle') {
      p.team = team;
      startBattle();
    } else {
      if (ships[team].sunk) { p.alive = false; p.respawnAt = Date.now() + 2000; }
      else placeOnDeck(p);
      fillBots();
    }
    socket.emit('joined', { team: p.team, ship: p.ship, x: p.x, y: p.y, z: p.z, h: ships[p.team].h, st: stateOf(p), phase: match.phase });
    if (match.phase !== 'idle') broadcastSnap(Date.now());
    notifyFriendsOf(p.profile);
    broadcastOnline();
  });
  socket.on('leave', () => leaveMatch(p));

  // ---- 位置同期 ----
  socket.on('move', (d) => {
    if (!ready() || !p.alive || !d) return;
    p.yaw = num(d.yaw, p.yaw);
    p.pitch = clamp(num(d.pitch, p.pitch), -1.5, 1.5);
    if (d.w && WEAPONS[d.w]) p.weapon = d.w;
    if (p.mount) {
      if (p.mount.type === 'cannon') {
        const st = ships[p.mount.ship].cannons[p.mount.idx];
        if (st.op === p.id) {
          st.yaw = clamp(num(d.cy, st.yaw), -0.6, 0.6);
          st.pitch = clamp(num(d.cp, st.pitch), -0.1, 0.6);
        }
      }
      return;
    }
    const ship = d.ship === 'A' || d.ship === 'B' ? d.ship : null;
    if (ship) {
      if (ships[ship].sunk) return;
      p.ship = ship;
      p.x = clamp(num(d.x, p.x), -6, 6);
      p.y = clamp(num(d.y, p.y), -2, 6);
      p.z = clamp(num(d.z, p.z), -15, 14);
    } else {
      p.ship = null;
      p.x = clamp(num(d.x, p.x), -SEA_RADIUS - 20, SEA_RADIUS + 20);
      p.y = clamp(num(d.y, p.y), -3, 14);
      p.z = clamp(num(d.z, p.z), -SEA_RADIUS - 20, SEA_RADIUS + 20);
    }
  });

  // ---- 舵 ----
  socket.on('helm', (d) => {
    if (!playing() || !d || !p.mount || p.mount.type !== 'helm') return;
    const sh = ships[p.mount.ship];
    if (sh.helm !== p.id) return;
    sh.wheel = clamp(num(d.wheel, sh.wheel), -1, 1);
    sh.throttle = clamp(num(d.throttle, sh.throttle), 0, 1);
  });

  // ---- インタラクト ----
  socket.on('use', (d) => {
    if (!playing() || !d) return;
    const kind = d.kind;
    if (kind === 'dismount') { releaseMount(p); sendState(p); return; }
    const sh = p.ship ? ships[p.ship] : null;
    if (!sh || sh.sunk || p.mount) return;
    if (kind === 'helm') {
      if (sh.helm && players[sh.helm] && !players[sh.helm].isBot) { notice(p, '舵は使用中です'); return; }
      if (Math.hypot(p.x - HELM_POS.x, p.z - HELM_POS.z) > 3) return;
      if (sh.helm && players[sh.helm]) releaseMount(players[sh.helm]); // CPUの舵取りを交代
      sh.helm = p.id;
      p.mount = { type: 'helm', idx: 0, ship: p.ship };
      p.x = HELM_STAND.x; p.z = HELM_STAND.z; p.y = DECK;
    } else if (kind === 'cannon') {
      const i = d.idx | 0;
      const c = CANNONS[i];
      if (!c) return;
      const st = sh.cannons[i];
      const opP = st.op ? players[st.op] : null;
      if (opP && !opP.isBot && opP.alive) { notice(p, '大砲は使用中です'); return; }
      if (Math.hypot(p.x - c.sx, p.z - c.z) > 2.9) return;
      if (opP) releaseMount(opP);
      st.op = p.id; st.resv = null;
      p.mount = { type: 'cannon', idx: i, ship: p.ship };
      p.x = c.sx; p.z = c.z; p.y = DECK;
    } else if (kind === 'wood') {
      const near = CRATES.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < 2.8);
      if (!near) return;
      p.wood = MAX_WOOD;
    }
    sendState(p);
  });
  socket.on('fire', () => {
    if (!playing() || !p.mount || p.mount.type !== 'cannon') return;
    const sh = ships[p.mount.ship];
    if (sh.cannons[p.mount.idx].op !== p.id) return;
    fireCannon(sh, p.mount.idx, p);
  });
  socket.on('repair', (d) => {
    if (!playing() || !d) return;
    if (!d.on) { p.repair = null; return; }
    if (p.mount || p.wood < 1 || !p.ship) return;
    const sh = ships[p.ship];
    const hole = sh.holes.find((h) => h.id === (d.id | 0));
    if (!hole || Math.hypot(p.x - hole.x, p.z - hole.z) > 2.7) return;
    if (!p.repair || p.repair.id !== hole.id) p.repair = { id: hole.id, start: Date.now() };
  });

  // ---- 射撃 ----
  socket.on('shoot', (d) => {
    if (!playing() || !d) return;
    const w = WEAPONS[d.w];
    if (!w || p.mount) return;
    const now = Date.now();
    if (now - p.lastShot < w.rate * 0.7) return;
    p.lastShot = now;
    p.weapon = d.w;
    p.repair = null;
    const wp = worldPos(p);
    const eye = { x: wp.x, y: wp.y + 1.6, z: wp.z };
    let o = vecIn(d.o);
    if (Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z) > 4) o = eye;
    const dir = normV(vecIn(d.d));
    socket.to('match').emit('shot', { id: p.id, o: { x: r2(o.x), y: r2(o.y), z: r2(o.z) }, d: { x: r2(dir.x), y: r2(dir.y), z: r2(dir.z) }, w: d.w });
    if (w.melee) {
      crew().forEach((q) => {
        if (q.team === p.team || !q.alive) return;
        const qw = worldPos(q);
        const dx = qw.x - wp.x, dz = qw.z - wp.z, dist = Math.hypot(dx, dz);
        if (dist > w.range || Math.abs(qw.y - wp.y) > 2.2) return;
        const hl = Math.hypot(dir.x, dir.z) || 1;
        const dot = (dx * dir.x + dz * dir.z) / (dist || 1) / hl;
        if (dist < 0.9 || dot > 0.35) applyDamage(q, w.dmg, p, 'cutlass', false);
      });
      return;
    }
    const hitMap = {};
    for (let i = 0; i < w.pellets; i++) {
      const dd = normV({
        x: dir.x + rand(-w.spread, w.spread), y: dir.y + rand(-w.spread, w.spread), z: dir.z + rand(-w.spread, w.spread)
      });
      const h = rayPlayers(p, o, dd, w.range);
      if (!h) continue;
      const fall = w.pellets > 1 ? clamp(1 - (h.t - 12) / 26, 0.25, 1) : 1;
      const dmg = w.dmg * fall * (h.head ? w.head : 1);
      const e = hitMap[h.q.id] || (hitMap[h.q.id] = { q: h.q, dmg: 0, head: false });
      e.dmg += dmg;
      if (h.head) e.head = true;
    }
    Object.values(hitMap).forEach((e) => applyDamage(e.q, Math.round(e.dmg), p, d.w, e.head));
  });

  // ---- 切断 ----
  socket.on('disconnect', () => {
    console.log(`切断: ${socket.id}`);
    leaveMatch(p);
    const pr = p.profile;
    if (pr && onlineByCode[pr.code] === p) {
      delete onlineByCode[pr.code];
      touch(pr);
      notifyFriendsOf(pr);
    }
    delete players[socket.id];
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`POLY PIRATES サーバーがポート ${PORT} で起動しました`);
});
