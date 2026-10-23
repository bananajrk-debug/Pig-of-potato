'use strict';
// =====================================================
//  POLY PIRATES v6  -  オープンワールド航海＆冒険・生活アクション サーバー
//  Node.js + Express + Socket.io
//  ・昼夜サイクル(サーバー時計)  ・船の物理(舵/錨/島や桟橋との衝突)
//  ・セーブデータ永続化(saves.json)  ・ショップ/ガチャ/質屋/釣り/料理/宝の地図/ダンジョン宝箱
// =====================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e5 });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const SAVE_FILE = path.join(__dirname, 'saves.json');
const TICK_MS = 33;
const DAY_SEC = 720;                      // ゲーム内の1日 = 現実の12分
const T0 = Date.now();
const hourNow = () => (7 + ((Date.now() - T0) / 1000) / DAY_SEC * 24) % 24;
const isNight = () => { const h = hourNow(); return h >= 19 || h < 5; };
const SEA_RADIUS = 1000;

// ---------------------------------------------------
//  地形 (index.html と全く同じ式)
// ---------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const noise2 = (x, z) => Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 + 0.7) * 1.1 + Math.sin(x * 0.23 + z * 0.17) * 0.55 + Math.sin(z * 0.31 - x * 0.13) * 0.3;
const ISLETS = [
  { name: 'ドクロ島', x: -420, z: -300, r: 60, p: 14 },
  { name: 'ヤシ島', x: 360, z: -250, r: 42, p: 8 },
  { name: '岩礁島', x: -300, z: 390, r: 48, p: 13 },
  { name: '砂州の島', x: 480, z: 300, r: 34, p: 5 },
  { name: '霧の島', x: 130, z: -540, r: 52, p: 15 },
  { name: 'クジラ湾', x: -540, z: 130, r: 40, p: 9 },
  { name: '月影島', x: 560, z: -20, r: 36, p: 7 }
];
function mainH(x, z) {
  const d = Math.hypot(x, z), a = Math.atan2(z, x);
  const Rm = 108 + Math.sin(a * 3 + 1) * 9 + Math.sin(a * 5 + 2) * 5;
  const land = Rm - d;
  const m = 46 * Math.exp(-((x + 8) ** 2 + (z + 24) ** 2) / 1800) + 26 * Math.exp(-((x - 52) ** 2 + (z + 8) ** 2) / 900) +
    24 * Math.exp(-((x + 56) ** 2 + (z - 4) ** 2) / 800) + 14 * Math.exp(-(x ** 2 + (z + 72) ** 2) / 700);
  let elev = (2.6 + m + noise2(x, z) * 0.9) * sstep(0, 26, land);
  const dx = Math.max(Math.abs(x) - 36, 0), dz = Math.max(Math.max(14 - z, z - 52), 0);
  elev = lerp(elev, 1.6, 1 - sstep(0, 14, Math.hypot(dx, dz)));
  let h = lerp(-5, elev, sstep(-6, 1, land));
  const bay = (1 - sstep(34, 46, Math.abs(x))) * sstep(52, 62, z);
  return lerp(h, -4.5, bay);
}
function isletH(I, x, z) {
  const d = Math.hypot(x - I.x, z - I.z), a = Math.atan2(z - I.z, x - I.x);
  const R = I.r * (1 + 0.12 * Math.sin(a * 4 + I.x) + 0.08 * Math.sin(a * 7));
  const land = R - d;
  const top = I.p * Math.exp(-(d * d) / (2 * (R * 0.45) ** 2)) * (1 + 0.15 * Math.sin(x * 0.2) * Math.cos(z * 0.17));
  return lerp(-5, (1.4 + top) * sstep(0, R * 0.3, land), sstep(-6, 1, land));
}
function heightAt(x, z) {
  let h = -5;
  if (x > -200 && x < 200 && z > -200 && z < 200) h = mainH(x, z);
  for (const I of ISLETS) {
    const dx = x - I.x, dz = z - I.z;
    if (dx * dx + dz * dz < I.r * I.r * 2.6) { const v = isletH(I, x, z); if (v > h) h = v; }
  }
  return h;
}
const DUNGEON_ENTRANCE = { x: -394, z: -272 };

// ---------------------------------------------------
//  船
// ---------------------------------------------------
const TYPES = {
  sloop: { name: 'スループ', cap: 1, max: 12, accel: 3.2, drag: 0.14, turn: 0.9, r: 10, hull: [[6.5, 1.9], [4.5, 2.3], [0.5, 2.5], [-4, 2.2], [-7, 1.3], [-9.6, 0.12]] },
  galleon: { name: '大型帆船', cap: 3, max: 9.5, accel: 2.1, drag: 0.14, turn: 0.52, r: 17, hull: [[12.8, 3.0], [10, 3.5], [5, 3.8], [-3, 3.8], [-9, 3.0], [-13, 1.5], [-16, 0.15]] }
};
for (const k in TYPES) {
  const T = TYPES[k];
  T.samples = [];
  for (const [z, w] of T.hull) T.samples.push([w * 0.92, z], [-w * 0.92, z]);
  T.samples.push([0, T.hull[T.hull.length - 1][0] + 0.3]);
  T.maxhw = Math.max(...T.hull.map((h) => h[1]));
}
// 船が入れない場所（岸壁・桟橋）
const OBS = [
  { x0: -40, x1: 40, z0: 49, z1: 61 },
  { x0: -16, x1: -12, z0: 58, z1: 112 },
  { x0: 12, x1: 16, z0: 58, z1: 112 }
];
const SLOTS = [{ s: -1, z: 78 }, { s: 1, z: 78 }, { s: -1, z: 110 }, { s: 1, z: 110 }, { s: 0, z: 140 }, { s: 0, z: 172 }, { s: 0, z: 204 }];
function shipClear(T, x, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [lx, lz] of T.samples) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    if (heightAt(wx, wz) > -1.1) return false;
    for (const o of OBS) if (wx > o.x0 && wx < o.x1 && wz > o.z0 && wz < o.z1) return false;
  }
  return true;
}

// ---------------------------------------------------
//  アイテム定義
// ---------------------------------------------------
const ITEMS = {
  potato: { n: 'じゃがいも', sell: 8 },
  baked_potato: { n: 'ベイクドポテト', sell: 25, heal: 30 },
  fish_sardine: { n: 'イワシ', sell: 22 }, fish_bass: { n: 'スズキ', sell: 65 }, fish_tuna: { n: 'マグロ', sell: 130 }, fish_gold: { n: '黄金のサカナ', sell: 480 },
  grilled_sardine: { n: '焼きイワシ', sell: 40, heal: 28 }, grilled_bass: { n: '焼きスズキ', sell: 105, heal: 50 },
  grilled_tuna: { n: '焼きマグロ', sell: 210, heal: 80 }, grilled_gold: { n: '焼き黄金魚', sell: 700, heal: 140 },
  coin_old: { n: '古びた金貨', sell: 60 }, gem_pearl: { n: '真珠', sell: 220 }, gem_ruby: { n: 'ルビー', sell: 520 },
  relic: { n: '古代の遺物', sell: 900 }, crown: { n: '海賊王の王冠', sell: 3000 }
};
const COOK = { potato: 'baked_potato', fish_sardine: 'grilled_sardine', fish_bass: 'grilled_bass', fish_tuna: 'grilled_tuna', fish_gold: 'grilled_gold' };
const HATS = { bandana: '青いバンダナ', tricorn: '赤い三角帽', captain: '船長の金帽子', crownskull: 'ドクロの王冠' };
const SHOP = {
  potato: { n: 'じゃがいも', cost: 40 },
  potato10: { n: 'じゃがいも×10（お得）', cost: 360, give: { potato: 10 } },
  rod2: { n: '上質な釣り竿（レア魚が釣れやすい）', cost: 2000, rod: 2 },
  hat_bandana: { n: '青いバンダナ', cost: 500, hat: 'bandana' },
  hat_tricorn: { n: '赤い三角帽', cost: 1200, hat: 'tricorn' }
};
const MAP_NAMES = ['ボロボロの地図', '古びた宝の地図', '海賊王の宝の地図', '伝説の宝の地図'];
const PRIZES = [
  { r: 'N', w: 25, t: 'item', id: 'potato', n: 5 }, { r: 'N', w: 15, t: 'item', id: 'coin_old', n: 2 }, { r: 'N', w: 15, t: 'map', rank: 1 },
  { r: 'R', w: 10, t: 'item', id: 'gem_pearl', n: 1 }, { r: 'R', w: 14, t: 'map', rank: 2 }, { r: 'R', w: 6, t: 'hat', id: 'bandana' },
  { r: 'SR', w: 4, t: 'item', id: 'gem_ruby', n: 1 }, { r: 'SR', w: 6, t: 'map', rank: 3 }, { r: 'SR', w: 2, t: 'hat', id: 'tricorn' },
  { r: 'UR', w: 1, t: 'item', id: 'relic', n: 1 }, { r: 'UR', w: 1.2, t: 'map', rank: 4 }, { r: 'UR', w: 0.5, t: 'hat', id: 'captain' }, { r: 'UR', w: 0.3, t: 'hat', id: 'crownskull' }
];
const GACHA_COST = 400, GACHA_COST10 = 3600, MAP_PRICE = 500;
const DEFS = {
  items: Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, { n: v.n, sell: v.sell, heal: v.heal || 0 }])),
  hats: HATS, shop: SHOP, gachaCost: GACHA_COST, gachaCost10: GACHA_COST10, mapPrice: MAP_PRICE,
  types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, { name: v.name, cap: v.cap }]))
};

// ---------------------------------------------------
//  セーブデータ
// ---------------------------------------------------
let SAVES = {};
try { SAVES = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch (e) { SAVES = {}; }
let dirty = false;
const newSave = () => ({ gold: 800, inv: { potato: 3 }, stash: {}, maps: [], active: null, hats: [], hat: 'none', rod: 1, dcd: 0 });
function flushSaves() {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(SAVE_FILE, JSON.stringify(SAVES), (err) => { if (err) console.error('save error', err.message); });
}
setInterval(flushSaves, 4000);
process.on('SIGINT', () => { try { fs.writeFileSync(SAVE_FILE, JSON.stringify(SAVES)); } catch (e) { /* ignore */ } process.exit(0); });

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const rid = () => Math.random().toString(36).slice(2, 10);
function addInv(inv, id, n) { inv[id] = (inv[id] || 0) + n; if (inv[id] <= 0) delete inv[id]; }

function pickTarget(I) {
  for (let i = 0; i < 80; i++) {
    const a = rand(0, Math.PI * 2), r = I.r * (0.12 + 0.43 * Math.random());
    const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r, h = heightAt(x, z);
    if (h > 1.5 && h < 20) return { x: Math.round(x), z: Math.round(z) };
  }
  return { x: Math.round(I.x), z: Math.round(I.z) };
}
function makeMap(rank) {
  const kind = rank >= 2 && Math.random() < 0.35 ? 'dungeon' : 'dig';
  if (kind === 'dungeon') return { id: rid(), rank, kind, name: MAP_NAMES[rank - 1], isl: 'ドクロ島の洞窟', x: DUNGEON_ENTRANCE.x, z: DUNGEON_ENTRANCE.z };
  const pool = ISLETS.concat([{ name: 'ポートタウンの山', x: 0, z: -35, r: 120 }]);
  const I = pool[Math.floor(Math.random() * pool.length)];
  const t = pickTarget(I);
  return { id: rid(), rank, kind, name: MAP_NAMES[rank - 1], isl: I.name, x: t.x, z: t.z };
}
function giveMap(sv, m) { if (sv.maps.length >= 12) sv.maps.shift(); sv.maps.push(m); }
function treasure(sv, rank) {
  const out = [];
  const gold = Math.round(rank * 300 + rand(0, rank * 250));
  sv.gold += gold; out.push(gold + 'G');
  const give = (id, n) => { addInv(sv.inv, id, n); out.push(ITEMS[id].n + '×' + n); };
  if (Math.random() < 0.5) give('gem_pearl', 1);
  if (rank >= 2 && Math.random() < 0.4) give('gem_ruby', 1);
  if (rank >= 3 && Math.random() < 0.5) give('relic', 1);
  if (rank >= 4 && Math.random() < 0.35) give('crown', 1);
  return out.join(' / ');
}

// ---------------------------------------------------
//  プレイヤー / 船
// ---------------------------------------------------
const PL = {};      // socket.id -> player
const SHIPS = {};   // id -> ship
let shipSeq = 1;

function shipOccupied(id) { return Object.values(PL).some((p) => p.st && p.st.s === id); }
function spawnShip(p, type) {
  const T = TYPES[type];
  if (!T) return 'その船は存在しません';
  const mine = Object.values(SHIPS).find((s) => s.owner === p.id);
  if (mine) {
    if (shipOccupied(mine.i)) return 'あなたの船は誰かが乗っています';
    delete SHIPS[mine.i];
  }
  for (const slot of SLOTS) {
    const x = slot.s === 0 ? 0 : slot.s * (12 - T.maxhw - 0.3), z = slot.z;
    const ok = Object.values(SHIPS).every((s) => Math.hypot(s.x - x, s.z - z) > TYPES[s.t].r + T.r - 4);
    if (ok) {
      const s = { i: shipSeq++, t: type, x, z, r: Math.PI, sp: 0, an: true, hm: 0, owner: p.id, o: p.name, in: { thr: 0, turn: 0 }, tn: 0 };
      SHIPS[s.i] = s;
      return null;
    }
  }
  return '港が混雑しています。しばらくしてからもう一度どうぞ';
}
function stepShip(s, dt) {
  const T = TYPES[s.t];
  if (s.an) {
    s.sp *= Math.pow(0.02, dt);
    if (Math.abs(s.sp) < 0.05) s.sp = 0;
    s.tn = 0;
  } else {
    if (s.hm) s.sp += s.in.thr * T.accel * dt;
    s.sp -= s.sp * T.drag * dt;
    s.sp = clamp(s.sp, -T.max * 0.35, T.max);
    const auth = clamp(Math.abs(s.sp) / 3, 0, 1);
    const turn = s.hm ? s.in.turn : 0;
    const nr = s.r + turn * T.turn * auth * (s.sp >= 0 ? 1 : -1) * dt;
    if (shipClear(T, s.x, s.z, nr)) s.r = nr;
    s.tn = turn;
  }
  if (s.sp !== 0) {
    const nx = s.x - Math.sin(s.r) * s.sp * dt, nz = s.z - Math.cos(s.r) * s.sp * dt;
    if (shipClear(T, nx, nz, s.r)) { s.x = nx; s.z = nz; }
    else s.sp *= -0.25;
  }
  const d = Math.hypot(s.x, s.z);
  if (d > SEA_RADIUS) { s.x *= SEA_RADIUS / d; s.z *= SEA_RADIUS / d; s.sp *= 0.5; }
}
let tick = 0;
setInterval(() => {
  const dt = TICK_MS / 1000;
  const now = Date.now();
  for (const id in SHIPS) {
    const s = SHIPS[id];
    stepShip(s, dt);
    // 持ち主が去って無人になった船は片付ける
    if (!PL[s.owner] && !shipOccupied(s.i)) { s.gone = s.gone || now; if (now - s.gone > 30000) delete SHIPS[id]; } else s.gone = 0;
  }
  tick++;
  if (tick % 2 === 0) {
    const players = [];
    for (const id in PL) {
      const p = PL[id];
      if (!p.st) continue;
      const q = p.st;
      players.push({ i: id, n: p.name, x: q.x, y: q.y, z: q.z, r: q.r, s: q.s, lx: q.lx, ly: q.ly, lz: q.lz, t: q.t, w: q.w, m: q.m, a: q.a, h: p.save.hat });
    }
    const ships = Object.values(SHIPS).map((s) => ({ i: s.i, t: s.t, x: s.x, z: s.z, r: s.r, sp: s.sp, an: s.an ? 1 : 0, hm: s.hm ? 1 : 0, o: s.o, tn: s.tn }));
    io.emit('snap', { h: hourNow(), ships, players });
  }
}, TICK_MS);

// ---------------------------------------------------
//  通信
// ---------------------------------------------------
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
function push(p) { p.socket.emit('save', p.save); dirty = true; }
function msg(p, t) { p.socket.emit('msg', t); }

io.on('connection', (socket) => {
  socket.on('join', (m) => {
    if (PL[socket.id]) return;
    m = m || {};
    let key = String(m.key || '').replace(/[^\w-]/g, '').slice(0, 64);
    if (key.length < 8) key = rid() + rid();
    const name = String(m.name || '').replace(/[<>&"']/g, '').slice(0, 12) || '名無しの海賊';
    if (!SAVES[key]) SAVES[key] = newSave();
    const sv = Object.assign(newSave(), SAVES[key]);
    SAVES[key] = sv;
    const p = { id: socket.id, socket, key, name, save: sv, st: null, lastFish: 0, lastLoot: 0 };
    PL[socket.id] = p;
    dirty = true;
    socket.emit('init', {
      id: socket.id, key, save: sv, defs: DEFS, dayLen: DAY_SEC, hour: hourNow(),
      ships: Object.values(SHIPS).map((s) => ({ i: s.i, t: s.t, x: s.x, z: s.z, r: s.r, sp: s.sp, an: s.an ? 1 : 0, hm: s.hm ? 1 : 0, o: s.o, tn: s.tn }))
    });
  });

  socket.on('pl', (m) => {
    const p = PL[socket.id];
    if (!p || !m) return;
    p.st = {
      x: num(m.x, 0), y: num(m.y, 0), z: num(m.z, 0), r: num(m.r, 0), s: m.s | 0,
      lx: num(m.lx, 0), ly: num(m.ly, 0), lz: num(m.lz, 0), t: m.t | 0, w: m.w ? 1 : 0, m: m.m ? 1 : 0, a: m.a ? 1 : 0
    };
  });

  socket.on('helm', (m) => {
    const p = PL[socket.id]; if (!p || !m) return;
    const s = SHIPS[m.sid]; if (!s) return;
    if (m.on) {
      if (!p.st || p.st.s !== s.i) return;
      if (s.hm && s.hm !== socket.id && PL[s.hm]) return msg(p, '他の船員が舵をとっています');
      s.hm = socket.id; s.in = { thr: 0, turn: 0 };
    } else if (s.hm === socket.id) { s.hm = 0; s.in = { thr: 0, turn: 0 }; }
  });
  socket.on('steer', (m) => {
    const s = m && SHIPS[m.sid];
    if (!s || s.hm !== socket.id) return;
    s.in = { thr: clamp(num(m.thr, 0), -1, 1), turn: clamp(num(m.turn, 0), -1, 1) };
  });
  socket.on('anchor', (m) => {
    const p = PL[socket.id]; const s = m && SHIPS[m.sid];
    if (!p || !s || !p.st || p.st.s !== s.i) return;
    if (!s.an && Math.abs(s.sp) > 4) return msg(p, '船が速すぎて錨を下ろせません！減速しよう');
    s.an = !s.an;
    msg(p, s.an ? '⚓ 錨を下ろした' : '⚓ 錨を上げた');
  });

  socket.on('act', (m) => {
    const p = PL[socket.id];
    if (!p || !m || typeof m.a !== 'string') return;
    const sv = p.save;
    const n = clamp(parseInt(m.n, 10) || 1, 1, 999);
    const id = String(m.id || '');
    switch (m.a) {
      case 'call': {
        const err = spawnShip(p, id);
        msg(p, err || (TYPES[id].name + 'を桟橋に用意しました！'));
        return;
      }
      case 'buy': {
        const s = SHOP[id]; if (!s) return;
        const q = id === 'potato' ? n : 1;
        const cost = s.cost * q;
        if (sv.gold < cost) return msg(p, 'お金が足りません');
        if (s.rod && sv.rod >= s.rod) return msg(p, 'すでに持っています');
        if (s.hat && sv.hats.includes(s.hat)) return msg(p, 'すでに持っています');
        sv.gold -= cost;
        if (s.rod) sv.rod = s.rod;
        else if (s.hat) { sv.hats.push(s.hat); sv.hat = s.hat; }
        else if (s.give) for (const k in s.give) addInv(sv.inv, k, s.give[k]);
        else addInv(sv.inv, id, q);
        msg(p, s.n + 'を買った（-' + cost + 'G）');
        return push(p);
      }
      case 'sell': {
        const it = ITEMS[id]; const have = sv.inv[id] || 0;
        if (!it || have <= 0) return;
        const q = m.all ? have : Math.min(n, have);
        const gain = q * it.sell;
        addInv(sv.inv, id, -q); sv.gold += gain;
        msg(p, it.n + '×' + q + ' を売った（+' + gain + 'G）');
        return push(p);
      }
      case 'mapbuy': {
        if (sv.gold < MAP_PRICE) return msg(p, 'お金が足りません');
        sv.gold -= MAP_PRICE;
        const mp = makeMap(1); giveMap(sv, mp);
        msg(p, '質屋から「' + mp.name + '」を買った！');
        return push(p);
      }
      case 'gacha': {
        const times = m.n === 10 ? 10 : 1;
        const cost = times === 10 ? GACHA_COST10 : GACHA_COST;
        if (sv.gold < cost) return msg(p, 'お金が足りません');
        sv.gold -= cost;
        const res = [];
        for (let i = 0; i < times; i++) {
          let r = Math.random() * 100, pr = PRIZES[0];
          for (const c of PRIZES) { r -= c.w; if (r <= 0) { pr = c; break; } }
          let label = '';
          if (pr.t === 'item') { addInv(sv.inv, pr.id, pr.n); label = ITEMS[pr.id].n + '×' + pr.n; }
          else if (pr.t === 'map') { const mp = makeMap(pr.rank); giveMap(sv, mp); label = '🗺 ' + mp.name + '（' + mp.isl + '）'; }
          else if (pr.t === 'hat') {
            if (sv.hats.includes(pr.id)) { sv.gold += 300; label = HATS[pr.id] + '（持っていたので300G）'; }
            else { sv.hats.push(pr.id); label = '🎩 ' + HATS[pr.id]; }
          }
          res.push({ r: pr.r, t: label });
        }
        socket.emit('gachaRes', res);
        return push(p);
      }
      case 'cook': {
        const out = COOK[id]; const have = sv.inv[id] || 0;
        if (!out || have <= 0) return;
        const q = m.all ? have : 1;
        addInv(sv.inv, id, -q); addInv(sv.inv, out, q);
        msg(p, '🔥 ' + ITEMS[out].n + '×' + q + ' が焼けた！');
        return push(p);
      }
      case 'eat': {
        const it = ITEMS[id];
        if (!it || !it.heal || !(sv.inv[id] > 0)) return;
        addInv(sv.inv, id, -1);
        socket.emit('heal', { amt: it.heal, n: it.n });
        return push(p);
      }
      case 'setmap': {
        if (sv.maps.some((x) => x.id === id)) { sv.active = sv.active === id ? null : id; push(p); }
        return;
      }
      case 'hat': {
        if (id === 'none' || sv.hats.includes(id)) { sv.hat = id; push(p); }
        return;
      }
      case 'store': case 'take': {
        const from = m.a === 'store' ? sv.inv : sv.stash, to = m.a === 'store' ? sv.stash : sv.inv;
        const have = from[id] || 0;
        if (!ITEMS[id] || have <= 0) return;
        const q = m.all ? have : Math.min(n, have);
        addInv(from, id, -q); addInv(to, id, q);
        return push(p);
      }
      case 'fish': {
        const now = Date.now();
        if (now - p.lastFish < 2500) return;
        p.lastFish = now;
        const w = sv.rod >= 2 ? [40, 33, 20, 7] : [55, 30, 12, 3];
        if (isNight()) { w[3] *= 2; w[2] *= 1.3; }
        const ids = ['fish_sardine', 'fish_bass', 'fish_tuna', 'fish_gold'];
        let r = Math.random() * w.reduce((a, b) => a + b, 0), pick = ids[0];
        for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) { pick = ids[i]; break; } }
        addInv(sv.inv, pick, 1);
        socket.emit('catch', { id: pick });
        return push(p);
      }
      case 'dig': {
        const mp = sv.maps.find((x) => x.id === sv.active);
        if (!mp || mp.kind !== 'dig' || !p.st) return msg(p, '掘る場所ではないようだ');
        if (Math.hypot(p.st.x - mp.x, p.st.z - mp.z) > 10) return msg(p, '地図の印の場所から離れすぎている');
        sv.maps = sv.maps.filter((x) => x.id !== mp.id); sv.active = null;
        msg(p, '💰 宝を掘り当てた！ ' + treasure(sv, mp.rank));
        return push(p);
      }
      case 'dchest': {
        const now = Date.now();
        if (!p.st || p.st.x < 2000) return;
        if (now < sv.dcd) return msg(p, '宝箱は空っぽだ…（しばらくしてからまた来よう）');
        sv.dcd = now + 240000;
        let txt = treasure(sv, 1 + Math.floor(Math.random() * 2));
        const mp = sv.maps.find((x) => x.id === sv.active);
        if (mp && mp.kind === 'dungeon') {
          sv.maps = sv.maps.filter((x) => x.id !== mp.id); sv.active = null;
          txt += ' ＋ 地図の大宝: ' + treasure(sv, mp.rank + 1);
        }
        msg(p, '🗝 宝箱を開けた！ ' + txt);
        return push(p);
      }
      case 'loot': {
        const now = Date.now();
        if (now - p.lastLoot < 300) return;
        p.lastLoot = now;
        if (Math.random() < 0.3) { addInv(sv.inv, 'coin_old', 1); msg(p, '古びた金貨を拾った'); }
        else { const g = randInt(15, 40); sv.gold += g; msg(p, '+' + g + 'G'); }
        return push(p);
      }
      case 'died': {
        const lost = Math.floor(sv.gold * 0.1);
        sv.gold -= lost;
        msg(p, '気を失い、港で目を覚ました…（' + lost + 'G を失った）');
        return push(p);
      }
    }
  });

  socket.on('disconnect', () => {
    for (const id in SHIPS) if (SHIPS[id].hm === socket.id) { SHIPS[id].hm = 0; SHIPS[id].in = { thr: 0, turn: 0 }; }
    delete PL[socket.id];
    flushSaves();
  });
});

server.listen(PORT, () => console.log('POLY PIRATES v6  http://localhost:' + PORT));
