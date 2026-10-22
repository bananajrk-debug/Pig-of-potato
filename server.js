'use strict';

// POLY PIRATES: Open World Adventure
// Node.js 18+, Express, Socket.io. Persistent profiles are stored in ./data/open-world.json.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const PORT = Number(process.env.PORT || 3000);
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/healthz', (_req, res) => res.json({ ok: true, players: Object.keys(players).length, ships: Object.keys(ships).length }));
app.use((_req, res) => res.status(404).send('Not found'));

const TICK_MS = 50;
const SNAPSHOT_MS = 100;
const WORLD_RADIUS = 1800;
const MAX_GOLD = 9999999;
const MAX_INVENTORY_STACK = 999;
const PLAYER_MAX_HP = 100;
const WALK_SPEED = 8.5;
const SHIP_TURN_RATE = 0.62;
const SAVE_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'open-world.json');

const ISLANDS = [
  { id: 'outpost', name: '帆影の港（アウトポスト）', x: 0, z: 0, r: 80, type: 'outpost', dungeonX: null, dungeonZ: null },
  { id: 'skull', name: '髑髏岩島', x: 360, z: 250, r: 44, type: 'jungle', dungeonX: 374, dungeonZ: 238 },
  { id: 'palm', name: 'ヤシの入江', x: -320, z: 260, r: 39, type: 'palm', dungeonX: null, dungeonZ: null },
  { id: 'storm', name: '嵐鳴りの島', x: 260, z: -420, r: 46, type: 'rock', dungeonX: 246, dungeonZ: -433 },
  { id: 'wreck', name: '難破船の墓場', x: -470, z: -300, r: 42, type: 'wreck', dungeonX: -484, dungeonZ: -292 },
  { id: 'mist', name: '霧の島', x: 690, z: 70, r: 49, type: 'mist', dungeonX: 706, dungeonZ: 59 },
  { id: 'crescent', name: '三日月島', x: -770, z: 510, r: 45, type: 'palm', dungeonX: null, dungeonZ: null },
  { id: 'ember', name: '火山の小島', x: 820, z: -470, r: 53, type: 'rock', dungeonX: 832, dungeonZ: -488 },
  { id: 'reef', name: '珊瑚礁島', x: -900, z: -610, r: 38, type: 'palm', dungeonX: null, dungeonZ: null },
  { id: 'needle', name: '針岩の島', x: 1050, z: 410, r: 37, type: 'rock', dungeonX: null, dungeonZ: null }
];
const ISLAND_BY_ID = Object.fromEntries(ISLANDS.map(i => [i.id, i]));
const SHIP_TYPES = {
  sloop: { name: 'スループ', crew: 1, width: 8.5, length: 28, maxSpeed: 17, cost: 0 },
  brig: { name: '大型船', crew: 3, width: 12, length: 38, maxSpeed: 13, cost: 300 }
};
const ITEMS = {
  fishingRod: { name: '釣り竿', value: 0, category: 'tool' },
  shovel: { name: 'シャベル', value: 0, category: 'tool' },
  treasureMap: { name: '宝の地図', value: 0, category: 'quest' },
  potato: { name: 'じゃがいも', value: 3, category: 'food' },
  rawFish: { name: '生魚', value: 8, category: 'food' },
  grilledFish: { name: '焼き魚', value: 15, category: 'food' },
  bakedPotato: { name: 'ベイクドポテト', value: 7, category: 'food' },
  treasureChest: { name: '宝箱', value: 180, category: 'loot' },
  ancientRelic: { name: '古代の遺物', value: 420, category: 'loot' },
  jewel: { name: 'きらめく宝石', value: 110, category: 'loot' },
  seaGlass: { name: '海ガラス', value: 45, category: 'loot' }
};
const SHOP_STOCK = [
  { id: 'fishingRod', name: '釣り竿', cost: 120, once: true },
  { id: 'shovel', name: 'シャベル', cost: 80, once: true },
  { id: 'potato', name: 'じゃがいも ×5', cost: 15, qty: 5 },
  { id: 'map', name: '宝の地図ガチャ', cost: 100, special: 'map' },
  { id: 'brig', name: '大型船の造船費', cost: 300, special: 'brig' }
];

let db = { version: 1, profiles: {} };
function freshProfile(name) {
  return {
    name: cleanName(name), gold: 350, inventory: { potato: 2 }, activeQuest: null,
    shipType: 'sloop', lastDungeonLoot: 0, createdAt: Date.now(), updatedAt: Date.now()
  };
}
function cleanName(v) {
  const s = String(v || '').replace(/[\u0000-\u001f<>"'&]/g, '').trim().slice(0, 16);
  return s || '見習い海賊';
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function rand(min, max) { return min + Math.random() * (max - min); }
function distance(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function itemCount(p, id) { return Math.max(0, Number(p.profile.inventory[id] || 0)); }
function addItem(p, id, qty = 1) {
  if (!ITEMS[id] || qty <= 0) return;
  p.profile.inventory[id] = clamp(itemCount(p, id) + qty, 0, MAX_INVENTORY_STACK);
  if (p.profile.inventory[id] === 0) delete p.profile.inventory[id];
  saveSoon(p.profile);
}
function takeItem(p, id, qty = 1) {
  if (itemCount(p, id) < qty) return false;
  p.profile.inventory[id] = itemCount(p, id) - qty;
  if (p.profile.inventory[id] <= 0) delete p.profile.inventory[id];
  saveSoon(p.profile);
  return true;
}
function addGold(p, amount) {
  p.profile.gold = clamp(Math.floor(p.profile.gold + amount), 0, MAX_GOLD);
  saveSoon(p.profile);
}
function migrateProfile(p) {
  if (!p || typeof p !== 'object') p = {};
  if (!p.name) p.name = '見習い海賊';
  p.name = cleanName(p.name);
  p.gold = clamp(Number(p.gold) || 0, 0, MAX_GOLD);
  if (!p.inventory || typeof p.inventory !== 'object' || Array.isArray(p.inventory)) p.inventory = { potato: 2 };
  for (const k of Object.keys(p.inventory)) {
    if (!ITEMS[k]) delete p.inventory[k];
    else p.inventory[k] = clamp(Math.floor(Number(p.inventory[k]) || 0), 0, MAX_INVENTORY_STACK);
  }
  if (!SHIP_TYPES[p.shipType]) p.shipType = 'sloop';
  if (!('activeQuest' in p)) p.activeQuest = null;
  if (!Number.isFinite(p.lastDungeonLoot)) p.lastDungeonLoot = 0;
  return p;
}
function loadDb() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
      if (parsed && parsed.profiles && typeof parsed.profiles === 'object') db = parsed;
    }
  } catch (err) {
    console.error('セーブデータ読込エラー:', err.message);
  }
  for (const token of Object.keys(db.profiles)) db.profiles[token] = migrateProfile(db.profiles[token]);
  console.log(`セーブデータを読み込みました: ${Object.keys(db.profiles).length}件`);
}
let saveTimer = null;
function saveNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    const tmp = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, SAVE_FILE);
  } catch (err) { console.error('セーブエラー:', err.message); }
}
function saveSoon(profile) {
  if (profile) profile.updatedAt = Date.now();
  if (!saveTimer) saveTimer = setTimeout(saveNow, 1200);
}
loadDb();
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

const players = Object.create(null);
const ships = Object.create(null);
let shipSeq = 1;
function createShip(ownerId, type, name) {
  const spec = SHIP_TYPES[type] || SHIP_TYPES.sloop;
  const id = 'ship-' + shipSeq++;
  const offset = Object.keys(ships).length * 16;
  const ship = {
    id, ownerId, name: cleanName(name) + 'の船', type, x: 0 + offset, z: 80 + spec.length / 2 + 2,
    yaw: 0, speed: 0, anchored: false, helmBy: null, crew: [ownerId],
    width: spec.width, length: spec.length, maxSpeed: spec.maxSpeed, maxCrew: spec.crew,
    cargo: {}, createdAt: Date.now()
  };
  ships[id] = ship;
  return ship;
}
function basePlayer(socket, profile, token) {
  return {
    id: socket.id, socket, token, profile, name: profile.name, hp: PLAYER_MAX_HP,
    x: 0, z: 0, yaw: 0, shipId: null, localX: 0, localZ: 0, role: null,
    input: { forward: false, back: false, left: false, right: false },
    inDungeon: false, returnPos: null, dungeonChestOpened: false,
    fishingUntil: 0, fishingMessageSent: false, notice: '', noticeUntil: 0,
    joinedAt: Date.now()
  };
}
function localToWorld(s, lx, lz) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c };
}
function worldToLocal(s, wx, wz) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const dx = wx - s.x, dz = wz - s.z;
  return { x: dx * c - dz * sn, z: dx * sn + dz * c };
}
function playerPos(p) {
  if (p.inDungeon) return { x: p.x, z: p.z };
  if (p.shipId && ships[p.shipId]) return localToWorld(ships[p.shipId], p.localX, p.localZ);
  return { x: p.x, z: p.z };
}
function notify(p, message) {
  if (!p) return;
  p.notice = String(message).slice(0, 240);
  p.noticeUntil = Date.now() + 4200;
  p.socket.emit('notice', p.notice);
}
function getShipFor(p) { return p.shipId ? ships[p.shipId] : null; }
function countCrew(ship) { return Object.values(players).filter(p => p.shipId === ship.id).length; }
function shipTargetWorld(ship, lx, lz) { return localToWorld(ship, lx, lz); }
function nearestIsland(x, z) {
  let best = null;
  for (const island of ISLANDS) {
    const d = distance(x, z, island.x, island.z);
    if (!best || d < best.d) best = { island, d };
  }
  return best;
}
function footLocationAllowed(x, z, p) {
  if (p.inDungeon && x > 1980 && x < 2050 && z > 1980 && z < 2080) return true;
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) return false;
  for (const island of ISLANDS) if (distance(x, z, island.x, island.z) <= island.r + 9) return true;
  for (const s of Object.values(ships)) if (distance(x, z, s.x, s.z) <= s.length / 2 + 10) return true;
  return false;
}
function publish() {
  const now = Date.now();
  const publicPlayers = Object.values(players).map(p => {
    const pos = playerPos(p);
    return { id: p.id, name: p.name, x: pos.x, z: pos.z, yaw: p.yaw, hp: p.hp, shipId: p.shipId,
      localX: p.localX, localZ: p.localZ, role: p.role, inDungeon: p.inDungeon,
      fishing: p.fishingUntil > now, isSelfOnly: false };
  });
  const publicShips = Object.values(ships).map(s => ({
    id: s.id, ownerId: s.ownerId, name: s.name, type: s.type, x: s.x, z: s.z, yaw: s.yaw,
    speed: s.speed, anchored: s.anchored, helmBy: s.helmBy, crew: countCrew(s), maxCrew: s.maxCrew,
    width: s.width, length: s.length
  }));
  for (const p of Object.values(players)) {
    const pos = playerPos(p);
    p.socket.emit('worldState', {
      players: publicPlayers, ships: publicShips,
      self: {
        id: p.id, name: p.name, x: pos.x, z: pos.z, yaw: p.yaw, hp: p.hp, maxHp: PLAYER_MAX_HP,
        shipId: p.shipId, localX: p.localX, localZ: p.localZ, role: p.role, inDungeon: p.inDungeon,
        gold: p.profile.gold, inventory: p.profile.inventory, activeQuest: p.profile.activeQuest,
        shipType: p.profile.shipType, fishing: p.fishingUntil > now, notice: p.noticeUntil > now ? p.notice : ''
      }
    });
  }
}
function canUseShipStation(p, lx, lz, range = 4.2) {
  const s = getShipFor(p);
  return !!s && Math.hypot(p.localX - lx, p.localZ - lz) <= range;
}
function openPanel(p, type) {
  p.socket.emit('panel', { type, gold: p.profile.gold, inventory: p.profile.inventory,
    cargo: getShipFor(p) ? getShipFor(p).cargo : {}, stock: SHOP_STOCK });
}
function questSpot(quest) {
  if (!quest) return null;
  const island = ISLAND_BY_ID[quest.targetId];
  if (!island) return null;
  return { x: quest.x, z: quest.z, island };
}
function startFishing(p) {
  const now = Date.now();
  if (p.inDungeon) return notify(p, '洞窟の中では釣りができません。');
  if (!itemCount(p, 'fishingRod')) return notify(p, 'まず港のショップで釣り竿を購入してください。');
  if (p.fishingUntil > now) return notify(p, 'すでに釣り糸を垂らしています…');
  const s = getShipFor(p);
  if (s && Math.abs(s.speed) > 3) return notify(p, '船が速すぎます。減速するか錨を下ろしましょう。');
  if (!s && !p.inDungeon) {
    const near = nearestIsland(p.x, p.z);
    if (!near || near.d < near.island.r - 8 || near.d > near.island.r + 5) return notify(p, '釣りは海岸か船の上で行えます。');
  }
  p.fishingUntil = now + 4200;
  p.fishingMessageSent = false;
  notify(p, '釣り中… 海面をよく見よう。');
}
function interact(p, target) {
  const pos = playerPos(p);
  const s = getShipFor(p);
  if (p.inDungeon) {
    if (target === 'dungeonExit' && distance(p.x, p.z, 2000, 2000) < 10) {
      const back = p.returnPos;
      p.inDungeon = false;
      if (back && back.shipId && ships[back.shipId]) {
        p.shipId = back.shipId; p.localX = back.localX; p.localZ = back.localZ;
        p.x = 0; p.z = 0;
      } else {
        p.shipId = null;
        p.x = back ? back.x : 360; p.z = back ? back.z : 250;
      }
      p.returnPos = null;
      notify(p, '洞窟の外へ戻りました。');
      return;
    }
    if (target === 'dungeonChest' && distance(p.x, p.z, 2010, 2040) < 7) {
      if (Date.now() - p.profile.lastDungeonLoot < 180000) return notify(p, '宝箱は空です。しばらくしてからまた来てください。');
      p.profile.lastDungeonLoot = Date.now();
      addItem(p, 'treasureChest', 1);
      addItem(p, 'ancientRelic', 1);
      if (Math.random() < .55) addItem(p, 'jewel', 1);
      saveSoon(p.profile);
      notify(p, 'ダンジョンの宝箱を開けた！ 宝箱と古代の遺物を入手。');
      p.socket.emit('lootEffect', { x: p.x, z: p.z });
      return;
    }
    return notify(p, 'ここではそれ以上できることはありません。');
  }

  if (target === 'helm') {
    if (!s || !canUseShipStation(p, 0, s.length * 0.31, 5.2)) return notify(p, '舵のそばまで移動してください。');
    if (s.helmBy === p.id) { s.helmBy = null; p.role = null; notify(p, '舵から手を離しました。'); }
    else if (s.helmBy && players[s.helmBy]) notify(p, `${players[s.helmBy].name} が舵を握っています。`);
    else { s.helmBy = p.id; p.role = 'helm'; notify(p, '舵を握りました。W/Sで前進・後退、A/Dで旋回。Eで離れます。'); }
    return;
  }
  if (target === 'anchor') {
    if (!s || !canUseShipStation(p, 0, s.length * 0.43, 5)) return notify(p, '船尾の錨のそばまで移動してください。');
    s.anchored = !s.anchored;
    if (s.anchored) s.speed = 0;
    notify(p, s.anchored ? '錨を下ろした。船はその場に固定された。' : '錨を上げた。いつでも出航できます。');
    return;
  }
  if (target === 'kitchen') {
    if (!s || !canUseShipStation(p, -s.width * .25, 0, 5.5)) return notify(p, '船内の台所に移動してください。');
    openPanel(p, 'kitchen'); return;
  }
  if (target === 'storage') {
    if (!s || !canUseShipStation(p, s.width * .24, s.length * .08, 5.5)) return notify(p, '船内の保管箱に移動してください。');
    openPanel(p, 'storage'); return;
  }
  if (target === 'shop' || target === 'pawn' || target === 'gacha') {
    if (distance(pos.x, pos.z, target === 'shop' ? 18 : target === 'pawn' ? -20 : 8, target === 'shop' ? -8 : target === 'pawn' ? -8 : 22) > 22) return notify(p, '港の建物に近づいてください。');
    openPanel(p, target); return;
  }
  if (target === 'dungeonEnter') {
    const island = ISLANDS.find(i => i.dungeonX != null && distance(pos.x, pos.z, i.dungeonX, i.dungeonZ) < 15);
    if (!island || p.shipId) return notify(p, '船から降りて洞窟の入口まで歩いてください。');
    p.returnPos = { x: p.x, z: p.z, shipId: null, localX: 0, localZ: 0 };
    p.inDungeon = true; p.x = 2000; p.z = 2000; p.yaw = 0; p.dungeonChestOpened = false;
    notify(p, `${island.name}の洞窟に入りました。奥の宝箱を探そう。`); return;
  }
  if (target === 'dig') {
    const quest = p.profile.activeQuest;
    const spot = questSpot(quest);
    if (!spot) return notify(p, '宝の地図を持っていません。港の地図ガチャを利用しましょう。');
    if (p.shipId || distance(pos.x, pos.z, spot.x, spot.z) > 13) return notify(p, '地図に記された場所まで徒歩で進み、地面を掘ってください。');
    if (!itemCount(p, 'shovel')) return notify(p, '掘り出すにはシャベルが必要です。港のショップで購入できます。');
    addItem(p, 'treasureChest', 1);
    addItem(p, Math.random() < .65 ? 'jewel' : 'seaGlass', 1);
    p.profile.activeQuest = null;
    if (itemCount(p, 'treasureMap')) takeItem(p, 'treasureMap', 1);
    saveSoon(p.profile);
    notify(p, 'ザクッ！ 宝を掘り出しました。戦利品は質屋で換金できます。');
    p.socket.emit('lootEffect', { x: pos.x, z: pos.z }); return;
  }
  if (target.startsWith('board:')) {
    const shipId = target.slice(6); const otherShip = ships[shipId];
    if (!otherShip || p.shipId) return;
    if (distance(pos.x, pos.z, otherShip.x, otherShip.z) > otherShip.length / 2 + 11) return notify(p, '船に近づいてください。');
    if (countCrew(otherShip) >= otherShip.maxCrew) return notify(p, 'この船は満員です。');
    p.shipId = otherShip.id; p.localX = 0; p.localZ = 0; p.role = null;
    if (!otherShip.crew.includes(p.id)) otherShip.crew.push(p.id);
    notify(p, `${otherShip.name} に乗り込みました。`); return;
  }
  notify(p, '近くで使えるものはありません。');
}
function handleAction(p, data) {
  const action = String(data && data.action || '');
  switch (action) {
    case 'buyRod':
      if (itemCount(p, 'fishingRod')) return notify(p, '釣り竿はすでに持っています。');
      if (p.profile.gold < 120) return notify(p, 'ゴールドが足りません（120G）。');
      addGold(p, -120); addItem(p, 'fishingRod', 1); return notify(p, '釣り竿を購入しました。');
    case 'buyShovel':
      if (itemCount(p, 'shovel')) return notify(p, 'シャベルはすでに持っています。');
      if (p.profile.gold < 80) return notify(p, 'ゴールドが足りません（80G）。');
      addGold(p, -80); addItem(p, 'shovel', 1); return notify(p, 'シャベルを購入しました。');
    case 'buyPotato':
      if (p.profile.gold < 15) return notify(p, 'ゴールドが足りません（15G）。');
      addGold(p, -15); addItem(p, 'potato', 5); return notify(p, 'じゃがいもを5個購入しました。');
    case 'buyMap': {
      if (p.profile.gold < 100) return notify(p, 'ゴールドが足りません（100G）。');
      if (p.profile.activeQuest) return notify(p, 'すでに追跡中の宝の地図があります。先に宝を掘り出しましょう。');
      addGold(p, -100);
      const choices = ISLANDS.filter(i => i.id !== 'outpost');
      const island = choices[Math.floor(Math.random() * choices.length)];
      const angle = rand(0, Math.PI * 2), radius = island.r * rand(.27, .62);
      p.profile.activeQuest = { targetId: island.id, x: island.x + Math.cos(angle) * radius, z: island.z + Math.sin(angle) * radius, title: island.name + 'の埋蔵金' };
      addItem(p, 'treasureMap', 1); // Quest maps are tracked separately; this is only a UI count.
      saveSoon(p.profile);
      return notify(p, `宝の地図を入手！ 行き先は「${island.name}」。地図マーカーを頼りに探しましょう。`);
    }
    case 'buyBrig': {
      if (p.profile.gold < 300) return notify(p, '大型船の造船には300G必要です。');
      if (p.shipId && ships[p.shipId] && ships[p.shipId].ownerId === p.id) return notify(p, 'すでに自分の船があります。船種を変えるには港で乗り換え操作をしてください。');
      addGold(p, -300); p.profile.shipType = 'brig'; saveSoon(p.profile);
      notify(p, '大型船を購入しました。次回の出航から選択できます。'); return;
    }
    case 'cookFish': {
      const s = getShipFor(p);
      if (!s || !canUseShipStation(p, -s.width * .25, 0, 6)) return notify(p, '船内の台所で調理してください。');
      if (!takeItem(p, 'rawFish', 1)) return notify(p, '生魚を持っていません。');
      addItem(p, 'grilledFish', 1); return notify(p, '魚を焼きました。焼き魚は食べるとHPが35回復します。');
    }
    case 'cookPotato': {
      const s = getShipFor(p);
      if (!s || !canUseShipStation(p, -s.width * .25, 0, 6)) return notify(p, '船内の台所で調理してください。');
      if (!takeItem(p, 'potato', 1)) return notify(p, 'じゃがいもを持っていません。');
      addItem(p, 'bakedPotato', 1); return notify(p, 'じゃがいもを焼き、ベイクドポテトを作りました。');
    }
    case 'eatFish':
      if (!takeItem(p, 'grilledFish', 1)) return notify(p, '焼き魚がありません。');
      p.hp = clamp(p.hp + 35, 0, PLAYER_MAX_HP); return notify(p, '焼き魚を食べてHPが回復しました。');
    case 'eatPotato':
      if (!takeItem(p, 'bakedPotato', 1)) return notify(p, 'ベイクドポテトがありません。');
      p.hp = clamp(p.hp + 22, 0, PLAYER_MAX_HP); return notify(p, 'ベイクドポテトを食べてHPが回復しました。');
    case 'castFish': return startFishing(p);
    case 'sellLoot': {
      const lootIds = ['treasureChest', 'ancientRelic', 'jewel', 'seaGlass'];
      let total = 0, amount = 0;
      for (const id of lootIds) {
        const qty = itemCount(p, id);
        if (qty > 0) { total += qty * ITEMS[id].value; amount += qty; takeItem(p, id, qty); }
      }
      const s = getShipFor(p) || Object.values(ships).find(v => v.ownerId === p.id);
      if (s && distance(s.x, s.z, 0, 0) < 140) {
        for (const id of lootIds) {
          const qty = Number(s.cargo[id] || 0);
          if (qty > 0) { total += qty * ITEMS[id].value; amount += qty; delete s.cargo[id]; }
        }
      }
      if (!amount) return notify(p, '売却できる戦利品がありません。');
      addGold(p, total); return notify(p, `${amount}個の戦利品を${total}Gで売却しました。`);
    }
    case 'storeLoot': {
      const s = getShipFor(p);
      if (!s || !canUseShipStation(p, s.width * .24, s.length * .08, 6)) return notify(p, '船内の保管箱のそばで操作してください。');
      const lootIds = ['treasureChest', 'ancientRelic', 'jewel', 'seaGlass']; let total = 0;
      for (const id of lootIds) { const qty = itemCount(p, id); if (qty) { s.cargo[id] = Number(s.cargo[id] || 0) + qty; takeItem(p, id, qty); total += qty; } }
      return notify(p, total ? `${total}個の戦利品を船の保管箱にしまいました。` : '保管する戦利品がありません。');
    }
    case 'takeLoot': {
      const s = getShipFor(p);
      if (!s || !canUseShipStation(p, s.width * .24, s.length * .08, 6)) return notify(p, '船内の保管箱のそばで操作してください。');
      let total = 0; for (const id of ['treasureChest', 'ancientRelic', 'jewel', 'seaGlass']) { const qty = Number(s.cargo[id] || 0); if (qty) { addItem(p, id, qty); delete s.cargo[id]; total += qty; } }
      return notify(p, total ? `${total}個の戦利品を取り出しました。` : '保管箱は空です。');
    }
    case 'disembark': {
      const s = getShipFor(p);
      if (!s) return;
      const out = localToWorld(s, 0, -(s.length / 2 + 1.2));
      p.x = out.x; p.z = out.z; p.shipId = null; p.localX = 0; p.localZ = 0; p.role = null;
      if (s.helmBy === p.id) s.helmBy = null;
      s.crew = s.crew.filter(id => id !== p.id);
      return notify(p, '船を降りました。Qキーで近くの船に戻れます。');
    }
    case 'switchShip': {
      const s = getShipFor(p) || Object.values(ships).find(v => v.ownerId === p.id);
      const nearPort = distance(p.x, p.z, 0, 0) < 115;
      if (s && s.ownerId === p.id && (p.shipId || nearPort)) {
        if (Math.abs(s.speed) > .4) return notify(p, '船を止めてから船種を変更してください。');
        const next = s.type === 'sloop' ? 'brig' : 'sloop';
        if (next === 'brig' && p.profile.gold < 300) return notify(p, '大型船への乗り換えには300G必要です。');
        if (next === 'brig') addGold(p, -300);
        p.profile.shipType = next; saveSoon(p.profile);
        notify(p, `次に作る船を${SHIP_TYPES[next].name}に設定しました。港で「新しい船を出す」を選んでください。`);
        return;
      }
      return notify(p, '船種変更は港の近く、または自分の船の上で行ってください。');
    }
    case 'newShip': {
      const old = Object.values(ships).find(v => v.ownerId === p.id) || getShipFor(p);
      const currentPos = playerPos(p);
      if (distance(currentPos.x, currentPos.z, 0, 0) > 115) return notify(p, '新しい船を出すには帆影の港へ戻ってください。');
      if (old) {
        if (Math.abs(old.speed) > .4) return notify(p, '新しい船を出すには船を止めてください。');
        const otherCrew = Object.values(players).some(v => v.id !== p.id && v.shipId === old.id);
        if (otherCrew) return notify(p, 'ほかの乗員が乗っているため、先に全員に下船してもらってください。');
        delete ships[old.id];
      }
      const ship = createShip(p.id, p.profile.shipType, p.name);
      const spec = SHIP_TYPES[ship.type];
      ship.z = ISLAND_BY_ID.outpost.r + spec.length / 2 + 2;
      p.shipId = ship.id; p.localX = 0; p.localZ = 0; p.role = null;
      p.profile.shipType = ship.type; saveSoon(p.profile);
      return notify(p, `${spec.name}を港から出しました。よい航海を！`);
    }
    default: return notify(p, 'その操作はまだ使えません。');
  }
}

io.on('connection', socket => {
  socket.on('joinWorld', data => {
    if (players[socket.id]) return;
    const requestedToken = String(data && data.token || '');
    const token = /^[a-zA-Z0-9_-]{16,80}$/.test(requestedToken) ? requestedToken : crypto.randomBytes(20).toString('hex');
    let profile = db.profiles[token];
    if (!profile) { profile = freshProfile(data && data.name); db.profiles[token] = profile; }
    profile = migrateProfile(profile);
    if (data && data.name) profile.name = cleanName(data.name);
    const requestedType = data && SHIP_TYPES[data.shipType] ? data.shipType : profile.shipType;
    let brigDenied = false;
    if (requestedType === 'brig' && profile.shipType !== 'brig') {
      if (profile.gold >= 300) { profile.gold -= 300; profile.shipType = 'brig'; }
      else { profile.shipType = 'sloop'; brigDenied = true; }
    } else {
      profile.shipType = requestedType;
    }
    saveSoon(profile);
    const p = basePlayer(socket, profile, token);
    players[socket.id] = p;
    const ship = createShip(socket.id, profile.shipType, profile.name);
    const spec = SHIP_TYPES[ship.type];
    ship.z = ISLAND_BY_ID.outpost.r + spec.length / 2 + 2;
    p.shipId = ship.id; p.localX = 0; p.localZ = 0;
    socket.emit('worldInit', { id: socket.id, token, profile: { name: profile.name, gold: profile.gold, inventory: profile.inventory, shipType: profile.shipType, activeQuest: profile.activeQuest }, islands: ISLANDS, shipTypes: SHIP_TYPES, worldRadius: WORLD_RADIUS });
    notify(p, brigDenied ? '大型船には300G必要なため、スループで出航します。' : '帆影の港へようこそ。Eで調べる、WASDで移動・操船、Qで船を降りる。');
    publish();
  });

  socket.on('input', data => {
    const p = players[socket.id]; if (!p) return;
    const d = data && typeof data === 'object' ? data : {};
    p.input = { forward: !!d.forward, back: !!d.back, left: !!d.left, right: !!d.right };
    if (Number.isFinite(d.yaw)) p.yaw = d.yaw;
    // The server, not the client, performs position and ship movement.
  });
  socket.on('interact', data => {
    const p = players[socket.id]; if (!p) return;
    const target = String(data && data.target || '').slice(0, 100);
    interact(p, target);
  });
  socket.on('action', data => {
    const p = players[socket.id]; if (!p) return;
    const a = String(data && data.action || '').slice(0, 40);
    handleAction(p, { action: a });
  });
  socket.on('castFish', () => { const p = players[socket.id]; if (p) startFishing(p); });
  socket.on('setName', value => {
    const p = players[socket.id]; if (!p) return;
    p.profile.name = cleanName(value); p.name = p.profile.name;
    saveSoon(p.profile); notify(p, `船乗り名を「${p.name}」に変更しました。`);
  });
  socket.on('disconnect', () => {
    const p = players[socket.id]; if (!p) return;
    const ship = getShipFor(p);
    if (ship && ship.helmBy === p.id) ship.helmBy = null;
    if (ship) ship.crew = ship.crew.filter(id => id !== p.id);
    // An owned, empty vessel is removed on disconnect. Other players can keep shared vessels.
    if (ship && ship.ownerId === p.id) {
      const passengers = Object.values(players).filter(other => other.id !== p.id && other.shipId === ship.id);
      for (const passenger of passengers) {
        const wp = playerPos(passenger); passenger.shipId = null; passenger.x = wp.x; passenger.z = wp.z; passenger.role = null;
        notify(passenger, '船長が切断したため船を降りました。');
      }
      delete ships[ship.id];
    }
    saveSoon(p.profile);
    delete players[socket.id];
    publish();
  });
});

let lastSnapshot = 0;
setInterval(() => {
  const now = Date.now(); const dt = TICK_MS / 1000;
  // Ships move continuously; no round timer, match phase, or automatic reset exists.
  for (const ship of Object.values(ships)) {
    const pilot = ship.helmBy ? players[ship.helmBy] : null;
    if (!pilot || pilot.shipId !== ship.id || pilot.role !== 'helm') {
      ship.speed += (0 - ship.speed) * Math.min(1, dt * .35);
    } else if (!ship.anchored) {
      const targetSpeed = pilot.input.forward ? ship.maxSpeed : pilot.input.back ? -ship.maxSpeed * .35 : 0;
      ship.speed += (targetSpeed - ship.speed) * Math.min(1, dt * (targetSpeed === 0 ? .6 : .42));
      const steering = (pilot.input.left ? 1 : 0) - (pilot.input.right ? 1 : 0);
      const speedFactor = Math.max(.22, Math.abs(ship.speed) / ship.maxSpeed);
      ship.yaw += steering * SHIP_TURN_RATE * speedFactor * dt * (ship.speed < 0 ? -1 : 1);
    }
    if (ship.anchored) ship.speed = 0;
    if (Math.abs(ship.speed) > .015) {
      const oldX = ship.x, oldZ = ship.z;
      ship.x += -Math.sin(ship.yaw) * ship.speed * dt;
      ship.z += -Math.cos(ship.yaw) * ship.speed * dt;
      let blocked = Math.abs(ship.x) > WORLD_RADIUS || Math.abs(ship.z) > WORLD_RADIUS;
      if (!blocked) {
        for (const island of ISLANDS) {
          const minDist = island.r + ship.length * .34;
          if (distance(ship.x, ship.z, island.x, island.z) < minDist) { blocked = true; break; }
        }
      }
      if (blocked) { ship.x = oldX; ship.z = oldZ; ship.speed = 0; }
    }
  }
  // Players walk on island ground or along the deck of their ship.
  for (const p of Object.values(players)) {
    const input = p.input;
    if (p.role === 'helm') continue;
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let mz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const mag = Math.hypot(mx, mz);
    if (mag > 0) { mx /= mag; mz /= mag; }
    if (!mag) continue;
    if (p.shipId && ships[p.shipId]) {
      const ship = ships[p.shipId];
      const worldDx = -Math.sin(p.yaw) * mz + Math.cos(p.yaw) * mx;
      const worldDz = -Math.cos(p.yaw) * mz - Math.sin(p.yaw) * mx;
      const local = worldToLocal(ship, worldDx, worldDz);
      p.localX = clamp(p.localX + local.x * WALK_SPEED * dt, -ship.width * .43, ship.width * .43);
      p.localZ = clamp(p.localZ + local.z * WALK_SPEED * dt, -ship.length * .42, ship.length * .42);
    } else {
      const oldX = p.x, oldZ = p.z;
      const dx = (-Math.sin(p.yaw) * mz + Math.cos(p.yaw) * mx) * WALK_SPEED * dt;
      const dz = (-Math.cos(p.yaw) * mz - Math.sin(p.yaw) * mx) * WALK_SPEED * dt;
      const nx = p.x + dx, nz = p.z + dz;
      if (footLocationAllowed(nx, nz, p)) { p.x = nx; p.z = nz; }
      else { p.x = oldX; p.z = oldZ; }
    }
  }
  // Fishing resolves after a short, uninterrupted cast.
  for (const p of Object.values(players)) {
    if (p.fishingUntil && now >= p.fishingUntil) {
      p.fishingUntil = 0;
      if (p.shipId || (!p.inDungeon && nearestIsland(p.x, p.z).d >= nearestIsland(p.x, p.z).island.r - 8)) {
        const amount = Math.random() < .16 ? 2 : 1;
        addItem(p, 'rawFish', amount);
        notify(p, `魚が釣れた！ 生魚 ×${amount} を入手。船の台所で焼けます。`);
      } else notify(p, '魚は逃げてしまった…。');
    }
  }
  if (now - lastSnapshot >= SNAPSHOT_MS) { lastSnapshot = now; publish(); }
}, TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`POLY PIRATES open world listening on http://localhost:${PORT}`);
});
