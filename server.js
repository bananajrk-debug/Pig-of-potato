'use strict';
/* =========================================================
   パチットモンスター 〜風林火山〜  マルチプレイサーバー
   Express + Socket.io
========================================================= */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.json({ status: 'ok', rooms: rooms.size, time: new Date().toISOString() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((req, res) => res.status(404).send('Not Found'));

/* =========================================================
   定数
========================================================= */
const EXPLORE_MS = 5 * 60 * 1000;
const SELECT_MS = 30 * 1000;
const TURN_MS = 60 * 1000;
const SWITCH_MS = 30 * 1000;
const STORM_TURN = 30;
const TICK_MS = 1000 / 15;
const WORLD = { w: 3200, h: 2400 };
const MAX_PLAYERS = 8;
const PLAYER_COLORS = ['#4dc3ff', '#ff8a3d', '#3ee089', '#c77dff', '#ffd166', '#ff4d6d', '#7cf7ff', '#b6f26b'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/* =========================================================
   ゲームデータ
========================================================= */
const STATUS = {
  poison:   { n: '毒',   ic: '☠️', turns: 4, cls: 'st-poison', desc: 'ターン終了時に最大HPの8%ダメージ（4ターン）' },
  burn:     { n: '火傷', ic: '🔥', turns: 3, cls: 'st-burn',   desc: 'ターン終了時に最大HPの6%ダメージ＋攻撃力↓（3ターン）' },
  paralyze: { n: '麻痺', ic: '⚡', turns: 3, cls: 'st-para',   desc: '30%の確率で動けず、じゃんけんに自動で負ける（3ターン）' },
  confuse:  { n: '混乱', ic: '💫', turns: 3, cls: 'st-conf',   desc: '40%の確率で出す手がランダムに変わる（3ターン）' }
};
const ITEMS = {
  power: { n: '闘魂の札',   ic: '🗡️', type: '攻撃', desc: 'このターン与ダメージ1.5倍' },
  guard: { n: '鉄壁の護符', ic: '🛡️', type: '防御', desc: 'このターン被ダメージ半減＋状態異常を防ぐ' },
  heal:  { n: '仙桃',       ic: '🍑', type: '回復', desc: 'HPを40%回復し状態異常も治す' }
};
const HAND_E = { g: '👊', c: '✌️', p: '✋' };
const BEATS = { g: 'c', c: 'p', p: 'g' };
const judge = (a, b) => (a === b ? 0 : (BEATS[a] === b ? 1 : -1));
const RAR_RANK = { N: 0, R: 1, SR: 2, SSR: 3 };

const CHARS = [
  { id: 'homura', name: 'ホムラ丸', title: '侵掠すること火の如し', rar: 'R', em: '🦊', el: '火', col: ['#ff5a1f', '#ffb347'],
    hp: 110, atk: 34, def: 22, spd: 26, beh: 'aggr',
    passive: { key: 'haisui', name: '背水の陣', desc: 'HPが1/3以下になると攻撃力が1.5倍' },
    moves: [
      { name: '紅蓮拳', hand: 'g', power: 40, status: { type: 'burn', chance: .3 }, desc: '30%で火傷' },
      { name: '爆炎ストレート', hand: 'g', power: 58, recoil: .15, desc: '強力だが与ダメの15%反動' },
      { name: '火の粉', hand: 'c', power: 25, status: { type: 'burn', chance: .6 }, desc: '60%で火傷' }
    ] },
  { id: 'kazakiri', name: 'カザキリ', title: '疾きこと風の如し', rar: 'R', em: '🦅', el: '風', col: ['#18c98f', '#7cf7ff'],
    hp: 95, atk: 31, def: 19, spd: 40, beh: 'timid',
    passive: { key: 'shippu', name: '疾風', desc: 'あいこの時でも与えるダメージが半減しない' },
    moves: [
      { name: '鎌鼬', hand: 'c', power: 22, hits: 2, desc: '2回連続で切り裂く' },
      { name: '追い風', hand: 'p', power: 20, selfBuff: { atk: 1 }, desc: '自分の攻撃↑' },
      { name: '疾風斬', hand: 'c', power: 38, crit: .3, desc: '急所率大幅アップ' }
    ] },
  { id: 'shinrin', name: 'シンリン', title: '徐かなること林の如し', rar: 'N', em: '🦌', el: '林', col: ['#2fae3a', '#b6f26b'],
    hp: 130, atk: 25, def: 27, spd: 20, beh: 'calm',
    passive: { key: 'regen', name: '森の恵み', desc: '毎ターン終了時にHPを6%回復' },
    moves: [
      { name: '葉隠れ', hand: 'p', power: 20, guard: .5, desc: 'このターンの被ダメ50%軽減' },
      { name: '吸精の蔓', hand: 'p', power: 32, drain: .5, desc: '与ダメの50%を吸収' },
      { name: '根張り', hand: 'g', power: 25, selfBuff: { def: 1 }, desc: '自分の防御↑' }
    ] },
  { id: 'ganzan', name: 'ガンザン', title: '動かざること山の如し', rar: 'SR', em: '🐢', el: '山', col: ['#8a6440', '#e0c08a'],
    hp: 150, atk: 29, def: 34, spd: 12, beh: 'aggr',
    passive: { key: 'teppeki', name: '岩の鎧', desc: '受けるダメージを常に15%カット' },
    moves: [
      { name: '岩砕き', hand: 'g', power: 42, foeDebuff: { def: -1 }, desc: '相手の防御↓' },
      { name: '山崩し', hand: 'g', power: 62, desc: '山をも崩す重い一撃' },
      { name: '不動の構え', hand: 'p', power: 12, guard: .7, counter: .5, desc: '被ダメ70%軽減・負けたら50%反射' }
    ] },
  { id: 'raijin', name: 'ライジン', title: '轟くこと雷の如し', rar: 'SR', em: '🐯', el: '雷', col: ['#ffb700', '#fff38a'],
    hp: 100, atk: 36, def: 21, spd: 34, beh: 'aggr',
    passive: { key: 'taiden', name: '帯電', desc: '攻撃を当てると20%で相手を麻痺させる' },
    moves: [
      { name: '雷鳴斬', hand: 'c', power: 40, status: { type: 'paralyze', chance: .3 }, desc: '30%で麻痺' },
      { name: '迅雷掌', hand: 'p', power: 34, status: { type: 'paralyze', chance: .25 }, desc: '25%で麻痺' },
      { name: '万雷', hand: 'g', power: 64, recoil: .2, desc: '超威力だが与ダメの20%反動' }
    ] },
  { id: 'dokuron', name: 'ドクロン', title: '蝕むこと毒の如し', rar: 'N', em: '🐍', el: '毒', col: ['#7b2cbf', '#d48bff'],
    hp: 115, atk: 27, def: 24, spd: 27, beh: 'aggr',
    passive: { key: 'dokutai', name: '毒の体', desc: '毒状態の相手へのダメージが1.3倍' },
    moves: [
      { name: '毒牙', hand: 'c', power: 30, status: { type: 'poison', chance: .7 }, desc: '70%で毒' },
      { name: '蝕み', hand: 'c', power: 22, foeDebuff: { atk: -1 }, status: { type: 'poison', chance: .3 }, desc: '相手の攻撃↓・30%で毒' },
      { name: 'ヘドロ波', hand: 'p', power: 36, status: { type: 'poison', chance: .4 }, desc: '40%で毒' }
    ] },
  { id: 'mizuchi', name: 'ミズチ', title: '流るること水の如し', rar: 'R', em: '🐲', el: '水', col: ['#1f6bff', '#6fd3ff'],
    hp: 120, atk: 29, def: 26, spd: 29, beh: 'calm',
    passive: { key: 'seiryu', name: '清流', desc: '状態異常の継続ターンが半分になる' },
    moves: [
      { name: '激流', hand: 'p', power: 46, desc: '激しい水流で押し流す' },
      { name: '水鏡', hand: 'g', power: 15, counter: .6, desc: '負けた時、受けたダメージの60%を反射' },
      { name: '霧隠れ', hand: 'c', power: 22, status: { type: 'confuse', chance: .5 }, desc: '50%で混乱' }
    ] },
  { id: 'tsukuyomi', name: 'ツクヨミ', title: '朧なること月の如し', rar: 'SSR', em: '🐇', el: '月', col: ['#8f7bff', '#f0ecff'],
    hp: 115, atk: 38, def: 28, spd: 36, beh: 'timid',
    passive: { key: 'mikiri', name: '見切り', desc: '25%の確率で相手の攻撃を完全回避' },
    moves: [
      { name: '月光', hand: 'p', power: 30, heal: .25, desc: '攻撃しつつ最大HPの25%回復' },
      { name: '朧月', hand: 'c', power: 48, status: { type: 'confuse', chance: .3 }, desc: '30%で混乱' },
      { name: '満月砕き', hand: 'g', power: 66, desc: '満月の力で粉砕する' }
    ] },
  { id: 'maneki', name: 'マネキネコ', title: '招くこと福の如し', rar: 'N', em: '🐱', el: '金', col: ['#ffb703', '#fff2b0'],
    hp: 105, atk: 26, def: 22, spd: 31, beh: 'timid',
    passive: { key: 'shofuku', name: '招福', desc: '急所率+20%' },
    moves: [
      { name: '小判投げ', hand: 'p', power: 32, crit: .2, desc: '急所率アップ' },
      { name: '招き手', hand: 'p', power: 20, foeDebuff: { atk: -1 }, desc: '相手の攻撃↓' },
      { name: '猫パンチ', hand: 'g', power: 38, desc: 'すばやい一撃' }
    ] },
  { id: 'shingen', name: 'シンゲン', title: '風林火山の大将', rar: 'SSR', em: '🦁', el: '将', col: ['#e0103a', '#ffd166'],
    hp: 135, atk: 35, def: 30, spd: 28, beh: 'aggr',
    passive: { key: 'furinkazan', name: '風林火山', desc: 'あらゆる状態異常にかからない' },
    moves: [
      { name: '疾風の号令', hand: 'c', power: 36, selfBuff: { atk: 1 }, desc: '攻撃しつつ自分の攻撃↑' },
      { name: '静林の陣', hand: 'p', power: 20, guard: .5, heal: .15, desc: '被ダメ50%軽減・HP15%回復' },
      { name: '侵掠如火', hand: 'g', power: 55, status: { type: 'burn', chance: .3 }, desc: '30%で火傷' }
    ] }
];
const CHAR_MAP = Object.fromEntries(CHARS.map(c => [c.id, c]));

function rollRarity(ssrRate = 5) {
  const r = Math.random() * 100;
  if (r < ssrRate) return 'SSR';
  if (r < ssrRate + 15) return 'SR';
  if (r < ssrRate + 49) return 'R';
  return 'N';
}
function drawOne(exclude = [], ssrRate = 5) {
  const rar = rollRarity(ssrRate);
  let pool = CHARS.filter(c => c.rar === rar && !exclude.includes(c.id));
  if (!pool.length) pool = CHARS.filter(c => !exclude.includes(c.id));
  if (!pool.length) pool = CHARS;
  return pick(pool);
}
const totalStat = c => c.hp + c.atk + c.def + c.spd;

/* =========================================================
   ルーム管理
========================================================= */
const rooms = new Map();

function lobbyPayload(room) {
  return {
    code: room.code, phase: room.phase, hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, host: p.id === room.hostId }))
  };
}
function broadcastLobby(room) { io.to(room.code).emit('lobby', lobbyPayload(room)); }
function ctxOf(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return {};
  return { room, p: room.players.get(socket.id) };
}
function toastTo(id, text, cls = '') { io.to(id).emit('toast', { text, cls }); }
function sendInv(p) { io.to(p.id).emit('inv', { balls: p.inv.balls, items: p.inv.items, party: p.party }); }
function fx(room, list) { io.to(room.code).emit('fx', list); }

function newPlayer(socket, name, room) {
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = PLAYER_COLORS.find(c => !used.has(c)) || pick(PLAYER_COLORS);
  return {
    id: socket.id, name, color, x: WORLD.w / 2, y: WORLD.h / 2, dx: 0, dy: 1, sw: 0, stun: false,
    lastSword: 0, lastThrow: 0,
    inv: { balls: 6, items: { power: 1, guard: 1, heal: 1 } },
    party: [], team: null, selected: false, rescued: 0,
    stats: { caught: 0, defeated: 0, chests: 0 }, battle: null
  };
}

function cleanupRoom(room) {
  clearInterval(room.tick);
  clearTimeout(room.exploreTimer);
  clearTimeout(room.selectTimer);
  clearTimeout(room.selectStartTimer);
  for (const B of room.battles || []) clearTimeout(B.timer);
}

function leaveRoom(socket) {
  const code = socket.data.room;
  if (!code) return;
  socket.data.room = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(socket.id);
  room.players.delete(socket.id);
  if (room.players.size === 0) { cleanupRoom(room); rooms.delete(code); return; }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  if (p) {
    io.to(code).emit('toast', { text: `${p.name} が退出しました`, cls: 'warn' });
    if (p.battle && !p.battle.over) battleForfeit(p.battle, p.id);
  }
  if (room.phase === 'select' && [...room.players.values()].every(q => q.selected)) finishSelect(room);
  if (room.phase === 'battle') checkAllBattles(room);
  broadcastLobby(room);
}

/* =========================================================
   ワールド生成
========================================================= */
function genWorld(room) {
  const obs = [], chests = [];
  const cx = WORLD.w / 2, cy = WORLD.h / 2;
  const nearCenter = (x, y) => Math.hypot(x - cx, y - cy) < 260;
  for (let k = 0; k < 12; k++) {
    const fx0 = rnd(200, WORLD.w - 200), fy0 = rnd(200, WORLD.h - 200);
    if (nearCenter(fx0, fy0)) continue;
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const x = clamp(fx0 + rnd(-140, 140), 40, WORLD.w - 40), y = clamp(fy0 + rnd(-110, 110), 40, WORLD.h - 40);
      obs.push({ x: Math.round(x), y: Math.round(y), r: 22, s: +rnd(.9, 1.3).toFixed(2), type: 'tree' });
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = rnd(40, WORLD.w - 40), y = rnd(40, WORLD.h - 40);
    if (nearCenter(x, y)) continue;
    const tree = Math.random() < .6;
    obs.push({ x: Math.round(x), y: Math.round(y), r: tree ? 22 : 18, s: +rnd(.8, 1.25).toFixed(2), type: tree ? 'tree' : 'rock' });
  }
  room.obs = obs;
  room.chests = chests;
  let guard = 0;
  while (chests.length < 30 && guard++ < 2000) {
    const x = rnd(80, WORLD.w - 80), y = rnd(80, WORLD.h - 80);
    if (nearCenter(x, y)) continue;
    if (obs.some(o => Math.hypot(x - o.x, y - o.y) < o.r * o.s + 50)) continue;
    if (chests.some(c => Math.hypot(x - c.x, y - c.y) < 140)) continue;
    chests.push({ id: chests.length, x: Math.round(x), y: Math.round(y), open: false, gold: Math.random() < .15 });
  }
  room.mons = [];
  room.balls = [];
  room.monSeq = 1;
  room.spawnT = 0;
}

function freeSpot(room, minPlayerDist) {
  const ps = [...room.players.values()];
  for (let i = 0; i < 80; i++) {
    const x = rnd(80, WORLD.w - 80), y = rnd(80, WORLD.h - 80);
    if (ps.some(p => Math.hypot(x - p.x, y - p.y) < minPlayerDist)) continue;
    if (room.obs.some(o => Math.hypot(x - o.x, y - o.y) < o.r * o.s + 40)) continue;
    if (room.chests.some(c => Math.hypot(x - c.x, y - c.y) < 60)) continue;
    return { x, y };
  }
  return { x: rnd(80, WORLD.w - 80), y: rnd(80, WORLD.h - 80) };
}

function spawnMon(room, minDist) {
  const c = drawOne([], 4);
  const pos = freeSpot(room, minDist);
  const mh = Math.round(c.hp * .6);
  room.mons.push({
    i: room.monSeq++, c, x: pos.x, y: pos.y, hp: mh, mh, state: 'w', t: rnd(0, 2), wx: 0, wy: 0, kx: 0, ky: 0,
    anger: 0, spd: 50 + c.spd * 2.6, faintT: 0, capT: 0, capChance: 0, capOwner: null, hitCd: 0
  });
}
const monCap = room => Math.min(30, 14 + room.players.size * 3);

function collide(room, e, r) {
  for (const o of room.obs) {
    const rr = o.r * o.s * .8 + r;
    const dx = e.x - o.x, dy = e.y - o.y, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1; e.x = o.x + dx / d * rr; e.y = o.y + dy / d * rr; }
  }
  for (const c of room.chests) {
    const rr = 16 + r, cy = c.y - 10;
    const dx = e.x - c.x, dy = e.y - cy, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1; e.x = c.x + dx / d * rr; e.y = cy + dy / d * rr; }
  }
  e.x = clamp(e.x, r, WORLD.w - r);
  e.y = clamp(e.y, r, WORLD.h - r);
}

/* =========================================================
   探索フェーズ：開始・進行
========================================================= */
function startGame(room) {
  cleanupRoom(room);
  room.phase = 'explore';
  room.battles = [];
  genWorld(room);
  const ps = [...room.players.values()];
  ps.forEach((p, i) => {
    const a = (i / Math.max(1, ps.length)) * Math.PI * 2;
    p.x = WORLD.w / 2 + Math.cos(a) * (ps.length > 1 ? 70 : 0);
    p.y = WORLD.h / 2 + Math.sin(a) * (ps.length > 1 ? 70 : 0);
    p.dx = 0; p.dy = 1; p.sw = 0; p.stun = false;
    p.inv = { balls: 6, items: { power: 1, guard: 1, heal: 1 } };
    p.party = []; p.team = null; p.selected = false; p.rescued = 0; p.battle = null;
    p.stats = { caught: 0, defeated: 0, chests: 0 };
  });
  const n = monCap(room);
  for (let i = 0; i < n; i++) spawnMon(room, 380);
  room.endAt = Date.now() + EXPLORE_MS;
  const players = ps.map(p => ({ id: p.id, name: p.name, color: p.color }));
  for (const p of ps) {
    io.to(p.id).emit('gameStart', {
      world: WORLD, obs: room.obs, chests: room.chests, you: { x: p.x, y: p.y },
      left: EXPLORE_MS, players
    });
    sendInv(p);
  }
  broadcastLobby(room);
  room.tick = setInterval(() => tickRoom(room), TICK_MS);
  room.exploreTimer = setTimeout(() => endExplore(room), EXPLORE_MS);
}

function hitMon(room, m, p, nx, ny) {
  const crit = Math.random() < .15;
  const dmg = Math.round(rnd(17, 25) * (crit ? 1.6 : 1));
  m.hp = Math.max(0, m.hp - dmg);
  m.kx = nx * 420; m.ky = ny * 420;
  if (m.c.beh === 'calm') m.anger = 6;
  fx(room, [
    { k: 'pop', x: m.x, y: m.y - 30, s: (crit ? '会心！' : '') + dmg, col: crit ? '#ffd166' : '#ffffff', z: crit ? 22 : 18 },
    { k: 'burst', x: m.x, y: m.y, col: '#ffffff', n: 8, sp: 140 },
    { k: 'flash', i: m.i }
  ]);
  if (m.hp <= 0) defeatMon(room, m, p);
}

function defeatMon(room, m, p) {
  p.stats.defeated++;
  fx(room, [{ k: 'burst', x: m.x, y: m.y, col: m.c.col[0], n: 22, sp: 220 }]);
  if (Math.random() < .25) {
    room.mons.splice(room.mons.indexOf(m), 1);
    giveMon(room, p, m.c, `${m.c.em} ${m.c.name} は仲間になりたそうにこちらを見ている… 仲間に加わった！`);
  } else {
    m.state = 'f'; m.faintT = 8; m.kx *= .3; m.ky *= .3;
    fx(room, [{ k: 'pop', x: m.x, y: m.y - 46, s: '気絶！ボールで確定GET', col: '#ffd166', z: 14 }]);
  }
  if (Math.random() < .35) giveRandom(room, p, m.x, m.y, false, false);
}

function giveMon(room, p, c, msg) {
  p.party.push({ uid: 'u' + Math.random().toString(36).slice(2, 9), id: c.id });
  p.stats.caught++;
  sendInv(p);
  toastTo(p.id, msg || `🎉 ${c.em} ${c.name}（${c.rar}）をゲットした！`, c.rar === 'SSR' ? 'get ssr' : 'get');
  if (RAR_RANK[c.rar] >= 2) {
    for (const q of room.players.values()) if (q.id !== p.id) toastTo(q.id, `📣 ${p.name} が ${c.rar} ${c.em}${c.name} をゲット！`, 'item');
  }
}

function giveRandom(room, p, x, y, fromChest, gold) {
  const r = Math.random();
  let text;
  if (r < .4) {
    const n = gold ? 3 : 1 + Math.floor(Math.random() * (fromChest ? 3 : 2));
    p.inv.balls += n; text = `パチボール ×${n}`;
  } else {
    const k = r < .62 ? 'heal' : r < .81 ? 'power' : 'guard';
    const n = gold ? 2 : (Math.random() < .25 ? 2 : 1);
    p.inv.items[k] += n; text = `${ITEMS[k].ic}${ITEMS[k].n} ×${n}`;
  }
  sendInv(p);
  fx(room, [{ k: 'pop', x, y: y - 40, s: text, col: '#7cf7ff', z: 15 }]);
  toastTo(p.id, `${fromChest ? '📦 宝箱から' : '✨'} ${text} を手に入れた！`, 'item');
}

function startCapture(m, ownerId) {
  const base = { N: .65, R: .45, SR: .3, SSR: .18 }[m.c.rar];
  m.capChance = m.state === 'f' ? 1 : Math.min(.95, base * (1 + (1 - m.hp / m.mh) * 1.6));
  m.state = 'c'; m.capT = 1.5; m.kx = m.ky = 0; m.capOwner = ownerId;
}

function resolveCapture(room, m) {
  const owner = room.players.get(m.capOwner);
  if (owner && Math.random() < m.capChance) {
    room.mons.splice(room.mons.indexOf(m), 1);
    fx(room, [
      { k: 'burst', x: m.x, y: m.y, col: '#ffd166', n: 26, sp: 240 },
      { k: 'pop', x: m.x, y: m.y - 34, s: 'GET!!', col: '#ffd166', z: 24 }
    ]);
    giveMon(room, owner, m.c);
  } else {
    m.state = 'w';
    if (m.hp <= 0) m.hp = Math.ceil(m.mh * .3);
    m.anger = m.c.beh === 'timid' ? 0 : 5;
    fx(room, [
      { k: 'burst', x: m.x, y: m.y, col: '#ffffff', n: 18, sp: 220 },
      { k: 'pop', x: m.x, y: m.y - 34, s: '逃げられた！', col: '#ff9aa8', z: 16 }
    ]);
    if (owner) toastTo(owner.id, `${m.c.em} ${m.c.name} はボールから飛び出した！`, 'warn');
  }
  m.capOwner = null;
}

function tickRoom(room) {
  if (room.phase !== 'explore') return;
  const dt = TICK_MS / 1000;
  const ps = [...room.players.values()];

  // 野生パチモン
  for (let i = room.mons.length - 1; i >= 0; i--) {
    const m = room.mons[i];
    m.hitCd = Math.max(0, m.hitCd - dt);
    if (m.state === 'c') {
      m.capT -= dt;
      if (m.capT <= 0) resolveCapture(room, m);
      continue;
    }
    if (m.state === 'f') {
      m.faintT -= dt;
      m.x += m.kx * dt; m.y += m.ky * dt;
      m.kx *= Math.pow(.02, dt); m.ky *= Math.pow(.02, dt);
      collide(room, m, 18);
      if (m.faintT <= 0) {
        m.state = 'w'; m.hp = Math.ceil(m.mh * .4);
        fx(room, [{ k: 'pop', x: m.x, y: m.y - 30, s: '目を覚ました', col: '#ffffff', z: 13 }]);
      }
      continue;
    }
    m.anger = Math.max(0, m.anger - dt);
    let target = null, td = 1e9;
    for (const p of ps) {
      if (p.stun) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < td) { td = d; target = p; }
    }
    const aggressive = (m.c.beh === 'aggr' || m.anger > 0) && target;
    let tx = 0, ty = 0, sp = m.spd;
    if (aggressive && td < 290) {
      tx = (target.x - m.x) / (td || 1); ty = (target.y - m.y) / (td || 1);
      sp *= m.c.beh === 'aggr' ? .78 : .9;
    } else if (m.c.beh === 'timid' && target && td < 220) {
      tx = -(target.x - m.x) / (td || 1); ty = -(target.y - m.y) / (td || 1); sp *= .95;
    } else {
      m.t -= dt;
      if (m.t <= 0) {
        m.t = rnd(1.2, 3);
        if (Math.random() < .35) { m.wx = 0; m.wy = 0; }
        else { const a = Math.random() * Math.PI * 2; m.wx = Math.cos(a); m.wy = Math.sin(a); }
      }
      tx = m.wx; ty = m.wy; sp *= .4;
    }
    m.x += (tx * sp + m.kx) * dt; m.y += (ty * sp + m.ky) * dt;
    m.kx *= Math.pow(.02, dt); m.ky *= Math.pow(.02, dt);
    const bx = m.x, by = m.y;
    collide(room, m, 18);
    if ((bx !== m.x || by !== m.y) && !aggressive) m.t = 0;
    if (aggressive && td < 38 && m.hitCd <= 0) {
      io.to(target.id).emit('hurt', { d: 8 + RAR_RANK[m.c.rar] * 3, x: m.x, y: m.y });
      m.hitCd = 1;
    }
  }

  // パチボール（サブステップで当たり判定）
  for (let i = room.balls.length - 1; i >= 0; i--) {
    const b = room.balls[i];
    let done = false;
    for (let s = 0; s < 3 && !done; s++) {
      const sx = b.vx * dt / 3, sy = b.vy * dt / 3;
      b.x += sx; b.y += sy; b.dist += Math.hypot(sx, sy);
      for (const m of room.mons) {
        if (m.state === 'c') continue;
        if (Math.hypot(m.x - b.x, m.y - b.y) < 26) { startCapture(m, b.owner); done = true; break; }
      }
      if (!done && room.obs.some(o => Math.hypot(o.x - b.x, o.y - b.y) < o.r * o.s * .8 + 6)) {
        fx(room, [{ k: 'pop', x: b.x, y: b.y - 10, s: 'ミス', col: '#cfd5f2', z: 13 }, { k: 'burst', x: b.x, y: b.y, col: '#ff3d6e', n: 6, sp: 90 }]);
        done = true;
      }
      if (!done && (b.dist > 380 || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h)) {
        fx(room, [{ k: 'pop', x: b.x, y: b.y - 10, s: 'ハズレ', col: '#cfd5f2', z: 13 }]);
        done = true;
      }
    }
    if (done) room.balls.splice(i, 1);
  }

  // スポーン
  room.spawnT -= dt;
  if (room.mons.length < monCap(room) && room.spawnT <= 0) { spawnMon(room, 480); room.spawnT = 1.6; }

  // スナップショット送信
  io.to(room.code).emit('snap', {
    left: Math.max(0, room.endAt - Date.now()),
    pl: ps.map(p => [p.id, Math.round(p.x), Math.round(p.y), Math.round(p.dx * 100), Math.round(p.dy * 100), p.sw, p.stun ? 1 : 0]),
    m: room.mons.map(m => [m.i, m.c.id, Math.round(m.x), Math.round(m.y), m.hp, m.mh,
      m.state === 'f' ? 1 : m.state === 'c' ? 2 : 0, (m.c.beh === 'aggr' || m.anger > 0) ? 1 : 0, Math.round(m.capT * 10)]),
    b: room.balls.map(b => [Math.round(b.x), Math.round(b.y)])
  });
}

function endExplore(room) {
  if (room.phase !== 'explore') return;
  clearTimeout(room.exploreTimer);
  clearInterval(room.tick);
  room.phase = 'select';
  io.to(room.code).emit('exploreEnd');
  room.selectStartTimer = setTimeout(() => startSelect(room), 1800);
}

/* =========================================================
   選択フェーズ
========================================================= */
function startSelect(room) {
  if (room.phase !== 'select') return;
  for (const p of room.players.values()) {
    p.rescued = 0;
    while (p.party.length < 3) {
      p.party.push({ uid: 'r' + Math.random().toString(36).slice(2, 9), id: drawOne([], 3).id });
      p.rescued++;
    }
    p.selected = false; p.team = null;
    io.to(p.id).emit('selectStart', { party: p.party, left: SELECT_MS, rescued: p.rescued, stats: p.stats, items: p.inv.items });
  }
  room.selectEnd = Date.now() + SELECT_MS;
  room.selectTimer = setTimeout(() => finishSelect(room), SELECT_MS + 800);
}

function autoTeam(p) {
  return p.party.slice().sort((a, b) => {
    const ca = CHAR_MAP[a.id], cb = CHAR_MAP[b.id];
    return RAR_RANK[cb.rar] - RAR_RANK[ca.rar] || totalStat(cb) - totalStat(ca);
  }).slice(0, 3);
}

function finishSelect(room) {
  if (room.phase !== 'select') return;
  clearTimeout(room.selectTimer);
  const ps = [...room.players.values()];
  for (const p of ps) if (!p.team) { p.team = autoTeam(p); p.selected = true; }
  room.phase = 'battle';
  room.battles = [];
  broadcastLobby(room);
  const order = shuffle(ps);
  for (let i = 0; i < order.length; i += 2) createBattle(room, order[i], order[i + 1] || null);
}

/* =========================================================
   バトルエンジン（サーバー権威）
========================================================= */
const stageMul = s => (s >= 0 ? 1 + .25 * s : 1 / (1 - .25 * s));
const act = side => side.units[side.idx];
const avail = u => [0, 1, 2].filter(i => i !== u.lastSlot);

function makeUnit(id, sk) {
  const c = CHAR_MAP[id];
  return {
    id: c.id, name: c.name, rar: c.rar, hp: c.hp, maxHp: c.hp, atk: c.atk, def: c.def, spd: c.spd,
    passive: c.passive, moves: c.moves, status: null, atkSt: 0, defSt: 0, lastSlot: null, flags: {}, fainted: false, sk
  };
}
function snapB(B) {
  const f = s => ({
    idx: s.idx, items: { ...s.items },
    u: s.units.map(u => ({ hp: u.hp, st: u.status ? [u.status.type, u.status.turns] : null, a: u.atkSt, d: u.defSt, fl: { ...u.flags }, ls: u.lastSlot, fa: u.fainted }))
  });
  return { a: f(B.sides.a), b: f(B.sides.b) };
}
function ev(B, o) { o.snap = snapB(B); B.ev.push(o); }
function say(B, s, c = '', ms, extra = {}) { ev(B, { t: 'log', s, c, ms, ...extra }); }
function bfx(B, side, f, pop, cls) { ev(B, { t: 'fx', side, f, pop, cls }); }

function effAtk(u) {
  let a = u.atk * stageMul(u.atkSt);
  if (u.passive.key === 'haisui' && u.hp <= u.maxHp / 3) a *= 1.5;
  if (u.status && u.status.type === 'burn') a *= .75;
  return a;
}
function calcDamage(att, def, mv, mult) {
  const df = def.def * stageMul(def.defSt);
  let dmg = mv.power * effAtk(att) / df * .8 * rnd(.9, 1.1) * mult;
  if (att.flags.power) dmg *= 1.5;
  if (att.passive.key === 'dokutai' && def.status && def.status.type === 'poison') dmg *= 1.3;
  const critRate = .06 + (mv.crit || 0) + (att.passive.key === 'shofuku' ? .2 : 0);
  const crit = Math.random() < critRate;
  if (crit) dmg *= 1.5;
  if (def.passive.key === 'teppeki') dmg *= .85;
  if (def.flags.guard) dmg *= .5;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}
function healU(u, n) { const b = u.hp; u.hp = Math.min(u.maxHp, u.hp + n); return u.hp - b; }

function inflict(B, t, type) {
  if (t.hp <= 0 || t.status) return;
  if (t.passive.key === 'furinkazan') { say(B, `${t.name}は【風林火山】で${STATUS[type].n}を受けつけない！`, 'sys'); return; }
  if (t.flags.guard) { say(B, `${t.name}は護符の結界で${STATUS[type].n}を防いだ！`, 'sys'); return; }
  let turns = STATUS[type].turns;
  if (t.passive.key === 'seiryu') turns = Math.ceil(turns / 2);
  t.status = { type, turns };
  say(B, `${t.name}は${STATUS[type].ic}${STATUS[type].n}になった！`, 'st');
}
function stage(B, u, key, delta) {
  const k = key === 'atk' ? 'atkSt' : 'defSt', label = key === 'atk' ? '攻撃' : '防御';
  const before = u[k];
  u[k] = clamp(u[k] + delta, -2, 2);
  if (u[k] === before) { say(B, `${u.name}の${label}はこれ以上変わらない！`, 'sys', 400); return; }
  say(B, `${u.name}の${label}が${delta > 0 ? '上がった！' : '下がった！'}`, delta > 0 ? 'up' : 'down', 450);
}
function canAct(B, u) {
  if (u.status && u.status.type === 'paralyze' && Math.random() < .3) {
    say(B, `${u.name}は体がしびれて動けない！`, 'st', 560, { side: u.sk, pre: true });
    return false;
  }
  return true;
}

function doAttack(B, att, def, mv, mult, defMv, defLost) {
  if (att.hp <= 0 || def.hp <= 0) return;
  bfx(B, att.sk, 'lunge');
  say(B, `${att.name}の【${mv.name}】！`, 'act', 420, { side: att.sk, pre: true });
  let total = 0, dodged = false;
  if (def.passive.key === 'mikiri' && Math.random() < .25) {
    dodged = true;
    bfx(B, def.sk, 'none', 'MISS', 'miss');
    say(B, `${def.name}は【見切り】で攻撃をかわした！`, 'sys');
  }
  if (!dodged) {
    const hits = mv.hits || 1;
    for (let h = 0; h < hits && def.hp > 0; h++) {
      let { dmg, crit } = calcDamage(att, def, mv, mult);
      if (defMv && defMv.guard) dmg = Math.max(1, Math.round(dmg * (1 - defMv.guard)));
      def.hp = Math.max(0, def.hp - dmg);
      total += dmg;
      bfx(B, def.sk, 'shake', '-' + dmg, crit ? 'crit' : '');
      say(B, `${crit ? '急所に当たった！ ' : ''}${def.name}に ${dmg} のダメージ！`, 'dmg', hits > 1 ? 420 : 560);
    }
    if (hits > 1) say(B, `${hits}回ヒット！`, 'sys', 320);
    if (defMv && defMv.guard && total > 0) say(B, `（${defMv.name}でダメージを軽減した）`, 'sys', 320);
  }
  if (mv.drain && total > 0 && att.hp > 0) {
    const h = healU(att, Math.round(total * mv.drain));
    if (h) { bfx(B, att.sk, 'heal', '+' + h, 'healp'); say(B, `${att.name}はHPを ${h} 吸収した！`, 'heal'); }
  }
  if (mv.heal && att.hp > 0) {
    const h = healU(att, Math.round(att.maxHp * mv.heal));
    if (h) { bfx(B, att.sk, 'heal', '+' + h, 'healp'); say(B, `${att.name}はHPが ${h} 回復した！`, 'heal'); }
  }
  if (mv.recoil && total > 0 && att.hp > 0) {
    const r = Math.max(1, Math.round(total * mv.recoil));
    att.hp = Math.max(0, att.hp - r);
    bfx(B, att.sk, 'shake', '-' + r, '');
    say(B, `${att.name}は反動で ${r} のダメージ！`, 'dmg');
  }
  if (mv.selfBuff && att.hp > 0) for (const k in mv.selfBuff) stage(B, att, k, mv.selfBuff[k]);
  if (!dodged && def.hp > 0) {
    if (mv.foeDebuff) for (const k in mv.foeDebuff) stage(B, def, k, mv.foeDebuff[k]);
    if (mv.status && Math.random() < mv.status.chance) inflict(B, def, mv.status.type);
    if (att.passive.key === 'taiden' && total > 0 && !def.status && Math.random() < .2) {
      say(B, `${att.name}の【帯電】が発動！`, 'sys', 380);
      inflict(B, def, 'paralyze');
    }
  }
  if (defLost && defMv && defMv.counter && def.hp > 0 && att.hp > 0 && total > 0) {
    const r = Math.max(1, Math.round(total * defMv.counter));
    att.hp = Math.max(0, att.hp - r);
    bfx(B, att.sk, 'shake', '-' + r, '');
    say(B, `${def.name}の【${defMv.name}】！ ${r} のダメージを跳ね返した！`, 'dmg');
  }
}

function useItem(B, side, u, k) {
  side.items[k]--;
  ev(B, { t: 'item', side: u.sk, k });
  if (k === 'power') { u.flags.power = true; say(B, `${u.name}の攻撃に闘魂が宿った！`, 'up'); }
  else if (k === 'guard') { u.flags.guard = true; say(B, `${u.name}は護符の結界に包まれた！`, 'up'); }
  else {
    const h = healU(u, Math.round(u.maxHp * .4));
    bfx(B, u.sk, 'heal', h ? '+' + h : '', 'healp');
    say(B, `${u.name}のHPが ${h} 回復した！`, 'heal');
    if (u.status) { const n = STATUS[u.status.type].n; u.status = null; say(B, `${u.name}の${n}が治った！`, 'heal'); }
  }
}

function resolveClash(B, ma, mb) {
  const A = act(B.sides.a), Bu = act(B.sides.b);
  const am = A.moves[ma], bm = Bu.moves[mb];
  let aH = am.hand, bH = bm.hand;
  const aCan = canAct(B, A), bCan = canAct(B, Bu);
  const others = h => ['g', 'c', 'p'].filter(x => x !== h);
  if (aCan && A.status && A.status.type === 'confuse' && Math.random() < .4) {
    aH = pick(others(am.hand));
    say(B, `${A.name}は混乱して手が ${HAND_E[am.hand]}→${HAND_E[aH]} に変わった！`, 'st', 560, { side: 'a', pre: true });
  }
  if (bCan && Bu.status && Bu.status.type === 'confuse' && Math.random() < .4) {
    bH = pick(others(bm.hand));
    say(B, `${Bu.name}は混乱して手が ${HAND_E[bm.hand]}→${HAND_E[bH]} に変わった！`, 'st', 560, { side: 'b', pre: true });
  }
  let res;
  if (!aCan && !bCan) res = null;
  else if (!aCan) res = -1;
  else if (!bCan) res = 1;
  else res = judge(aH, bH);
  ev(B, { t: 'clash', h: { a: aCan ? aH : null, b: bCan ? bH : null }, res });

  if (res === 1) doAttack(B, A, Bu, am, 1, bCan ? bm : null, true);
  else if (res === -1) doAttack(B, Bu, A, bm, 1, aCan ? am : null, true);
  else if (res === 0) {
    const aFirst = A.spd > Bu.spd || (A.spd === Bu.spd && Math.random() < .5);
    const order = aFirst ? [[A, Bu, am, bm], [Bu, A, bm, am]] : [[Bu, A, bm, am], [A, Bu, am, bm]];
    for (const [x, y, xm, ym] of order) {
      if (x.hp <= 0 || y.hp <= 0) continue;
      doAttack(B, x, y, xm, x.passive.key === 'shippu' ? 1 : .5, ym, false);
    }
  }
}

function endOfTurn(B) {
  if (B.turn >= STORM_TURN) {
    say(B, `⚡ 決戦の嵐が吹き荒れる！（${STORM_TURN}ターン目以降）`, 'down', 420);
    for (const u of [act(B.sides.a), act(B.sides.b)]) {
      if (u.hp <= 0) continue;
      const d = Math.max(1, Math.round(u.maxHp * .1));
      u.hp = Math.max(0, u.hp - d);
      bfx(B, u.sk, 'shake', '-' + d, 'stdmg');
      say(B, `${u.name}は嵐で ${d} のダメージ！`, 'dmg', 420);
    }
  }
  for (const u of [act(B.sides.a), act(B.sides.b)]) {
    if (u.hp <= 0) continue;
    if (u.status) {
      const st = u.status, info = STATUS[st.type];
      if (st.type === 'poison' || st.type === 'burn') {
        const d = Math.max(1, Math.round(u.maxHp * (st.type === 'poison' ? .08 : .06)));
        u.hp = Math.max(0, u.hp - d);
        bfx(B, u.sk, 'shake', '-' + d, 'stdmg');
        say(B, `${u.name}は${info.n}で ${d} のダメージ！`, 'st');
      }
      if (u.hp > 0) {
        st.turns--;
        if (st.turns <= 0) { u.status = null; say(B, `${u.name}の${info.n}が治った！`, 'heal'); }
      }
    }
    if (u.hp > 0 && u.passive.key === 'regen' && u.hp < u.maxHp) {
      const h = healU(u, Math.round(u.maxHp * .06));
      if (h) { bfx(B, u.sk, 'heal', '+' + h, 'healp'); say(B, `${u.name}は【森の恵み】でHPが ${h} 回復！`, 'heal', 460); }
    }
  }
}

function checkFaints(B) {
  for (const sk of ['b', 'a']) {
    const u = act(B.sides[sk]);
    if (u.hp <= 0 && !u.fainted) {
      u.fainted = true;
      ev(B, { t: 'faint', side: sk });
      say(B, `${u.name}は倒れた！`, 'ko', 800, { side: sk, pre: true });
    }
  }
  const aA = B.sides.a.units.some(u => u.hp > 0), bA = B.sides.b.units.some(u => u.hp > 0);
  if (!aA || !bA) {
    B.over = true;
    ev(B, { t: 'end', winner: aA ? 'a' : bA ? 'b' : 'draw', turn: B.turn });
    return;
  }
  for (const sk of ['b', 'a']) {
    const side = B.sides[sk];
    if (!act(side).fainted) continue;
    const alive = side.units.map((u, i) => [u, i]).filter(([u]) => u.hp > 0);
    if (side.cpu || alive.length === 1) {
      side.idx = alive[0][1];
      ev(B, { t: 'enter', side: sk });
    } else {
      B.pending[sk] = true;
    }
  }
}

/* ----- CPU ----- */
function estDmg(a, d, m) {
  let v = m.power * effAtk(a) / (d.def * stageMul(d.defSt)) * .8 * (m.hits || 1);
  if (d.passive.key === 'teppeki') v *= .85;
  if (a.passive.key === 'dokutai' && d.status && d.status.type === 'poison') v *= 1.3;
  return v;
}
function cpuChoose(E, P) {
  const ea = avail(E), pa = avail(P);
  let best = ea[0], bs = -1e9;
  for (const i of ea) {
    const em = E.moves[i];
    let evv = 0;
    for (const j of pa) {
      const pm = P.moves[j];
      const r = judge(em.hand, pm.hand);
      const de = estDmg(E, P, em) * (pm.guard ? 1 - pm.guard : 1);
      const dp = estDmg(P, E, pm) * (em.guard ? 1 - em.guard : 1);
      let v;
      if (r === 1) v = de;
      else if (r === -1) v = -dp + (em.counter ? dp * em.counter * .8 : 0);
      else v = de * (E.passive.key === 'shippu' ? 1 : .5) - dp * (P.passive.key === 'shippu' ? 1 : .5);
      if (r >= 0) {
        if (em.status && !P.status && P.passive.key !== 'furinkazan') v += 9 * em.status.chance;
        if (em.heal) v += Math.min(E.maxHp - E.hp, E.maxHp * em.heal) * .6;
        if (em.selfBuff) v += 5;
        if (em.foeDebuff) v += 4;
        if (em.recoil) v -= de * em.recoil * .6;
      }
      if (r === 1 && de >= P.hp) v += 40;
      if (r === -1 && dp >= E.hp) v -= 30;
      evv += v;
    }
    evv = evv / pa.length + rnd(-9, 9);
    if (evv > bs) { bs = evv; best = i; }
  }
  return best;
}
function cpuItem(side, u) {
  const it = side.items;
  if (it.heal > 0 && (u.hp < u.maxHp * .35 || (u.status && u.hp < u.maxHp * .6)) && Math.random() < .75) return 'heal';
  if (it.guard > 0 && u.hp < u.maxHp * .55 && Math.random() < .3) return 'guard';
  if (it.power > 0 && Math.random() < .18) return 'power';
  return null;
}

/* ----- バトル進行 ----- */
let battleSeq = 1;
function createBattle(room, p1, p2) {
  const mkSide = (p, sk) => ({
    pid: p.id, name: p.name, cpu: false, idx: 0,
    units: p.team.map(e => makeUnit(e.id, sk)), items: { ...p.inv.items }
  });
  const cpuSide = sk => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(drawOne(ids, 6).id);
    return { pid: null, name: 'CPU 野良の将', cpu: true, idx: 0, units: shuffle(ids).map(id => makeUnit(id, sk)), items: { power: 1, guard: 1, heal: 2 } };
  };
  const B = {
    id: battleSeq++, room, turn: 1, phase: 'choose', over: false, ev: [], timer: null,
    sides: { a: mkSide(p1, 'a'), b: p2 ? mkSide(p2, 'b') : cpuSide('b') },
    choices: { a: null, b: null }, pending: { a: false, b: false }, swq: []
  };
  room.battles.push(B);
  p1.battle = B;
  if (p2) p2.battle = B;
  const teams = { a: B.sides.a.units.map(u => u.id), b: B.sides.b.units.map(u => u.id) };
  const names = { a: B.sides.a.name, b: B.sides.b.name };
  for (const sk of ['a', 'b']) {
    const s = B.sides[sk];
    if (s.cpu) continue;
    io.to(s.pid).emit('battleStart', { me: sk, names, teams, snap: snapB(B), left: TURN_MS, cpu: !p2 });
  }
  startTurnTimer(B, TURN_MS + 6000);
}

function startTurnTimer(B, ms) {
  clearTimeout(B.timer);
  B.phase = 'choose';
  B.timer = setTimeout(() => turnTimeout(B), ms);
}
function turnTimeout(B) {
  if (B.over || B.phase !== 'choose') return;
  for (const sk of ['a', 'b']) {
    if (B.sides[sk].cpu || B.choices[sk]) continue;
    B.choices[sk] = { move: pick(avail(act(B.sides[sk]))), item: null, auto: true };
  }
  resolveTurnB(B);
}
function humanSides(B) { return ['a', 'b'].filter(sk => !B.sides[sk].cpu); }

function resolveTurnB(B) {
  clearTimeout(B.timer);
  B.phase = 'resolving';
  const A = B.sides.a, Bs = B.sides.b;
  for (const sk of ['a', 'b']) {
    const s = B.sides[sk], o = B.sides[sk === 'a' ? 'b' : 'a'];
    if (s.cpu) B.choices[sk] = { move: cpuChoose(act(s), act(o)), item: cpuItem(s, act(s)) };
  }
  const ca = B.choices.a, cb = B.choices.b;
  const ua = act(A), ub = act(Bs);
  B.ev = [];
  ev(B, { t: 'turn', n: B.turn });
  for (const [sk, c] of [['a', ca], ['b', cb]]) {
    if (c.auto) say(B, `${B.sides[sk].name} は時間切れ！ 技が自動で選ばれた`, 'sys', 400);
  }
  if (ca.item) useItem(B, A, ua, ca.item);
  if (cb.item) useItem(B, Bs, ub, cb.item);
  resolveClash(B, ca.move, cb.move);
  ua.lastSlot = ca.move; ub.lastSlot = cb.move;
  endOfTurn(B);
  ua.flags = {}; ub.flags = {};
  checkFaints(B);
  B.choices = { a: null, b: null };
  ev(B, { t: 'sync' });
  const events = B.ev;
  const needAny = !B.over && humanSides(B).some(sk => B.pending[sk]);
  if (!B.over && !needAny) B.turn++;
  for (const sk of humanSides(B)) {
    io.to(B.sides[sk].pid).emit('turnResult', { events, needSwitch: !!B.pending[sk], left: needAny ? SWITCH_MS : TURN_MS });
  }
  if (B.over) { finishBattle(B); return; }
  if (needAny) {
    B.phase = 'switch';
    B.timer = setTimeout(() => switchTimeout(B), SWITCH_MS + 15000);
  } else {
    startTurnTimer(B, TURN_MS + 15000);
  }
}

function applySwitch(B, sk, idx) {
  const side = B.sides[sk];
  const u = side.units[idx];
  if (!u || u.hp <= 0) idx = side.units.findIndex(x => x.hp > 0);
  side.idx = idx;
  B.pending[sk] = false;
  B.swq.push(sk);
  if (humanSides(B).every(s => !B.pending[s])) {
    clearTimeout(B.timer);
    B.ev = [];
    for (const s of B.swq) ev(B, { t: 'enter', side: s });
    B.swq = [];
    ev(B, { t: 'sync' });
    B.turn++;
    for (const s of humanSides(B)) io.to(B.sides[s].pid).emit('switchResult', { events: B.ev, left: TURN_MS });
    startTurnTimer(B, TURN_MS + 4000);
  }
}
function switchTimeout(B) {
  if (B.over || B.phase !== 'switch') return;
  for (const sk of humanSides(B)) {
    if (B.pending[sk]) applySwitch(B, sk, B.sides[sk].units.findIndex(u => u.hp > 0));
  }
}

function battleForfeit(B, leaverId) {
  if (B.over) return;
  const lk = B.sides.a.pid === leaverId ? 'a' : 'b';
  const wk = lk === 'a' ? 'b' : 'a';
  B.over = true;
  clearTimeout(B.timer);
  B.ev = [];
  say(B, `${B.sides[lk].name} が退出したため、バトル終了！`, 'sys', 600);
  ev(B, { t: 'end', winner: wk, turn: B.turn, reason: 'left' });
  if (!B.sides[wk].cpu) io.to(B.sides[wk].pid).emit('turnResult', { events: B.ev, needSwitch: false, left: 0 });
  finishBattle(B);
}

function finishBattle(B) {
  B.over = true;
  clearTimeout(B.timer);
  checkAllBattles(B.room);
}
function checkAllBattles(room) {
  if (room.phase !== 'battle') return;
  if (room.battles.every(b => b.over)) {
    room.phase = 'lobby';
    for (const p of room.players.values()) p.battle = null;
    broadcastLobby(room);
  }
}

/* =========================================================
   Socket.io
========================================================= */
io.on('connection', socket => {
  socket.data.room = null;
  socket.emit('hello', { chars: CHARS, items: ITEMS, status: STATUS, world: WORLD });

  socket.on('join', (d, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const code = String((d && d.code) || '').trim();
    const name = String((d && d.name) || '').replace(/[<>&"'`]/g, '').trim().slice(0, 10) || 'ななし';
    if (!/^\d{5}$/.test(code)) return reply({ ok: false, msg: 'パスワードは5桁の数字で入力してください' });
    if (socket.data.room) leaveRoom(socket);
    let room = rooms.get(code);
    if (!room) {
      room = { code, players: new Map(), hostId: socket.id, phase: 'lobby', battles: [], obs: [], chests: [], mons: [], balls: [] };
      rooms.set(code, room);
    }
    if (room.phase !== 'lobby') return reply({ ok: false, msg: 'このルームはゲーム進行中です。終了後にもう一度入室してください' });
    if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, msg: `ルームが満員です（最大${MAX_PLAYERS}人）` });
    room.players.set(socket.id, newPlayer(socket, name, room));
    socket.data.room = code;
    socket.join(code);
    reply({ ok: true, you: socket.id });
    broadcastLobby(room);
    socket.to(code).emit('toast', { text: `${name} が入室しました`, cls: 'item' });
  });

  socket.on('leave', () => leaveRoom(socket));

  socket.on('lobbyState', () => {
    const { room } = ctxOf(socket);
    if (room) socket.emit('lobby', lobbyPayload(room));
  });

  socket.on('startGame', () => {
    const { room } = ctxOf(socket);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    startGame(room);
  });

  socket.on('hostEndExplore', () => {
    const { room } = ctxOf(socket);
    if (!room || room.hostId !== socket.id || room.phase !== 'explore') return;
    io.to(room.code).emit('toast', { text: 'ホストが探索を終了しました', cls: 'warn' });
    endExplore(room);
  });

  socket.on('pos', d => {
    const { room, p } = ctxOf(socket);
    if (!room || !p || room.phase !== 'explore' || !d) return;
    p.x = clamp(num(d.x, p.x), 0, WORLD.w);
    p.y = clamp(num(d.y, p.y), 0, WORLD.h);
    const dx = num(d.dx, p.dx), dy = num(d.dy, p.dy), l = Math.hypot(dx, dy);
    if (l > 0.01) { p.dx = dx / l; p.dy = dy / l; }
    p.stun = !!d.s;
  });

  socket.on('sword', d => {
    const { room, p } = ctxOf(socket);
    if (!room || !p || room.phase !== 'explore' || p.stun || !d) return;
    const now = Date.now();
    if (now - p.lastSword < 300) return;
    p.lastSword = now;
    p.sw++;
    p.x = clamp(num(d.x, p.x), 0, WORLD.w);
    p.y = clamp(num(d.y, p.y), 0, WORLD.h);
    let dx = num(d.dx, p.dx), dy = num(d.dy, p.dy);
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    p.dx = dx; p.dy = dy;
    for (const m of room.mons.slice()) {
      if (m.state !== 'w') continue;
      const vx = m.x - p.x, vy = m.y - p.y, dist = Math.hypot(vx, vy) || 1;
      const dot = (vx * dx + vy * dy) / dist;
      if (dist < 84 && (dot > .15 || dist < 34)) hitMon(room, m, p, vx / dist, vy / dist);
    }
  });

  socket.on('throw', d => {
    const { room, p } = ctxOf(socket);
    if (!room || !p || room.phase !== 'explore' || p.stun || !d) return;
    const now = Date.now();
    if (now - p.lastThrow < 380) return;
    if (p.inv.balls <= 0) { toastTo(p.id, 'パチボールがない！ 宝箱を探そう', 'warn'); return; }
    p.lastThrow = now;
    let dx = num(d.dx, p.dx), dy = num(d.dy, p.dy);
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    p.inv.balls--;
    sendInv(p);
    room.balls.push({ x: p.x, y: p.y - 6, vx: dx * 580, vy: dy * 580, dist: 0, owner: p.id });
  });

  socket.on('chest', d => {
    const { room, p } = ctxOf(socket);
    if (!room || !p || room.phase !== 'explore' || !d) return;
    const c = room.chests[num(d.id, -1)];
    if (!c || c.open) return;
    if (Math.hypot(p.x - c.x, p.y - (c.y - 10)) > 120) return;
    c.open = true;
    p.stats.chests++;
    io.to(room.code).emit('chest', { id: c.id });
    fx(room, [{ k: 'burst', x: c.x, y: c.y - 12, col: '#ffd166', n: 20, sp: 180 }]);
    giveRandom(room, p, c.x, c.y, true, c.gold);
    if (c.gold) giveRandom(room, p, c.x, c.y - 18, true, false);
  });

  socket.on('selectTeam', d => {
    const { room, p } = ctxOf(socket);
    if (!room || !p || room.phase !== 'select' || p.selected || !d || !Array.isArray(d.uids)) return;
    const uids = d.uids.slice(0, 3).map(String);
    if (uids.length !== 3 || new Set(uids).size !== 3) return;
    const team = uids.map(u => p.party.find(e => e.uid === u));
    if (team.some(e => !e)) return;
    p.team = team;
    p.selected = true;
    const ps = [...room.players.values()];
    const done = ps.filter(q => q.selected).length;
    io.to(room.code).emit('selectStatus', { done, total: ps.length });
    if (done === ps.length) finishSelect(room);
  });

  socket.on('battleAction', d => {
    const { p } = ctxOf(socket);
    const B = p && p.battle;
    if (!B || B.over || B.phase !== 'choose' || !d) return;
    const sk = B.sides.a.pid === p.id ? 'a' : 'b';
    if (B.choices[sk]) return;
    const u = act(B.sides[sk]);
    const move = Math.floor(num(d.move, -1));
    if (!avail(u).includes(move)) {
      socket.emit('actionRejected', { msg: 'その技は今は使えません（連続使用不可）', snap: snapB(B) });
      return;
    }
    let item = typeof d.item === 'string' && ITEMS[d.item] ? d.item : null;
    if (item && B.sides[sk].items[item] <= 0) item = null;
    B.choices[sk] = { move, item };
    const ok = sk === 'a' ? 'b' : 'a';
    if (!B.sides[ok].cpu) io.to(B.sides[ok].pid).emit('oppReady');
    if (B.sides[ok].cpu || B.choices[ok]) resolveTurnB(B);
  });

  socket.on('battleSwitch', d => {
    const { p } = ctxOf(socket);
    const B = p && p.battle;
    if (!B || B.over || B.phase !== 'switch' || !d) return;
    const sk = B.sides.a.pid === p.id ? 'a' : 'b';
    if (!B.pending[sk]) return;
    applySwitch(B, sk, Math.floor(num(d.idx, -1)));
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => {
  console.log(`パチットモンスター server running on port ${PORT}`);
});
