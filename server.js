'use strict';
// =====================================================
//  Pig of potato  -  ブタ海賊のオープンワールド航海 サーバー (v7)
//  Node.js + Express + Socket.io
//  ・ジャガイモの収穫/船上栽培/ジャガイモ砲弾  ・風と帆 / 昼夜 / 嵐
//  ・船の穴と浸水(修理・水汲み)  ・AI敵海賊船(PvE)  ・クラーケン海域
//  ・ロビー & チーム協力  ・セーブデータ永続化(saves.json)
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
const SEA_RADIUS = 1800;
const DECKY = 1.8;

// ---------------------------------------------------
//  地形 (index.html と全く同じ式)  ※山は低くなだらかに
// ---------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const noise2 = (x, z) => Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 + 0.7) * 1.1 + Math.sin(x * 0.23 + z * 0.17) * 0.55 + Math.sin(z * 0.31 - x * 0.13) * 0.3;
const ISLETS = [
  { name: 'ドクロ島', x: -820, z: -560, r: 60, p: 8 },
  { name: 'ヤシ島', x: 700, z: -480, r: 46, p: 5 },
  { name: '岩礁島', x: -600, z: 760, r: 50, p: 8 },
  { name: '砂州の島', x: 940, z: 560, r: 38, p: 3 },
  { name: '霧の島', x: 260, z: -1050, r: 54, p: 9 },
  { name: 'クジラ湾', x: -1100, z: 260, r: 44, p: 6 },
  { name: '月影島', x: 1130, z: -60, r: 40, p: 4 },
  { name: 'ジャガ島', x: -150, z: 1180, r: 52, p: 5 }
];
function mainH(x, z) {
  const d = Math.hypot(x, z), a = Math.atan2(z, x);
  const Rm = 108 + Math.sin(a * 3 + 1) * 9 + Math.sin(a * 5 + 2) * 5;
  const land = Rm - d;
  const m = 24 * Math.exp(-((x + 8) ** 2 + (z + 24) ** 2) / 2600) + 14 * Math.exp(-((x - 52) ** 2 + (z + 8) ** 2) / 1500) +
    13 * Math.exp(-((x + 56) ** 2 + (z - 4) ** 2) / 1400) + 8 * Math.exp(-(x ** 2 + (z + 72) ** 2) / 1100);
  let elev = (2.6 + m + noise2(x, z) * 0.7) * sstep(0, 34, land);
  const dx = Math.max(Math.abs(x) - 36, 0), dz = Math.max(Math.max(14 - z, z - 52), 0);
  elev = lerp(elev, 1.6, 1 - sstep(0, 14, Math.hypot(dx, dz)));
  const h = lerp(-5, elev, sstep(-6, 1, land));
  const bay = (1 - sstep(34, 46, Math.abs(x))) * sstep(52, 62, z);
  return lerp(h, -4.5, bay);
}
function isletH(I, x, z) {
  const d = Math.hypot(x - I.x, z - I.z), a = Math.atan2(z - I.z, x - I.x);
  const R = I.r * (1 + 0.12 * Math.sin(a * 4 + I.x) + 0.08 * Math.sin(a * 7));
  const land = R - d;
  const top = I.p * Math.exp(-(d * d) / (2 * (R * 0.5) ** 2)) * (1 + 0.15 * Math.sin(x * 0.2) * Math.cos(z * 0.17));
  return lerp(-5, (1.4 + top) * sstep(0, R * 0.4, land), sstep(-6, 1, land));
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
const DUNGEON_ENTRANCE = { x: ISLETS[0].x + 26, z: ISLETS[0].z + 28 };
// クラーケンが出る危険海域
const KZONES = [{ name: '嵐の渦潮', x: -1150, z: -1000, r: 260 }, { name: '大渦の海', x: 1050, z: 1150, r: 240 }];

// ---------------------------------------------------
//  ジャガイモ畑（遠くの島に点在。クライアントと同じ式で配置）
// ---------------------------------------------------
const FIELDS = [];
{
  let seed = 7771;
  const rr = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  ISLETS.forEach((I, ii) => {
    const want = ii === 7 ? 5 : 3;
    let got = 0;
    for (let k = 0; k < 400 && got < want; k++) {
      const a = rr() * Math.PI * 2, r = I.r * (0.2 + rr() * 0.4);
      const x = Math.round(I.x + Math.cos(a) * r), z = Math.round(I.z + Math.sin(a) * r), h = heightAt(x, z);
      if (h < 1.5 || h > 7) continue;
      if (Math.hypot(x - DUNGEON_ENTRANCE.x, z - DUNGEON_ENTRANCE.z) < 22) continue;
      if (FIELDS.some((f) => Math.hypot(f.x - x, f.z - z) < 20)) continue;
      FIELDS.push({ id: FIELDS.length, x, z, isl: I.name, ready: 0 });
      got++;
    }
  });
}
const FIELD_REGROW = 90000;

// ---------------------------------------------------
//  船
// ---------------------------------------------------
const TYPES = {
  sloop: { name: 'スループ', cap: 1, max: 12, accel: 3.2, drag: 0.14, turn: 0.9, r: 10, cz: [-3.4], crops: 2, hull: [[6.5, 1.9], [4.5, 2.3], [0.5, 2.5], [-4, 2.2], [-7, 1.3], [-9.6, 0.12]] },
  galleon: { name: '大型帆船', cap: 3, max: 9.5, accel: 2.1, drag: 0.14, turn: 0.52, r: 17, cz: [-3, -8], crops: 4, hull: [[12.8, 3.0], [10, 3.5], [5, 3.8], [-3, 3.8], [-9, 3.0], [-13, 1.5], [-16, 0.15]] }
};
function hwAt(T, z) {
  const H = T.hull;
  if (z > H[0][0] || z < H[H.length - 1][0]) return 0;
  for (let i = 0; i < H.length - 1; i++) {
    const a = H[i], b = H[i + 1];
    if (z <= a[0] && z >= b[0]) return a[1] + (b[1] - a[1]) * ((a[0] - z) / (a[0] - b[0]));
  }
  return 0;
}
for (const k in TYPES) {
  const T = TYPES[k];
  T.samples = [];
  for (const [z, w] of T.hull) T.samples.push([w * 0.92, z], [-w * 0.92, z]);
  T.samples.push([0, T.hull[T.hull.length - 1][0] + 0.3]);
  T.maxhw = Math.max(...T.hull.map((h) => h[1]));
  T.stern = T.hull[0][0]; T.bow = T.hull[T.hull.length - 1][0];
  // 左右の大砲（スループ=左右1門ずつ / 大型帆船=左右2門ずつ）。順番: 左(-1)→右(+1)
  T.cannons = [];
  for (const side of [-1, 1]) for (const z of T.cz) T.cannons.push({ side, z });
}
const OBS = [
  { x0: -40, x1: 40, z0: 49, z1: 61 },
  { x0: -16, x1: -12, z0: 58, z1: 112 },
  { x0: 12, x1: 16, z0: 58, z1: 112 }
];
const SLOTS = [{ s: -1, z: 78 }, { s: 1, z: 78 }, { s: -1, z: 110 }, { s: 1, z: 110 }, { s: 0, z: 140 }, { s: 0, z: 172 }, { s: 0, z: 204 }];
function shipClear(T, x, z, rot, ignoreObs) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [lx, lz] of T.samples) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    if (heightAt(wx, wz) > -1.1) return false;
    if (!ignoreObs) for (const o of OBS) if (wx > o.x0 && wx < o.x1 && wz > o.z0 && wz < o.z1) return false;
  }
  return true;
}
const toLocal = (s, wx, wz) => { const c = Math.cos(s.r), sn = Math.sin(s.r), dx = wx - s.x, dz = wz - s.z; return { x: dx * c - dz * sn, z: dx * sn + dz * c }; };
const toWorld = (s, lx, lz) => { const c = Math.cos(s.r), sn = Math.sin(s.r); return { x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c }; };

// ---------------------------------------------------
//  アイテム定義
// ---------------------------------------------------
const ITEMS = {
  potato: { n: 'じゃがいも', sell: 8 },
  baked_potato: { n: 'ベイクドポテト', sell: 25, heal: 30 },
  plank: { n: '修理用の板', sell: 15 },
  fish_sardine: { n: 'イワシ', sell: 22 }, fish_bass: { n: 'スズキ', sell: 65 }, fish_tuna: { n: 'マグロ', sell: 130 }, fish_gold: { n: '黄金のサカナ', sell: 480 },
  grilled_sardine: { n: '焼きイワシ', sell: 40, heal: 28 }, grilled_bass: { n: '焼きスズキ', sell: 105, heal: 50 },
  grilled_tuna: { n: '焼きマグロ', sell: 210, heal: 80 }, grilled_gold: { n: '焼き黄金魚', sell: 700, heal: 140 },
  coin_old: { n: '古びた金貨', sell: 60 }, gem_pearl: { n: '真珠', sell: 220 }, gem_ruby: { n: 'ルビー', sell: 520 },
  relic: { n: '古代の遺物', sell: 900 }, crown: { n: '海賊王の王冠', sell: 3000 }
};
const COOK = { potato: 'baked_potato', fish_sardine: 'grilled_sardine', fish_bass: 'grilled_bass', fish_tuna: 'grilled_tuna', fish_gold: 'grilled_gold' };
const HATS = { bandana: '青いバンダナ', tricorn: '赤い三角帽', captain: '船長の金帽子', crownskull: 'ドクロの王冠' };
const SHOP = {
  potato: { n: 'じゃがいも（砲弾・栽培の種イモ）', cost: 40 },
  potato10: { n: 'じゃがいも×10（お得）', cost: 360, give: { potato: 10 } },
  plank: { n: '修理用の板（船の穴ふさぎ）', cost: 60, give: { plank: 1 } },
  plank5: { n: '修理用の板×5（お得）', cost: 250, give: { plank: 5 } },
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
  types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, { name: v.name, cap: v.cap }])),
  fields: FIELDS.map((f) => ({ id: f.id, x: f.x, z: f.z, isl: f.isl })), kzones: KZONES, teamCap: 3
};

// ---------------------------------------------------
//  セーブデータ
// ---------------------------------------------------
let SAVES = {};
try { SAVES = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch (e) { SAVES = {}; }
let dirty = false;
const newSave = () => ({ gold: 800, inv: { potato: 4, plank: 2 }, stash: {}, maps: [], active: null, hats: [], hat: 'none', rod: 1, dcd: 0, v7: 1 });
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
const r2 = (n) => Math.round(n * 100) / 100;
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
//  風・天候
// ---------------------------------------------------
const wind = { dir: rand(0, Math.PI * 2), spd: 1.0, tdir: 0, tspd: 1.0 };
wind.tdir = wind.dir;
let storm = 0, stormTarget = 0, stormNext = Date.now() + rand(150, 300) * 1000, stormEnd = 0;
function stepWeather(dt, now) {
  wind.dir += angd(wind.tdir, wind.dir) * Math.min(1, dt * 0.08);
  wind.spd += (wind.tspd - wind.spd) * Math.min(1, dt * 0.1);
  if (Math.random() < dt / 25) { wind.tdir = wind.dir + rand(-0.9, 0.9); wind.tspd = rand(0.75, 1.25); }
  if (stormTarget === 0 && now >= stormNext) { stormTarget = 1; stormEnd = now + rand(80, 150) * 1000; io.emit('msg', '⛈ 嵐が近づいている！ 波が高くなり、風が強まる…'); }
  if (stormTarget === 1 && now >= stormEnd) { stormTarget = 0; stormNext = now + rand(240, 480) * 1000; io.emit('msg', '🌤 嵐が過ぎ去った'); }
  storm += clamp(stormTarget - storm, -dt / 14, dt / 14);
}
function windEff(s) {
  const rel = angd(wind.dir, s.r);
  const push = 0.5 + 0.5 * Math.cos(rel);
  const ideal = clamp(rel / 1.4, -1, 1);
  const e = clamp(1 - 0.65 * Math.abs((s.in.sa || 0) - ideal), 0.25, 1);
  return (0.28 + 0.72 * Math.pow(push, 0.8) * e) * wind.spd * (1 + 0.3 * storm);
}

// ---------------------------------------------------
//  プレイヤー / 船
// ---------------------------------------------------
const PL = {};      // socket.id -> player
const SHIPS = {};   // id -> ship (プレイヤーの船)
const EN = {};      // id -> AI 敵海賊船
const TEAMS = {};   // id -> team
let shipSeq = 1, enSeq = 1, ballSeq = 1, teamSeq = 1;
let BALLS = [];

function shipOccupied(id) { return Object.values(PL).some((p) => p.st && p.st.s === id); }
const crewOf = (sid) => Object.values(PL).filter((p) => p.st && p.st.s === sid);
function newShipState(type) {
  const T = TYPES[type];
  return { water: 0, holes: [], dr: 0, crops: Array.from({ length: T.crops }, () => -1), cn: T.cannons.map(() => ({ ya: 0, pi: 0.12, cd: 0, op: 0 })), in: { thr: 0, turn: 0, sa: 0 }, sunk: 0 };
}
function spawnShip(p, type) {
  const T = TYPES[type];
  if (!T) return 'その船は存在しません';
  const mine = Object.values(SHIPS).find((s) => s.owner === p.id);
  if (mine) {
    if (shipOccupied(mine.i)) return 'あなたの船は誰かが乗っています';
    delete SHIPS[mine.i];
  }
  for (const slot of SLOTS) {
    const x = slot.s === 0 ? 0 : slot.s * (12 - T.maxhw), z = slot.z;   // 船体の最も太い所が桟橋の縁にぴったり接する位置
    const ok = Object.values(SHIPS).every((s) => Math.hypot(s.x - x, s.z - z) > TYPES[s.t].r + T.r - 4);
    if (ok) {
      const s = Object.assign({ i: shipSeq++, t: type, x, z, r: Math.PI, sp: 0, an: true, hm: 0, owner: p.id, o: p.name, tn: 0, tm: p.team || 0 }, newShipState(type));
      SHIPS[s.i] = s;
      return null;
    }
  }
  return '港が混雑しています。しばらくしてからもう一度どうぞ';
}
function stepShip(s, dt) {
  const T = TYPES[s.t];
  if (s.sunk) { s.sp *= Math.pow(0.1, dt); return; }
  if (s.an) {
    s.sp *= Math.pow(0.02, dt);
    if (Math.abs(s.sp) < 0.05) s.sp = 0;
    s.tn = 0;
  } else {
    const eff = clamp(windEff(s), 0.18, 1.45);
    const maxv = T.max * eff;
    const thr = s.hm ? s.in.thr : 0;
    const target = thr >= 0 ? thr * maxv : thr * T.max * 0.3;
    const acc = (target > s.sp ? T.accel : T.accel * 1.2) * (0.5 + 0.5 * Math.min(1, eff));
    s.sp += clamp(target - s.sp, -acc * dt, acc * dt);
    if (!s.hm || thr === 0) s.sp -= s.sp * T.drag * dt;
    s.sp = clamp(s.sp, -T.max * 0.35, T.max * 1.45);
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

// ---- 穴・浸水 ----
function hurtCrew(sid, n, near) {
  crewOf(sid).forEach((p) => {
    if (near && Math.hypot(p.st.x - near.x, p.st.z - near.z) > 7) return;
    PL[p.id].socket.emit('hurt', { n });
  });
}
function damageShip(s, wx, wz, wy) {
  if (s.sunk) return;
  const T = TYPES[s.t], l = toLocal(s, wx, wz);
  s.water = Math.min(100, s.water + 3);
  if (s.holes.length < 6 && Math.random() < 0.8) {
    s.holes.push({ s: l.x >= 0 ? 1 : -1, z: Math.round(clamp(l.z, T.bow + 3, T.stern - 3) * 10) / 10 });
  }
  io.emit('fx', { k: 'hit', x: r2(wx), y: r2(wy), z: r2(wz) });
  hurtCrew(s.i, 18, { x: wx, z: wz });
}
function sinkShip(s, now) {
  if (s.sunk) return;
  s.sunk = now; s.hm = 0;
  io.emit('fx', { k: 'sink', x: r2(s.x), z: r2(s.z) });
  crewOf(s.i).forEach((p) => PL[p.id].socket.emit('msg', '🌊 船が沈んだ！ 泳いで近くの島を目指そう（船の積み荷は失われた）'));
}

// ---- 砲弾 ----
const BALL_V = 52, BALL_G = 14;
function fireBall(from, own, sid, x, y, z, dx, dy, dz, vship) {
  BALLS.push({ id: ballSeq++, from, own, sid, x, y, z, vx: dx * BALL_V + (vship ? vship.x : 0), vy: dy * BALL_V, vz: dz * BALL_V + (vship ? vship.z : 0), life: 9 });
}
function muzzle(s, c) {
  const T = TYPES[s.t], lx = c.side * (hwAt(T, c.z) + 0.55);
  return toWorld(s, lx, c.z);
}
function cannonDirWorld(s, c, st) {
  const hx = c.side * Math.cos(st.ya), hz = -Math.sin(st.ya), cp = Math.cos(st.pi);
  const dl = { x: hx * cp, y: Math.sin(st.pi), z: hz * cp };
  const cs = Math.cos(s.r), sn = Math.sin(s.r);
  return { x: dl.x * cs + dl.z * sn, y: dl.y, z: -dl.x * sn + dl.z * cs };
}
function insideShip(s, x, y, z) {
  const T = TYPES[s.t], l = toLocal(s, x, z);
  return l.z < T.stern + 0.6 && l.z > T.bow - 0.6 && Math.abs(l.x) < hwAt(T, l.z) + 0.9 && y > -1.6 && y < 7;
}
function credit(ownId, text, rank, share) {
  const p = PL[ownId];
  if (!p) return;
  const sid = p.st ? p.st.s : 0;
  const crew = sid ? crewOf(sid) : [p];
  crew.forEach((q) => {
    const pl = PL[q.id]; if (!pl) return;
    const txt = treasure(pl.save, rank);
    pl.socket.emit('msg', text + ' 戦利品: ' + txt);
    push(pl);
  });
}
function stepBalls(dt, now) {
  const keep = [];
  for (const b of BALLS) {
    b.vy -= BALL_G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
    let hit = false;
    const gh = heightAt(b.x, b.z);
    if (b.y < Math.max(gh, 0.1) && b.life < 8.9) {
      io.emit('fx', { k: gh > -0.3 ? 'pop' : 'splash', x: r2(b.x), y: r2(Math.max(gh, 0)), z: r2(b.z), f: b.from });
      hit = true;
    }
    if (!hit && b.from !== 'e') {
      for (const id in EN) {
        const e = EN[id]; if (e.dead) continue;
        if (insideShip(e, b.x, b.y, b.z)) {
          e.hp -= 32; e.last = b.own; hit = true;
          io.emit('fx', { k: 'pop', x: r2(b.x), y: r2(b.y), z: r2(b.z), f: 'p', big: 1 });
          if (e.hp <= 0) killEnemy(e, now);
          break;
        }
      }
      if (!hit) for (const t of tentacles) {
        if (t.hp <= 0) continue;
        if (Math.hypot(b.x - t.x, b.z - t.z) < 5 && b.y < 9) {
          t.hp -= 40; t.last = b.own; hit = true;
          io.emit('fx', { k: 'pop', x: r2(b.x), y: r2(b.y), z: r2(b.z), f: 'p', big: 1 });
          break;
        }
      }
    }
    if (!hit && b.from === 'e') {
      for (const id in SHIPS) {
        const s = SHIPS[id]; if (s.sunk) continue;
        if (insideShip(s, b.x, b.y, b.z)) { damageShip(s, b.x, b.z, b.y); hit = true; break; }
      }
    }
    if (!hit && b.life > 0) keep.push(b);
  }
  BALLS = keep;
}

// ---- AI 敵海賊船 ----
function killEnemy(e, now) {
  e.dead = true; e.respawn = now + 150000; e.sp = 0;
  io.emit('fx', { k: 'sink', x: r2(e.x), z: r2(e.z) });
  credit(e.last, '🏴‍☠️ 敵の海賊船を沈めた！', 2);
}
function spawnEnemy(id) {
  for (let i = 0; i < 80; i++) {
    const a = rand(0, Math.PI * 2), d = rand(450, 1500);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, r = rand(0, 6.28);
    if (!shipClear(TYPES.galleon, x, z, r, true)) continue;
    if (KZONES.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
    const e = { i: id, t: 'galleon', x, z, r, sp: 0, hp: 260, mhp: 260, an: false, hm: 1, in: { thr: 0.8, turn: 0, sa: 0 }, tn: 0, wp: { x, z }, wpAt: 0, cd: [0, 0], dead: false, respawn: 0, last: 0, sunk: 0 };
    EN[id] = e; return e;
  }
  return null;
}
for (let i = 0; i < 3; i++) spawnEnemy('e' + (enSeq++));
function stepEnemy(e, dt, now) {
  if (e.dead) { if (now >= e.respawn) { delete EN[e.i]; spawnEnemy(e.i); } return; }
  // 一番近いプレイヤー船
  let tgt = null, td = 280;
  for (const id in SHIPS) { const s = SHIPS[id]; if (s.sunk || !shipOccupied(s.i)) continue; const d = Math.hypot(s.x - e.x, s.z - e.z); if (d < td) { td = d; tgt = s; } }
  let want = e.r;
  if (tgt) {
    const bearing = Math.atan2(-(tgt.x - e.x), -(tgt.z - e.z));
    if (td > 120) want = bearing;
    else if (td < 48) want = bearing + Math.PI;
    else want = bearing + (angd(e.r, bearing) > 0 ? Math.PI / 2 : -Math.PI / 2);
    e.in.thr = td > 120 ? 1 : 0.55;
  } else {
    if (now > e.wpAt || Math.hypot(e.wp.x - e.x, e.wp.z - e.z) < 40) {
      const a = rand(0, Math.PI * 2), d = rand(300, 1500);
      e.wp = { x: Math.cos(a) * d, z: Math.sin(a) * d }; e.wpAt = now + 70000;
    }
    want = Math.atan2(-(e.wp.x - e.x), -(e.wp.z - e.z));
    e.in.thr = 0.8;
  }
  // 島を避ける
  const ahead = { x: e.x - Math.sin(e.r) * 40, z: e.z - Math.cos(e.r) * 40 };
  if (heightAt(ahead.x, ahead.z) > -2) want = e.r + 1.3;
  e.in.turn = clamp(angd(want, e.r) * 1.6, -1, 1);
  e.in.sa = clamp(angd(wind.dir, e.r) / 1.4, -1, 1);
  stepShip(e, dt);
  // 砲撃（舷側）
  e.cd = e.cd.map((c) => Math.max(0, c - dt));
  if (tgt && td < 135) {
    const T = TYPES.galleon, l = toLocal(e, tgt.x, tgt.z);
    const side = l.x >= 0 ? 1 : -1, ci = side === -1 ? 0 : 1;
    const ang = Math.atan2(Math.abs(l.z), Math.abs(l.x));
    if (e.cd[ci] <= 0 && ang < 0.55) {
      e.cd[ci] = 3.8 + Math.random() * 1.5;
      T.cannons.filter((c) => c.side === side).forEach((c, k) => {
        const m = muzzle(e, c), dx = tgt.x + rand(-6, 6) - m.x, dz = tgt.z + rand(-6, 6) - m.z, d = Math.hypot(dx, dz);
        const pitch = 0.5 * Math.asin(clamp(BALL_G * d / (BALL_V * BALL_V), 0, 0.99));
        setTimeout(() => { if (!e.dead) fireBall('e', 0, e.i, m.x, DECKY + 0.9, m.z, dx / d * Math.cos(pitch), Math.sin(pitch), dz / d * Math.cos(pitch), null); io.emit('fx', { k: 'shoot', x: r2(m.x), y: DECKY + 0.9, z: r2(m.z), f: 'e' }); }, k * 380);
      });
    }
  }
}

// ---- クラーケン（危険海域で襲ってくる触手）----
let tentacles = [];
const zoneState = KZONES.map(() => ({ inside: 0, cool: 0, active: false }));
function stepKraken(dt, now) {
  KZONES.forEach((z, zi) => {
    const zs = zoneState[zi];
    zs.cool = Math.max(0, zs.cool - dt);
    const ships = Object.values(SHIPS).filter((s) => !s.sunk && shipOccupied(s.i) && Math.hypot(s.x - z.x, s.z - z.z) < z.r);
    if (!zs.active) {
      zs.inside = ships.length ? zs.inside + dt : Math.max(0, zs.inside - dt);
      if (zs.inside > 7 && zs.cool <= 0) {
        zs.active = true; zs.inside = 0;
        const s = ships[0];
        io.emit('msg', '🐙 ' + z.name + 'でクラーケンの触手が現れた！ ジャガイモ砲弾で迎え撃て！');
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          tentacles.push({ id: 'k' + (ballSeq++), zi, a, d: 13 + (k % 2) * 6, x: s.x + Math.cos(a) * 14, z: s.z + Math.sin(a) * 14, hp: 140, mhp: 140, cd: 2 + k * 0.8, last: 0, tgt: s.i });
        }
      }
    }
  });
  tentacles.forEach((t) => {
    if (t.hp <= 0) return;
    let s = SHIPS[t.tgt];
    if (!s || s.sunk) { s = Object.values(SHIPS).find((q) => !q.sunk && shipOccupied(q.i) && Math.hypot(q.x - KZONES[t.zi].x, q.z - KZONES[t.zi].z) < KZONES[t.zi].r + 80); if (s) t.tgt = s.i; else { t.hp = 0; return; } }
    t.a += dt * 0.25;
    const tx = s.x + Math.cos(t.a) * t.d, tz = s.z + Math.sin(t.a) * t.d;
    t.x += (tx - t.x) * Math.min(1, dt * 1.5); t.z += (tz - t.z) * Math.min(1, dt * 1.5);
    t.cd -= dt;
    if (t.cd <= 0) {
      t.cd = 4 + Math.random() * 2.5;
      io.emit('fx', { k: 'slam', x: r2(t.x), z: r2(t.z), id: t.id });
      if (Math.hypot(t.x - s.x, t.z - s.z) < t.d + 6) damageShip(s, s.x + (t.x - s.x) * 0.25, s.z + (t.z - s.z) * 0.25, 1);
    }
  });
  zoneState.forEach((zs, zi) => {
    if (!zs.active) return;
    const mine = tentacles.filter((t) => t.zi === zi);
    if (mine.length && mine.every((t) => t.hp <= 0)) {
      zs.active = false; zs.cool = 150;
      const last = mine.map((t) => t.last).find((x) => x) || 0;
      io.emit('msg', '🐙 クラーケンを撃退した！');
      if (last) credit(last, '🐙 クラーケン撃退ボーナス！', 3);
      setTimeout(() => { tentacles = tentacles.filter((t) => t.zi !== zi); }, 3000);
    }
  });
}

// ---- 畑・栽培 ----
const CROP_MS = 75000, CROP_YIELD = 3;

// ---------------------------------------------------
//  メインループ
// ---------------------------------------------------
let tick = 0, lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  stepWeather(dt, now);
  for (const id in SHIPS) {
    const s = SHIPS[id];
    stepShip(s, dt);
    s.cn.forEach((c) => { if (c.cd > 0) c.cd = Math.max(0, c.cd - dt); });
    if (!s.sunk) {
      if (s.holes.length) s.water = Math.min(100, s.water + s.holes.length * 0.9 * dt);
      if (s.water >= 100) sinkShip(s, now);
      // 作物の成長（船室が浸水していて扉が開いていると育たない）
      s.crops.forEach((c, i) => { if (c > 0) s.crops[i] = Math.max(0, c - dt * 1000 * ((s.dr === 0 || s.water < 30) ? 1 : 0)); });
    } else if (now - s.sunk > 6500) { delete SHIPS[id]; continue; }
    if (!PL[s.owner] && !shipOccupied(s.i)) { s.gone = s.gone || now; if (now - s.gone > 30000) delete SHIPS[id]; } else s.gone = 0;
  }
  for (const id in EN) stepEnemy(EN[id], dt, now);
  stepKraken(dt, now);
  stepBalls(dt, now);
  tick++;
  if (tick % 2 === 0) {
    const players = [];
    for (const id in PL) {
      const p = PL[id];
      if (!p.st) continue;
      const q = p.st;
      players.push({ i: id, n: p.name, x: q.x, y: q.y, z: q.z, r: q.r, s: q.s, lx: q.lx, ly: q.ly, lz: q.lz, t: q.t, w: q.w, m: q.m, a: q.a, h: p.save.hat, tm: p.team || 0, c: q.c });
    }
    const ships = Object.values(SHIPS).map((s) => ({
      i: s.i, t: s.t, x: r2(s.x), z: r2(s.z), r: r2(s.r), sp: r2(s.sp), an: s.an ? 1 : 0, hm: s.hm ? 1 : 0, o: s.o, tn: r2(s.tn), tm: s.tm,
      wt: Math.round(s.water), ho: s.holes.map((h) => [h.s, h.z]), dr: s.dr, cr: s.crops.map((c) => Math.round(c)), sk: s.sunk ? 1 : 0,
      cn: s.cn.map((c) => [r2(c.ya), r2(c.pi), Math.round(c.cd * 10) / 10, c.op ? 1 : 0]), sa: r2(s.in.sa || 0), th: r2(s.in.thr || 0)
    }));
    const en = Object.values(EN).map((e) => ({ i: e.i, x: r2(e.x), z: r2(e.z), r: r2(e.r), sp: r2(e.sp), hp: Math.max(0, Math.round(e.hp / e.mhp * 100)), dd: e.dead ? 1 : 0, tn: r2(e.tn) }));
    const kr = tentacles.map((t) => ({ i: t.id, x: r2(t.x), z: r2(t.z), hp: Math.max(0, Math.round(t.hp / t.mhp * 100)) }));
    const bl = BALLS.map((b) => [b.id, r2(b.x), r2(b.y), r2(b.z), b.from === 'e' ? 1 : 0]);
    const fr = FIELDS.filter((f) => f.ready > now).map((f) => f.id);
    io.emit('snap', { h: hourNow(), wd: r2(wind.dir), ws: r2(wind.spd), sm: r2(storm), ships, en, kr, bl, fr, players });
  }
}, TICK_MS);

// ---------------------------------------------------
//  ロビー / チーム
// ---------------------------------------------------
function teamList() {
  return Object.values(TEAMS).map((t) => ({ id: t.id, name: t.name, leader: t.leader, members: t.members.filter((m) => PL[m]).map((m) => ({ id: m, n: PL[m].name })) }));
}
function broadcastTeams() { io.emit('teams', teamList()); }
function leaveTeam(p) {
  if (!p.team) return;
  const t = TEAMS[p.team];
  p.team = 0;
  if (t) {
    t.members = t.members.filter((m) => m !== p.id && PL[m]);
    if (!t.members.length) delete TEAMS[t.id]; else if (t.leader === p.id) t.leader = t.members[0];
  }
  broadcastTeams();
}

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
    const name = String(m.name || '').replace(/[<>&"']/g, '').slice(0, 12) || 'ブタ海賊';
    if (!SAVES[key]) SAVES[key] = newSave();
    const sv = Object.assign(newSave(), SAVES[key]);
    if (!sv.v7) { sv.v7 = 1; addInv(sv.inv, 'plank', 2); }
    SAVES[key] = sv;
    const p = { id: socket.id, socket, key, name, save: sv, st: null, lastFish: 0, lastLoot: 0, team: 0, lastBail: 0, lastFire: 0 };
    PL[socket.id] = p;
    dirty = true;
    socket.emit('init', {
      id: socket.id, key, save: sv, defs: DEFS, dayLen: DAY_SEC, hour: hourNow(), teams: teamList(),
      ships: Object.values(SHIPS).map((s) => ({ i: s.i, t: s.t, x: s.x, z: s.z, r: s.r, sp: s.sp, an: s.an ? 1 : 0, hm: s.hm ? 1 : 0, o: s.o, tn: s.tn, tm: s.tm }))
    });
  });

  socket.on('tcreate', (m) => {
    const p = PL[socket.id]; if (!p || p.team) return;
    const name = String((m && m.name) || '').replace(/[<>&"']/g, '').slice(0, 14) || (p.name + 'のチーム');
    const t = { id: teamSeq++, name, leader: p.id, members: [p.id] };
    TEAMS[t.id] = t; p.team = t.id; broadcastTeams();
  });
  socket.on('tjoin', (m) => {
    const p = PL[socket.id]; const t = m && TEAMS[m.id];
    if (!p || !t || p.team) return;
    if (t.members.filter((x) => PL[x]).length >= DEFS.teamCap) return msg(p, 'そのチームは満員です（最大3人）');
    t.members.push(p.id); p.team = t.id; broadcastTeams();
  });
  socket.on('tleave', () => { const p = PL[socket.id]; if (p) leaveTeam(p); });

  socket.on('pl', (m) => {
    const p = PL[socket.id];
    if (!p || !m) return;
    const s = m.s | 0;
    p.st = {
      x: num(m.x, 0), y: num(m.y, 0), z: num(m.z, 0), r: num(m.r, 0), s,
      lx: num(m.lx, 0), ly: num(m.ly, 0), lz: num(m.lz, 0), t: m.t | 0, w: m.w ? 1 : 0, m: m.m ? 1 : 0, a: m.a ? 1 : 0, c: m.c ? 1 : 0
    };
  });

  socket.on('helm', (m) => {
    const p = PL[socket.id]; if (!p || !m) return;
    const s = SHIPS[m.sid]; if (!s) return;
    if (m.on) {
      if (!p.st || p.st.s !== s.i) return;
      if (s.hm && s.hm !== socket.id && PL[s.hm]) return msg(p, '他の船員が舵をとっています');
      s.hm = socket.id; s.in = { thr: 0, turn: 0, sa: s.in.sa || 0 };
    } else if (s.hm === socket.id) { s.hm = 0; s.in = { thr: 0, turn: 0, sa: s.in.sa || 0 }; }
  });
  socket.on('steer', (m) => {
    const s = m && SHIPS[m.sid];
    if (!s || s.hm !== socket.id) return;
    s.in = { thr: clamp(num(m.thr, 0), -1, 1), turn: clamp(num(m.turn, 0), -1, 1), sa: clamp(num(m.sa, 0), -1, 1) };
  });
  socket.on('anchor', (m) => {
    const p = PL[socket.id]; const s = m && SHIPS[m.sid];
    if (!p || !s || !p.st || p.st.s !== s.i) return;
    if (!s.an && Math.abs(s.sp) > 4) return msg(p, '船が速すぎて錨を下ろせません！減速しよう');
    s.an = !s.an;
    msg(p, s.an ? '⚓ 錨を下ろした' : '⚓ 錨を上げた');
  });

  // ---- 大砲（ジャガイモ砲弾）----
  socket.on('cn', (m) => {
    const p = PL[socket.id]; const s = m && SHIPS[m.sid];
    if (!p || !s || !p.st || p.st.s !== s.i) return;
    const c = s.cn[m.idx | 0]; if (!c) return;
    if (m.on) {
      if (c.op && c.op !== socket.id && PL[c.op]) return msg(p, 'その大砲は使用中です');
      s.cn.forEach((q) => { if (q.op === socket.id) q.op = 0; });
      c.op = socket.id;
    } else if (c.op === socket.id) c.op = 0;
  });
  socket.on('caim', (m) => {
    const s = m && SHIPS[m.sid]; const c = s && s.cn[m.idx | 0];
    if (!c || c.op !== socket.id) return;
    c.ya = clamp(num(m.ya, 0), -0.6, 0.6); c.pi = clamp(num(m.pi, 0.12), -0.08, 0.55);
  });
  socket.on('cfire', (m) => {
    const p = PL[socket.id]; const s = m && SHIPS[m.sid]; const idx = m && (m.idx | 0);
    if (!p || !s || s.sunk) return;
    const c = s.cn[idx]; if (!c || c.op !== socket.id) return;
    if (c.cd > 0) return;
    if (!(p.save.inv.potato > 0)) return msg(p, '🥔 ジャガイモがありません！（畑で収穫／ショップで購入／船室で栽培）');
    addInv(p.save.inv, 'potato', -1); push(p);
    c.cd = 3.2;
    const T = TYPES[s.t], cd = T.cannons[idx], mz = muzzle(s, cd), d = cannonDirWorld(s, cd, c);
    fireBall('p', socket.id, s.i, mz.x, DECKY + 0.9, mz.z, d.x, d.y, d.z, { x: -Math.sin(s.r) * s.sp, z: -Math.cos(s.r) * s.sp });
    io.emit('fx', { k: 'shoot', x: r2(mz.x), y: DECKY + 0.9, z: r2(mz.z), f: 'p', dx: r2(d.x), dz: r2(d.z) });
  });

  // ---- 船の修理・水抜き・扉・栽培 ----
  const shipOf = (p, sid) => { const s = SHIPS[sid]; return s && p.st && p.st.s === s.i ? s : null; };
  socket.on('patch', (m) => {
    const p = PL[socket.id]; const s = m && shipOf(p, m.sid);
    if (!p || !s || s.sunk || !s.holes.length) return;
    if (!(p.save.inv.plank > 0)) return msg(p, '修理用の板がありません（ショップで購入）');
    const k = clamp(m.k | 0, 0, s.holes.length - 1);
    s.holes.splice(k, 1); addInv(p.save.inv, 'plank', -1); push(p);
    msg(p, '🔨 穴をふさいだ！ 残りの穴: ' + s.holes.length + '（水は汲み出そう）');
  });
  socket.on('bail', (m) => {
    const p = PL[socket.id]; const s = m && shipOf(p, m.sid);
    const now = Date.now();
    if (!p || !s || s.sunk || now - p.lastBail < 300) return;
    p.lastBail = now; s.water = Math.max(0, s.water - 6);
  });
  socket.on('door', (m) => {
    const p = PL[socket.id]; const s = m && shipOf(p, m.sid);
    if (!p || !s || s.sunk) return;
    s.dr = s.dr ? 0 : 1;
    msg(p, s.dr ? '🚪 船室のドアを開けた' : '🚪 船室のドアを閉めた（防水）');
  });
  socket.on('crop', (m) => {
    const p = PL[socket.id]; const s = m && shipOf(p, m.sid);
    if (!p || !s || s.sunk) return;
    const i = clamp(m.k | 0, 0, s.crops.length - 1), c = s.crops[i];
    if (c === -1) {
      if (!(p.save.inv.potato > 0)) return msg(p, '植えるじゃがいもがありません');
      addInv(p.save.inv, 'potato', -1); s.crops[i] = CROP_MS; push(p);
      msg(p, '🌱 じゃがいもを植えた（約75秒で ' + CROP_YIELD + ' 個に増える！）');
    } else if (c === 0) {
      s.crops[i] = -1; addInv(p.save.inv, 'potato', CROP_YIELD); push(p);
      msg(p, '🥔 じゃがいもを ' + CROP_YIELD + ' 個収穫した！');
    }
  });
  socket.on('harvest', (m) => {
    const p = PL[socket.id]; const f = m && FIELDS[m.id | 0];
    const now = Date.now();
    if (!p || !f || !p.st) return;
    if (Math.hypot(p.st.x - f.x, p.st.z - f.z) > 16) return msg(p, '畑から離れすぎている');
    if (f.ready > now) return msg(p, 'まだ育っていない…（しばらくしてからまた来よう）');
    f.ready = now + FIELD_REGROW;
    const n = randInt(2, 4);
    addInv(p.save.inv, 'potato', n);
    let extra = '';
    if (Math.random() < 0.12) { addInv(p.save.inv, 'coin_old', 1); extra = ' ＋古びた金貨'; }
    msg(p, '🥔 ' + f.isl + 'の畑でじゃがいもを ' + n + ' 個収穫！' + extra);
    push(p);
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
    const p = PL[socket.id];
    for (const id in SHIPS) {
      if (SHIPS[id].hm === socket.id) { SHIPS[id].hm = 0; SHIPS[id].in = { thr: 0, turn: 0, sa: 0 }; }
      SHIPS[id].cn.forEach((c) => { if (c.op === socket.id) c.op = 0; });
    }
    if (p) leaveTeam(p);
    delete PL[socket.id];
    flushSaves();
  });
});

server.listen(PORT, () => console.log('Pig of potato  http://localhost:' + PORT));
