import { CONFIG, GOODS, type BuildingKind, type Good, type TechDef, type TechEffect, type TileKind, type UnitKind } from '../config';
import { hash, noise2, rand } from './rng';
import { DOORS } from './doors';
import { findPathToRect, findPathToTile } from './path';
import { FOREST, GRASS, STONE, type Building, type GameState, type Pt, type Squad, type Villager } from './types';
import {
  amountOf, available, haulDrop, haulPickUp, isBuilt, isStockpile, madeHere, pickHaul, pickSite, putInStockpiles,
  retarget, siteHours, siteMaterials, siteWorkable,
} from './logistics';

// =====================================================================
//  The simulation ("game logic"). Knows nothing about drawing.
//  One call to tick() = one fixed step of 1/ticksPerSecond game-seconds.
// =====================================================================

export const SAVE_VERSION = 7;
export const DT = 1 / CONFIG.time.ticksPerSecond;
export const TICKS_PER_DAY = CONFIG.time.dayLengthSeconds * CONFIG.time.ticksPerSecond;

export const def = (k: BuildingKind) => CONFIG.buildings[k];

// ---------- creation ----------

export function newGame(seed = (Math.random() * 1e9) | 0): GameState {
  const M = CONFIG.map;
  const W = M.width, H = M.height;
  const tiles = new Uint8Array(W * H);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = noise2(x / M.forestScale, y / M.forestScale, seed) * 0.7 +
        noise2(x / 3, y / 3, seed + 7) * 0.3;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // keep the centre clear, make forest likelier towards the edges
      const edge = Math.max(0, (d - M.clearRadius) / (W / 2));
      const v = n + edge * 0.35 - (d < M.clearRadius ? 1 : 0);
      tiles[y * W + x] = v > 1 - M.forestAmount ? FOREST : GRASS;
    }
  }
  // make sure there's a small grove close to the centre for an early lumber camp
  const ang = hash(seed, 1) * Math.PI * 2;
  const gx = Math.round(cx + Math.cos(ang) * (M.clearRadius + 2.5));
  const gy = Math.round(cy + Math.sin(ang) * (M.clearRadius + 2.5));
  for (let y = gy - 2; y <= gy + 2; y++)
    for (let x = gx - 2; x <= gx + 2; x++)
      if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - gx, y - gy) < 2.6)
        tiles[y * W + x] = FOREST;
  // stone deposits: rocky blobs, one always fairly close to the centre, the rest spread out
  const deps: Pt[] = [];
  for (let k = 0; k < M.stoneDeposits * 30 && deps.length < M.stoneDeposits; k++) {
    let x: number, y: number;
    if (!deps.length) {
      const a = ang + Math.PI * (0.7 + hash(seed, 3) * 0.6); // away from the starting grove
      const r = M.nearDeposit[0] + hash(seed, 4) * (M.nearDeposit[1] - M.nearDeposit[0]);
      x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
    } else {
      x = 5 + hash(seed, k, 5) * (W - 10); y = 5 + hash(seed, k, 6) * (H - 10);
      if (Math.hypot(x - cx, y - cy) < M.clearRadius + 6) continue;
      if (deps.some(d => Math.hypot(d.x - x, d.y - y) < 12)) continue;
    }
    deps.push({ x, y });
    const r = M.depositRadius[0] + hash(seed, k, 7) * (M.depositRadius[1] - M.depositRadius[0]);
    for (let ty = Math.floor(y - r - 2); ty <= y + r + 2; ty++) for (let tx = Math.floor(x - r - 2); tx <= x + r + 2; tx++) {
      if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) continue;
      const wob = (noise2(tx / 2.2, ty / 2.2, seed + 31 + k) - 0.5) * 2.2;
      if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) < r + wob) tiles[ty * W + tx] = STONE;
    }
  }

  const s: GameState = {
    saveVersion: SAVE_VERSION,
    seed, rng: seed,
    w: W, h: H, tiles,
    edgeToday: new Float32Array(W * H * 4),
    edgeAvg: new Float32Array(W * H * 4),
    edgeLevel: new Uint8Array(W * H * 4),
    edgeAge: new Uint8Array(W * H * 4),
    wear: new Float32Array(W * H),
    roadDay: 0, roadVersion: 0,
    occ: new Int32Array(W * H).fill(-1),
    buildings: [], villagers: [],
    nextId: 1, tick: 0,
    gold: CONFIG.start.gold,
    hallLevel: 1, hallId: null, births: 0, version: 0,
    squads: [], nextSquadNum: {}, unlockAll: false,
    techs: [], research: null,
  };
  return s;
}

function makeVillager(s: GameState, x: number, y: number): Villager {
  return {
    id: s.nextId++, x, y, px: x, py: y,
    home: null, job: null, mode: 'idle', inside: null,
    goalKey: '', goalB: null, goalKind: 'wander',
    task: null, deliveries: 0, deliveryDay: -1, haul: null, site: null, think: rand(s),
    way: [], path: [], approach: false, dest: null, timer: rand(s) * 2, vis: 1,
    lastTile: -1, hallDay: -1, carry: null,
    errandB: null, lastErrand: null, errandDay: -1,
    evening: -1, stops: 0, ateAt: -1, tavernDay: -99, chapelDay: -99,
    squad: null, unit: null, trained: false,
    look: { tunic: (rand(s) * 5) | 0, hair: (rand(s) * 5) | 0, skin: (rand(s) * 3) | 0 },
    jitter: rand(s) * CONFIG.schedule.personalJitter,
    ox: (rand(s) - 0.5) * 0.16, oy: (rand(s) - 0.5) * 0.16,
    dir: rand(s) * Math.PI * 2, step: rand(s) * 10,
  };
}

// ---------- queries ----------

export const dayNumber = (s: GameState) => Math.floor(s.tick / TICKS_PER_DAY) + 1;
export const dayFrac = (s: GameState) => (s.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
export const getB = (s: GameState, id: number | null) =>
  id == null ? undefined : s.buildings.find(b => b.id === id);
export const population = (s: GameState) => s.villagers.length;
/** Beds in houses (civilians). */
export const beds = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (isBuilt(b) ? def(b.kind).beds ?? 0 : 0), 0);
/** Beds in barracks (soldiers). */
export const soldierBeds = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (isBuilt(b) ? def(b.kind).soldierBeds ?? 0 : 0), 0);
export const soldiers = (s: GameState) => s.villagers.filter(v => v.squad != null).length;
export const civilians = (s: GameState) => s.villagers.length - soldiers(s);
export const houseCount = (s: GameState) =>
  s.buildings.filter(b => def(b.kind).isHouse).length;
export const houseCap = (s: GameState) =>
  CONFIG.townHall.levels[s.hallLevel - 1].houseCap;
export const idleCount = (s: GameState) => s.villagers.filter(v => v.job == null && v.squad == null).length;
/** Hour of the day, 0..24 (the day starts at midnight). */
export const hourOf = (s: GameState) => dayFrac(s) * 24;
/** Total food storage (Town Hall + granaries), in lb. */
export const foodCap = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (isBuilt(b) ? def(b.kind).foodStorage ?? 0 : 0), 0);
/** Food in storage (what the colony can eat), in lb. */
export const foodStored = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (def(b.kind).foodStorage ? b.food : 0), 0);
/** On shift = physically at work. Carriers out delivering food don't count (that's the delivery penalty). */
const onShift = (v: Villager) => v.job != null && v.mode === 'work' && v.inside === v.job;
/** Working right now = at a work spot doing the job (not walking to it or between spots). */
const working = (v: Villager) => onShift(v) && v.dest == null;
/** At work in any way: on shift, out hauling, or building at a site (for the info panels). */
export const atWork = (v: Villager) => v.job != null &&
  (onShift(v) || v.haul != null || (v.site != null && v.inside === v.site));
const workHours = (s: GameState) => { const h = hourOf(s); return h >= CONFIG.schedule.workStart && h < CONFIG.schedule.workEnd; };

/** Game hours a villager needs to walk from home to work (used to decide when they wake up). */
export function commuteHours(s: GameState, v: Villager): number {
  const home = getB(s, v.home ?? s.hallId), job = getB(s, v.job);
  if (!home || !job) return 0;
  const a = doorPt(home), b = doorPt(job);
  const tiles = Math.hypot(a.x - b.x, a.y - b.y) * 1.35 + 1.5; // paths aren't straight
  const secs = tiles / CONFIG.villagers.walkTilesPerSecond + CONFIG.villagers.doorFadeSeconds * 2;
  return (secs * 24) / CONFIG.time.dayLengthSeconds + CONFIG.schedule.wakeBufferHours;
}

/** How many of a farm's workers carry food to the granary. */
export function carrierCount(b: Building): number {
  if (!b.workers.length) return 0;
  return Math.max(1, Math.ceil(b.workers.length * CONFIG.food.carrierShare));
}

/**
 * Estimated share of a farm's output lost to delivery trips
 * (carriers don't farm while walking to the granary and back).
 */
export function deliveryLoss(s: GameState, b: Building): number {
  const d = def(b.kind);
  if (!d.farmStorage || !b.workers.length) return 0;
  const g = nearestStorage(s, b, false);
  if (!g) return 0;
  const p = doorPt(b), q = doorPt(g);
  const tiles = Math.hypot(p.x - q.x, p.y - q.y) * 1.35 + 2;
  const V = CONFIG.villagers, S = CONFIG.schedule;
  const tripSecs = (2 * tiles) / V.walkTilesPerSecond + V.dropOffSeconds + V.doorFadeSeconds * 2;
  const shiftSecs = ((S.workEnd - S.workStart) / 24) * CONFIG.time.dayLengthSeconds;
  const away = Math.min(1, (CONFIG.food.deliveriesPerDay * tripSecs) / shiftSecs);
  return (carrierCount(b) * away) / b.workers.length * (1 - techBonus(s, 'carry'));
}
export const presentWorkers = (s: GameState, b: Building) =>
  b.workers.reduce((a, id) => {
    const v = s.villagers.find(q => q.id === id);
    return a + (v && v.job === b.id && atWork(v) ? 1 : 0);
  }, 0);

/** Output multiplier for a building with `n` workers (0..1+bonus). */
export function efficiency(s: GameState, b: Building, n: number): number {
  const d = def(b.kind);
  if (!d.workers) return 0;
  if (d.minWorkers && n < d.minWorkers) return 0;
  return Math.min(1, n / d.workers) * (1 + grassBonus(s, b));
}

export function grassBonus(s: GameState, b: Building): number {
  const d = def(b.kind);
  if (!d.grassBonus) return 0;
  let grass = 0;
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++)
      if (s.tiles[y * s.w + x] === GRASS) grass++;
  return d.grassBonus * grass / (b.w * b.h);
}

/** Expected daily rates from the current job assignments (what the HUD shows). */
export function rates(s: GameState) {
  let food = 0, gold = 0;
  const goods: Record<Good, number> = { wood: 0, stone: 0, furniture: 0 };
  for (const b of s.buildings) {
    const d = def(b.kind), o = d.output;
    if (!o || !isBuilt(b)) continue;
    const e = efficiency(s, b, b.workers.length) * (1 - deliveryLoss(s, b));
    food += (o.food ?? 0) * e * outMul(s, 'food'); gold += (o.gold ?? 0) * e * outMul(s, 'gold');
    for (const g of GOODS) {
      const n = (o[g] ?? 0) * e * outMul(s, g);
      goods[g] += n;
      for (const [ig, per] of Object.entries(d.input ?? {}) as [Good, number][]) goods[ig] -= n * per; // inputs used up
    }
  }
  const eat = population(s) * CONFIG.food.perVillagerPerDay;
  const tax = civilians(s) * CONFIG.tax.goldPerVillagerPerDay * (1 + techBonus(s, 'tax')); // soldiers don't pay tax
  const upkeep = armyUpkeep(s);
  return { foodProd: food, foodEat: eat, food: food - eat, ...goods, gold: gold + tax - upkeep, tax, upkeep };
}

// ---------- building placement ----------

export interface PlaceCheck { ok: boolean; reason?: string }

export function lockReason(s: GameState, kind: BuildingKind): string | null {
  const d = def(kind);
  if (s.unlockAll && !d.comingSoon) return null; // testing cheat
  if (d.comingSoon) return 'Coming soon';
  if (d.unlockHallLevel && s.hallLevel < d.unlockHallLevel) return `Hall Lv ${d.unlockHallLevel}`;
  return null;
}

const GOOD_NAME: Record<Good, string> = { wood: 'wood', stone: 'stone', furniture: 'furniture' };

/**
 * Checks that don't depend on where the building goes (locks, limits, cost).
 * Goods must be in the stockpiles (not already promised to other building sites).
 */
export function buildCheck(s: GameState, kind: BuildingKind, free = false): PlaceCheck {
  const d = def(kind);
  const lock = lockReason(s, kind);
  if (lock) return { ok: false, reason: lock };
  if (kind === 'townHall' && s.hallId != null) return { ok: false, reason: 'Only one Town Hall' };
  if (kind !== 'townHall' && s.hallId == null) return { ok: false, reason: 'Place the Town Hall first' };
  if (d.isHouse && !s.unlockAll && houseCount(s) >= houseCap(s))
    return { ok: false, reason: 'House limit: upgrade Town Hall' };
  if (free) return { ok: true };
  for (const g of GOODS) if ((d.cost[g] ?? 0) > available(s, g) + 1e-6) return { ok: false, reason: `Not enough ${GOOD_NAME[g]}` };
  if (s.gold < (d.cost.gold ?? 0)) return { ok: false, reason: 'Not enough gold' };
  return { ok: true };
}

export const tileKind = (s: GameState, i: number): TileKind =>
  s.tiles[i] === FOREST ? 'forest' : s.tiles[i] === STONE ? 'stone' : 'grass';

export function canPlace(s: GameState, kind: BuildingKind, x: number, y: number, free = false): PlaceCheck {
  const d = def(kind);
  if (x < 0 || y < 0 || x + d.w > s.w || y + d.h > s.h) return { ok: false, reason: 'Off the map' };
  for (let ty = y; ty < y + d.h; ty++)
    for (let tx = x; tx < x + d.w; tx++) {
      const i = ty * s.w + tx;
      if (s.occ[i] !== -1) return { ok: false, reason: 'Space is taken' };
      if (!d.allowedTiles.includes(tileKind(s, i)))
        return { ok: false, reason: d.allowedTiles[0] === 'forest' ? 'Needs forest' : d.allowedTiles[0] === 'stone' ? 'Needs a stone deposit' : 'Needs grassland' };
    }
  return buildCheck(s, kind, free);
}

function setOcc(s: GameState, b: Building, val: number) {
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) s.occ[y * s.w + x] = val;
}

/**
 * Place a building. Normally it starts as a building site: gold is paid now,
 * haulers carry the materials over and wrights build it.
 * `free` = placed finished and at no cost (the Town Hall, the starting buildings, the test town).
 */
export function place(s: GameState, kind: BuildingKind, x: number, y: number, free = false): Building | null {
  free = free || kind === 'townHall';
  if (!canPlace(s, kind, x, y, free).ok) return null;
  const d = def(kind);
  if (!free) s.gold -= d.cost.gold ?? 0;
  const b: Building = {
    id: s.nextId++, kind, x, y, w: d.w, h: d.h, workers: [], residents: [], food: 0, goods: {},
    site: free ? null : { work: 0, since: s.tick },
  };
  s.buildings.push(b);
  setOcc(s, b, b.id);
  s.version++;
  if (kind === 'townHall') {
    s.hallId = b.id;
    s.tick = Math.round((TICKS_PER_DAY * CONFIG.schedule.startHour) / 24); // start in the morning
    // the founding villagers arrive and gather around the new hall
    b.food = CONFIG.start.food;
    for (let i = 0; i < CONFIG.start.villagers; i++) {
      const a = (i / CONFIG.start.villagers) * Math.PI * 2;
      const v = makeVillager(s, x + d.w / 2 + Math.cos(a) * 2.6, y + d.h / 2 + Math.sin(a) * 2.6);
      s.villagers.push(v);
    }
    // they bring a Stockpile with their starting goods and a Wright's Lodge, ready to use
    const pile = placeNear(s, 'stockpile', x + d.w + 2, y + 1) ?? placeNear(s, 'stockpile', x - 4, y + 1);
    if (pile) { pile.goods.wood = CONFIG.start.wood; if (CONFIG.start.stone) pile.goods.stone = CONFIG.start.stone; }
    placeNear(s, 'wrights', x - 3, y + 1);
  }
  if (!b.site) finishBuilding(s, b);
  // anyone standing where the new building went steps out to its doorstep
  const ex = entryTile(s, b);
  for (const v of s.villagers) {
    v.goalKey = ''; // everyone re-plans their route
    if (v.inside != null || ex < 0) continue;
    if (v.x >= b.x && v.x < b.x + b.w && v.y >= b.y && v.y < b.y + b.h) {
      const c = centerOf(s, ex);
      v.x = v.px = c.x; v.y = v.py = c.y; v.path = []; v.way = [];
    }
  }
  assignHomes(s);
  return b;
}

/** A building is ready: it starts working (new workers join from the idle villagers). */
function finishBuilding(s: GameState, b: Building) {
  const d = def(b.kind);
  if (b.site?.upgrade) { s.hallLevel++; b.goods = {}; }
  else if (b.site) b.goods = {}; // the materials are now the building
  b.site = null;
  s.version++;
  for (const v of s.villagers) if (v.site === b.id) { v.site = pickSite(s, v)?.id ?? null; v.goalKey = ''; } // wrights move on
  if (CONFIG.autoFillWorkers && d.workers) for (let i = 0; i < d.workers; i++) if (!addWorker(s, b.id)) break;
  assignHomes(s);
}

/** Free placement at the nearest roomy spot (1-tile gap all round) to (tx, ty). */
function placeNear(s: GameState, k: BuildingKind, tx: number, ty: number, maxR = 24): Building | null {
  const d = def(k);
  const roomy = (x: number, y: number) => {
    if (!canPlace(s, k, x, y, true).ok) return false;
    for (let yy = y - 1; yy <= y + d.h; yy++) for (let xx = x - 1; xx <= x + d.w; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue;
      if (s.occ[yy * s.w + xx] !== -1) return false;
    }
    return true;
  };
  for (let r = 0; r < maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (roomy(tx + dx, ty + dy)) return place(s, k, tx + dx, ty + dy, true);
  }
  return null;
}

export function remove(s: GameState, id: number): boolean {
  const b = getB(s, id);
  if (!b || b.kind === 'townHall') return false;
  const d = def(b.kind), at = doorPt(b);
  // what comes back: a site returns everything delivered (and its gold);
  // a finished building returns part of its cost, plus whatever was stored in it
  const back: Partial<Record<Good, number>> = {};
  if (b.site) {
    for (const g of GOODS) back[g] = amountOf(b, g);
    s.gold += d.cost.gold ?? 0;
  } else {
    for (const g of GOODS) back[g] = Math.floor((d.cost[g] ?? 0) * CONFIG.removeRefund) + amountOf(b, g);
    s.gold += Math.floor((d.cost.gold ?? 0) * CONFIG.removeRefund);
  }
  for (const v of s.villagers) {
    if (v.job === id) v.job = null;   // soldiers get re-assigned to another training ground if there is one
    if (v.home === id) v.home = null;
    if (v.task?.to === id) { v.task = null; v.carry = null; }
    if (v.site === id) v.site = null;
    if (v.errandB === id) v.errandB = null;
    if (v.lastErrand === id) v.lastErrand = null;
    if (v.inside === id) { v.inside = null; v.mode = 'idle'; v.way = []; v.path = []; }
    v.goalKey = '';
  }
  setOcc(s, b, -1);
  s.buildings = s.buildings.filter(q => q !== b);
  for (const g of GOODS) if (back[g]) putInStockpiles(s, g, back[g]!, at); // (anything that doesn't fit is lost)
  s.version++;
  assignHomes(s);
  return true;
}

export function canUpgradeHall(s: GameState): PlaceCheck {
  const hall = getB(s, s.hallId);
  if (hall?.site) return { ok: false, reason: 'Already upgrading' };
  const next = CONFIG.townHall.levels[s.hallLevel];
  if (!next || !next.upgradeCost) return { ok: false, reason: 'Max level' };
  for (const g of GOODS) if ((next.upgradeCost[g] ?? 0) > available(s, g) + 1e-6) return { ok: false, reason: `Not enough ${GOOD_NAME[g]}` };
  if (s.gold < (next.upgradeCost.gold ?? 0)) return { ok: false, reason: 'Not enough gold' };
  return { ok: true };
}

/** Start upgrading the Town Hall: gold now, then haulers bring the materials and wrights do the work. */
export function upgradeHall(s: GameState): boolean {
  if (!canUpgradeHall(s).ok) return false;
  const c = CONFIG.townHall.levels[s.hallLevel].upgradeCost!;
  const hall = getB(s, s.hallId)!;
  s.gold -= c.gold ?? 0;
  hall.site = { work: 0, since: s.tick, upgrade: true };
  hall.goods = {};
  s.version++;
  return true;
}

// ---------- testing tools ----------

/** Testing: add villagers at the town hall (they move into free beds if there are any). */
export function spawnVillagers(s: GameState, n: number): boolean {
  const hall = getB(s, s.hallId);
  if (!hall) return false;
  const D = doorPt(hall);
  for (let i = 0; i < n; i++) {
    const v = makeVillager(s, D.x + (rand(s) - 0.5) * 1.5, D.y + 0.6 + rand(s) * 0.8);
    s.villagers.push(v);
  }
  assignHomes(s);
  return true;
}

/** Testing: put goods into the stockpiles. Returns how much fit. */
export function addGoods(s: GameState, g: Good, n: number): number {
  return n - putInStockpiles(s, g, n, doorPt(getB(s, s.hallId) ?? { x: s.w / 2, y: s.h / 2 } as Building));
}

/**
 * Testing: build a ready-made starter town around the Town Hall, for free.
 * Leaves a 1-tile gap around every building so there's room to walk.
 */
export function quickTown(s: GameState): number {
  const unlock = s.unlockAll;
  s.unlockAll = true;
  const cx = Math.floor(s.w / 2), cy = Math.floor(s.h / 2);
  if (s.hallId == null) place(s, 'townHall', cx - 1, cy - 1);
  const hall = getB(s, s.hallId)!;
  const hx = hall.x + 1, hy = hall.y + 1;
  // enough people for every job, plus spare idle villagers for recruiting
  spawnVillagers(s, Math.max(0, 110 - s.villagers.length));
  let built = 0;
  const plan: [BuildingKind, number, number][] = [
    ['manor', -6, -6], ['manor', -2, -7], ['longhouse', 3, -6], ['house', -7, -1], ['house', 4, -2],
    ['granary', -1, 4], ['granary', 3, 4],
    ['farm', -6, 5], ['farm', -2, 7], ['farm', 2, 7], ['farm', 6, 5],
    ['market', -5, 1], ['tavern', 7, 1], ['chapel', -9, -4],
    ['barracks', 9, -4], ['trainingGrounds', 10, 0],
    ['stockpile', 4, 2], ['stockpile', -9, 2], ['wrights', -4, -3], ['carpenter', 8, -8],
    ['lumberCamp', 0, 0], ['lumberCamp', 0, 0], ['hunter', 0, 0], ['quarry', 0, 0], ['quarry', 0, 0],
    ['well', 2, -3], ['well', -3, 3],
  ];
  for (const [k, dx, dy] of plan) if (placeNear(s, k, hx + dx, hy + dy, 26)) built++;
  // stock the stores
  for (const b of s.buildings) { const fs = def(b.kind).foodStorage; if (fs) b.food = Math.max(b.food, fs * 0.6); }
  addGoods(s, 'wood', 500); addGoods(s, 'stone', 250); addGoods(s, 'furniture', 40);
  s.unlockAll = unlock;
  s.gold += 1500;
  return built;
}

// ---------- job assignment ----------

export function addWorker(s: GameState, bid: number): boolean {
  const b = getB(s, bid);
  if (!b || !isBuilt(b)) return false;
  const cap = def(b.kind).workers ?? 0;
  if (b.workers.length >= cap) return false;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let best: Villager | null = null, bd = Infinity;
  for (const v of s.villagers) {
    if (v.job != null || v.squad != null) continue;
    const dd = Math.hypot(v.x - cx, v.y - cy);
    if (dd < bd) { bd = dd; best = v; }
  }
  if (!best) return false;
  best.job = bid; b.workers.push(best.id); best.goalKey = '';
  return true;
}

export function removeWorker(s: GameState, bid: number): boolean {
  const b = getB(s, bid);
  if (!b || !b.workers.length) return false;
  const vid = b.workers.pop()!;
  const v = s.villagers.find(q => q.id === vid);
  if (v) { v.job = null; v.goalKey = ''; v.site = null; }
  return true;
}

function assignHomes(s: GameState) {
  // keep lists in sync, then move homeless villagers into free beds
  for (const b of s.buildings) {
    b.residents = b.residents.filter(id => s.villagers.some(v => v.id === id && v.home === b.id));
    b.workers = b.workers.filter(id => s.villagers.some(v => v.id === id && v.job === b.id));
  }
  for (const v of s.villagers) {
    if (v.home != null) continue;
    const soldier = v.squad != null;
    let best: Building | null = null, bd = Infinity;
    for (const b of s.buildings) {
      const d = def(b.kind);
      if (!isBuilt(b)) continue;
      const cap = (soldier ? d.soldierBeds : d.beds) ?? 0; // soldiers live in barracks, civilians in houses
      if (b.residents.length >= cap) continue;
      const dd = Math.hypot(v.x - b.x - b.w / 2, v.y - b.y - b.h / 2);
      if (dd < bd) { bd = dd; best = b; }
    }
    if (!best) continue;
    v.home = best.id; best.residents.push(v.id); v.goalKey = '';
  }
  // soldiers train at the training grounds (their "job")
  for (const v of s.villagers) {
    if (v.squad == null || v.job != null) continue;
    let best: Building | null = null, bd = Infinity;
    for (const b of s.buildings) {
      const cap = isBuilt(b) ? def(b.kind).trainingSlots ?? 0 : 0;
      if (b.workers.length >= cap) continue;
      const dd = Math.hypot(v.x - b.x - b.w / 2, v.y - b.y - b.h / 2);
      if (dd < bd) { bd = dd; best = b; }
    }
    if (!best) continue;
    v.job = best.id; best.workers.push(v.id); v.goalKey = '';
  }
}

// ---------- military ----------

export const unitDef = (u: UnitKind) => CONFIG.military.units[u];
export const armyUpkeep = (s: GameState) =>
  s.squads.reduce((a, q) => a + unitDef(q.unit).upkeep, 0);
/** Rank index of a squad (0 Recruit, 1 Trained, ...). */
export function rankOf(q: Squad): number {
  const R = CONFIG.military.ranks;
  let r = 0;
  for (let i = 0; i < R.length; i++) if (q.trainDays >= R[i].days) r = i;
  return r;
}
export const battleReady = (q: Squad) => rankOf(q) >= 1;
export const squadName = (q: Squad) => `${unitDef(q.unit).name} #${q.num}`;

/** Why a squad can't be recruited right now (null = it can). */
export function recruitBlock(s: GameState, u: UnitKind): string | null {
  const U = unitDef(u);
  if (s.hallId == null) return 'Place the Town Hall first';
  if (!s.buildings.some(b => b.kind === 'barracks' && isBuilt(b))) return 'Build a Barracks first';
  if (idleCount(s) < U.size) return `Needs ${U.size} idle villagers`;
  const freeBeds = soldierBeds(s) - soldiers(s);
  if (freeBeds < U.size) return 'Not enough barracks space';
  if ((soldiers(s) + U.size) / population(s) > CONFIG.military.armyCap + 1e-9) return 'Army cap reached';
  if (s.gold < U.cost) return 'Not enough gold';
  return null;
}

export function recruit(s: GameState, u: UnitKind): Squad | null {
  if (recruitBlock(s, u)) return null;
  const U = unitDef(u);
  s.gold -= U.cost;
  const num = (s.nextSquadNum[u] ?? 0) + 1;
  s.nextSquadNum[u] = num;
  const q: Squad = { id: s.nextId++, unit: u, num, members: [], trainDays: 0 };
  // idle villagers nearest the barracks sign up
  const bar = s.buildings.find(b => b.kind === 'barracks' && isBuilt(b))!;
  const idle = s.villagers.filter(v => v.job == null && v.squad == null)
    .sort((a, b) => dist(a, doorPt(bar)) - dist(b, doorPt(bar)))
    .slice(0, U.size);
  for (const v of idle) {
    v.squad = q.id; v.unit = u; q.members.push(v.id);
    v.home = null; v.goalKey = ''; // move out of their house into the barracks
  }
  s.squads.push(q);
  assignHomes(s);
  return q;
}

/** Disband a squad: its soldiers become idle villagers again. */
export function disband(s: GameState, id: number): boolean {
  const q = s.squads.find(x => x.id === id);
  if (!q) return false;
  for (const v of s.villagers) {
    if (v.squad !== id) continue;
    v.squad = null; v.unit = null; v.job = null; v.home = null; v.goalKey = '';
  }
  s.squads = s.squads.filter(x => x !== q);
  assignHomes(s);
  return true;
}

/** Once a day: each squad gains training equal to the share of its soldiers who trained today. */
function updateTraining(s: GameState) {
  for (const q of s.squads) {
    const ms = s.villagers.filter(v => v.squad === q.id);
    if (!ms.length) continue;
    q.trainDays += ms.filter(v => v.trained).length / ms.length * (1 + techBonus(s, 'train'));
  }
  for (const v of s.villagers) v.trained = false;
}

// ---------- happiness ----------

/** Happiness 0..100 (shown only; it has no effect yet). */
export function happinessOf(s: GameState, v: Villager): number {
  const H = CONFIG.happiness, day = dayNumber(s);
  let h = H.base;
  if (v.tavernDay >= day - 1) h += H.tavernVisit;
  if (v.chapelDay >= day - 1) h += H.chapelVisit;
  const home = getB(s, v.home);
  if (home && nearChapel(s, home)) h += H.nearChapel;
  if (home && nearWell(s, home)) h += H.nearWell;
  return Math.min(100, h);
}
export function nearChapel(s: GameState, b: Building): boolean {
  return s.buildings.some(c => {
    const r = isBuilt(c) ? def(c.kind).happyRadius : 0;
    return !!r && Math.hypot(c.x + c.w / 2 - b.x - b.w / 2, c.y + c.h / 2 - b.y - b.h / 2) <= r;
  });
}
export function nearWell(s: GameState, b: Building): boolean {
  return s.buildings.some(c => {
    const r = isBuilt(c) ? def(c.kind).nearBonusRadius : 0;
    return !!r && Math.hypot(c.x + c.w / 2 - b.x - b.w / 2, c.y + c.h / 2 - b.y - b.h / 2) <= r;
  });
}
export const avgHappiness = (s: GameState) =>
  s.villagers.length ? s.villagers.reduce((a, v) => a + happinessOf(s, v), 0) / s.villagers.length : 0;

// ---------- doors and walking around buildings ----------

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const centerOf = (s: GameState, i: number): Pt => ({ x: (i % s.w) + 0.5, y: Math.floor(i / s.w) + 0.5 });
const tileOf = (s: GameState, p: Pt) =>
  clamp(Math.floor(p.y), 0, s.h - 1) * s.w + clamp(Math.floor(p.x), 0, s.w - 1);

export function doorPt(b: Building): Pt {
  const d = DOORS[b.kind];
  return { x: b.x + d.x, y: b.y + d.y };
}

/** The free tile villagers use to reach a building's door (normally the one right in front). */
export function entryTile(s: GameState, b: Building): number {
  const D = doorPt(b);
  const fx = Math.floor(D.x), fy = b.y + b.h;
  if (fy < s.h && s.occ[fy * s.w + fx] === -1) return fy * s.w + fx;
  let best = -1, bd = Infinity;
  for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
    const i = y * s.w + x;
    if (s.occ[i] !== -1) continue;
    const d = Math.hypot(x + 0.5 - D.x, y + 0.5 - D.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Walking points along a building's edge from (the edge point nearest) `from` to `to`. */
function edgeWalk(b: Building, from: Pt, to: Pt): Pt[] {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, W = b.w, H = b.h, L = 2 * (W + H);
  const Q = { x: clamp(from.x, x0, x1), y: clamp(from.y, y0, y1) };
  const E = { x: clamp(to.x, x0, x1), y: clamp(to.y, y0, y1) };
  const per = (p: Pt) => { // distance along the edge, clockwise from the top-left corner
    const dt = Math.abs(p.y - y0), dr = Math.abs(p.x - x1), db = Math.abs(p.y - y1), dl = Math.abs(p.x - x0);
    const m = Math.min(dt, dr, db, dl);
    if (m === dt) return p.x - x0;
    if (m === dr) return W + (p.y - y0);
    if (m === db) return W + H + (x1 - p.x);
    return 2 * W + H + (y1 - p.y);
  };
  // snap a point that is inside the building onto its nearest edge
  const snap = (p: Pt): Pt => {
    const dt = p.y - y0, dr = x1 - p.x, db = y1 - p.y, dl = p.x - x0;
    const m = Math.min(dt, dr, db, dl);
    if (m <= 0) return p;
    if (m === dt) return { x: p.x, y: y0 };
    if (m === dr) return { x: x1, y: p.y };
    if (m === db) return { x: p.x, y: y1 };
    return { x: x0, y: p.y };
  };
  const q = snap(Q), e = snap(E);
  const corners = [{ x: x1, y: y0, t: W }, { x: x1, y: y1, t: W + H }, { x: x0, y: y1, t: 2 * W + H }, { x: x0, y: y0, t: 0 }];
  const tq = per(q), te = per(e);
  const cw = (((te - tq) % L) + L) % L;
  const pts: Pt[] = [q];
  const goCw = cw <= L - cw;
  const span = goCw ? cw : L - cw;
  corners
    .map(c => ({ c, d: goCw ? (((c.t - tq) % L) + L) % L : (((tq - c.t) % L) + L) % L }))
    .filter(o => o.d > 1e-6 && o.d < span - 1e-6)
    .sort((a, b) => a.d - b.d)
    .forEach(o => pts.push({ x: o.c.x, y: o.c.y }));
  pts.push(e);
  return pts;
}

/**
 * Walking points from a spot next to a building, along the building's edge
 * (the little gap between buildings), to its front door.
 */
export function laneToDoor(b: Building, from: Pt): Pt[] {
  const D = doorPt(b);
  return [...edgeWalk(b, from, { x: D.x, y: b.y + b.h }), D];
}

/** Nearest free tile touching a building, measured from point p. */
function nearestFreeAround(s: GameState, b: Building, p: Pt): number {
  let best = -1, bd = Infinity;
  for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    const i = y * s.w + x;
    if (s.occ[i] !== -1) continue;
    const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------- villager behaviour ----------

function desired(s: GameState, v: Villager): { kind: Villager['goalKind']; b: number | null } {
  const S = CONFIG.schedule;
  if (v.task) return { kind: 'deliver', b: v.task.to };
  if (v.haul) return v.haul.stage === 'fetch' ? { kind: 'fetch', b: v.haul.from } : { kind: 'drop', b: v.haul.to };
  const h = hourOf(s);
  const day = dayNumber(s);
  const home = v.home ?? s.hallId;
  const sleepAt = S.sleepStart + v.jitter;
  if (v.job != null) {
    // wake up just early enough to be at work when it starts
    if (h >= S.workStart - commuteHours(s, v) && h < S.workEnd) {
      if (v.site != null && h >= S.workStart) return { kind: 'site', b: v.site }; // wright: off to the building site
      return { kind: 'job', b: v.job };
    }
  } else if (h >= S.workStart && h < S.workEnd) return { kind: 'wander', b: null };
  // free time: a route of short errands (picked in updateVillager), then home
  if (h >= S.workEnd && h < sleepAt && v.errandB != null) return { kind: 'errand', b: v.errandB };
  void day;
  return { kind: 'home', b: home };
}

const walkHours = (tiles: number) =>
  (((tiles * 1.35 + 1) / CONFIG.villagers.walkTilesPerSecond) * 24) / CONFIG.time.dayLengthSeconds;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Free time: pick the next place to visit. Random, but nearer places are more likely
 * (so villagers chain short hops), never the same place twice in a row, and only
 * if there's still time to get home before bed. No suitable place = route finished.
 */
function pickNextErrand(s: GameState, v: Villager) {
  const E = CONFIG.errands, S = CONFIG.schedule;
  const day = dayNumber(s), h = hourOf(s), sleepAt = S.sleepStart + v.jitter;
  const home = getB(s, v.home ?? s.hallId);
  const stayHours = ((E.stayMaxSeconds + 2) * 24) / CONFIG.time.dayLengthSeconds; // plan with the longest stay
  const opts: { b: Building; w: number }[] = [];
  for (const b of s.buildings) {
    if (b.id === v.lastErrand || b.id === v.job || b.id === v.inside || !isBuilt(b)) continue; // not where they just were / work
    const ok = (E.places.includes('home') && b.id === v.home) ||
      (b.kind !== 'house' && b.kind !== 'longhouse' && b.kind !== 'manor' && E.places.includes(b.kind));
    if (!ok) continue;
    const d1 = dist(v, doorPt(b)), d2 = home ? dist(doorPt(b), doorPt(home)) : 0;
    if (h + walkHours(d1) + stayHours + walkHours(d2) > sleepAt) continue; // no time to also get home
    opts.push({ b, w: 1 / (d1 + E.nearbyPreference) });
  }
  if (!opts.length) { v.errandB = null; v.errandDay = day; return; }
  // the granary (to eat) is always the 1st or 2nd stop, when one can be reached in time
  let pool = opts;
  if (E.granaryFirstOrSecond && v.ateAt !== day) {
    const gran = opts.filter(o => o.b.kind === 'granary');
    if (gran.length && (v.stops === 1 || (v.stops === 0 && hash(v.id, day, 7) < 0.5))) pool = gran;
  }
  v.stops++;
  let r = rand(s) * pool.reduce((a, o) => a + o.w, 0);
  for (const o of pool) { r -= o.w; if (r <= 0) { v.errandB = o.b.id; return; } }
  v.errandB = pool[pool.length - 1].b.id;
}

/** A spot to mill around in front of a place (on open ground). */
function millSpot(s: GameState, b: Building): Pt | null {
  const R = CONFIG.errands.millRange, D = doorPt(b);
  for (let k = 0; k < 6; k++) {
    const x = D.x + (rand(s) - 0.5) * 2 * R, y = b.y + b.h + 0.35 + rand(s) * R;
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= s.w || yi >= s.h || s.occ[yi * s.w + xi] !== -1) continue;
    return { x, y };
  }
  return null;
}

/** Nearest building that can store food and still has room. */
/** Can this building take food right now? (Granaries need a keeper assigned.) */
export const storageOpen = (b: Building) => {
  const d = def(b.kind);
  return !!d.foodStorage && isBuilt(b) && (!d.workers || b.workers.length > 0);
};

function nearestStorage(s: GameState, from: Building, needRoom = true): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of s.buildings) {
    const cap = def(b.kind).foodStorage ?? 0;
    if (!cap || !storageOpen(b) || (needRoom && cap - b.food < 1)) continue;
    const d = Math.hypot(b.x + b.w / 2 - from.x - from.w / 2, b.y + b.h / 2 - from.y - from.h / 2);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function startGoal(s: GameState, v: Villager) {
  v.dest = null; v.way = []; v.path = []; v.approach = false; v.timer = 0;
  const target = v.goalKind === 'wander' ? undefined : getB(s, v.goalB);
  if (v.goalKind !== 'wander' && !target) { v.mode = 'idle'; return; }
  if (target && v.inside === target.id) { // already there
    if (v.goalKind === 'fetch' || v.goalKind === 'drop' || v.goalKind === 'site') { arrive(s, v); return; }
    if (v.goalKind === 'job') { // e.g. a hauler who just dropped goods at their own stockpile: back to work
      if (v.mode !== 'work') { v.mode = 'work'; v.timer = 0; pickWorkSpot(s, v, target); }
      return;
    }
    if (v.mode === 'walk') v.mode = 'inside';
    return;
  }

  // leave the current building through its door
  let start = tileOf(s, v);
  const cur = getB(s, v.inside);
  if (cur) {
    if (v.task) v.carry = 'basket';
    else if (v.haul?.stage === 'carry') v.carry = v.haul.good;
    else if (v.mode === 'work') v.carry = cur.kind === 'market' ? 'coins' : null;
    else v.carry = null;
    const ex = entryTile(s, cur);
    if (ex >= 0) {
      const out = laneToDoor(cur, centerOf(s, ex)).reverse();
      if (v.mode !== 'work') { v.x = out[0].x; v.y = out[0].y; v.px = v.x; v.py = v.y; }
      v.way = [...out, centerOf(s, ex)];
      start = ex;
    }
  }
  else {
    // standing on a building's edge (e.g. changed plans on the way to a door):
    // follow the edge to the nearest open tile instead of cutting through the building
    const ob = getB(s, s.occ[start]);
    if (ob) {
      const ft = nearestFreeAround(s, ob, v);
      if (ft >= 0) { v.way = [...edgeWalk(ob, v, centerOf(s, ft)), centerOf(s, ft)]; start = ft; }
    }
  }
  v.inside = null;
  v.mode = 'walk';

  const sx = start % s.w, sy = Math.floor(start / s.w);
  if (target) {
    const en = entryTile(s, target);
    let p = en >= 0 ? findPathToTile(s, sx, sy, en) : null;
    if (!p) p = findPathToRect(s, sx, sy, target.x, target.y, target.w, target.h);
    v.path = p ?? [];
    v.approach = v.goalKind !== 'errand'; // errands happen in front of the place, not inside
  } else {
    // wander: stroll to a random free spot in front of the town hall
    const hall = getB(s, s.hallId);
    if (!hall) { v.mode = 'idle'; v.timer = 2; return; }
    const R = CONFIG.villagers.wanderRadius;
    for (let k = 0; k < 10; k++) {
      const x = Math.floor(hall.x - R + rand(s) * (hall.w + 2 * R));
      const y = Math.floor(hall.y + hall.h + rand(s) * R);
      if (x < 0 || y < 0 || x >= s.w || y >= s.h || s.occ[y * s.w + x] !== -1) continue;
      const p = findPathToTile(s, sx, sy, y * s.w + x);
      if (p) { v.path = p; break; }
    }
  }
}

function arrive(s: GameState, v: Villager) {
  const b = getB(s, v.goalB);
  if (v.goalKind === 'wander' || !b) {
    v.mode = 'idle';
    v.timer = CONFIG.villagers.idlePauseMin + rand(s) * (CONFIG.villagers.idlePauseMax - CONFIG.villagers.idlePauseMin);
    return;
  }
  if (v.goalKind === 'errand') { // mill around in front of the place for a few seconds
    const E = CONFIG.errands;
    v.mode = 'idle'; v.dest = null;
    v.timer = E.stayMinSeconds + rand(s) * (E.stayMaxSeconds - E.stayMinSeconds);
    return;
  }
  v.inside = b.id;
  if (v.goalKind === 'job' || v.goalKind === 'site') {
    v.mode = 'work'; v.carry = null; v.timer = 0;
    pickWorkSpot(s, v, b);
    return;
  }
  if (v.goalKind === 'fetch' || v.goalKind === 'drop') { // hauler: loading up / unloading
    v.mode = 'inside';
    v.timer = v.goalKind === 'fetch' ? CONFIG.haul.pickupSeconds : CONFIG.haul.dropSeconds;
    return;
  }
  // home, hall or granary: step through the doorway
  v.mode = 'inside';
  if (v.goalKind === 'deliver') { v.timer = CONFIG.villagers.dropOffSeconds; return; }
  v.carry = null;
  v.timer = CONFIG.schedule.hallVisitSeconds;
}

function pickWorkSpot(s: GameState, v: Villager, b: Building) {
  if (b.site && !b.site.upgrade) {
    // building site: hammer away somewhere around its edge
    const t = rand(s), side = (rand(s) * 4) | 0;
    const pts = [
      { x: b.x + 0.2 + t * (b.w - 0.4), y: b.y + 0.25 },
      { x: b.x + 0.2 + t * (b.w - 0.4), y: b.y + b.h - 0.2 },
      { x: b.x + 0.2, y: b.y + 0.3 + t * (b.h - 0.5) },
      { x: b.x + b.w - 0.2, y: b.y + 0.3 + t * (b.h - 0.5) },
    ];
    v.dest = pts[side];
  } else if (b.kind === 'townHall' && b.site) {
    v.dest = { x: b.x + 0.3 + rand(s) * (b.w - 0.6), y: b.y + 0.3 + rand(s) * (b.h - 0.6) };
  } else if (b.kind === 'stockpile' || b.kind === 'quarry') {
    v.dest = { x: b.x + 0.35 + rand(s) * (b.w - 0.7), y: b.y + 0.4 + rand(s) * (b.h - 0.75) };
  } else if (b.kind === 'lumberCamp' || b.kind === 'hunter') {
    // chop (or hunt) at the edge of the clearing
    const side = (rand(s) * 4) | 0;
    const t = rand(s);
    const pts = [
      { x: b.x + 0.25 + t * (b.w - 0.5), y: b.y + 0.2 },
      { x: b.x + 0.25 + t * (b.w - 0.5), y: b.y + b.h - 0.25 },
      { x: b.x + 0.2, y: b.y + 0.25 + t * (b.h - 0.5) },
      { x: b.x + b.w - 0.2, y: b.y + 0.25 + t * (b.h - 0.5) },
    ];
    v.dest = pts[side];
  } else if (b.kind === 'trainingGrounds') {
    v.dest = { x: b.x + 0.45 + rand(s) * (b.w - 0.9), y: b.y + 0.5 + rand(s) * (b.h - 1.1) };
  } else if (b.kind === 'granary') {
    const D = doorPt(b);
    v.dest = { x: D.x + (rand(s) - 0.5) * 0.5, y: D.y - 0.05 };
  } else if (b.kind === 'farm') {
    const row = (rand(s) * 6) | 0;
    v.dest = { x: b.x + 0.35 + rand(s) * (b.w - 0.7), y: b.y + 0.37 + row * ((b.h - 0.66) / 5) };
  } else {
    v.dest = { x: b.x + 0.3 + rand(s) * (b.w - 0.6), y: b.y + b.h - 0.3 - rand(s) * 0.3 };
  }
}

function moveToward(v: Villager, tx: number, ty: number, dist: number): boolean {
  const dx = tx - v.x, dy = ty - v.y;
  const d = Math.hypot(dx, dy);
  if (d <= dist) { v.x = tx; v.y = ty; return true; }
  v.x += (dx / d) * dist; v.y += (dy / d) * dist;
  v.dir = Math.atan2(dy, dx);
  v.step += dist * 9;
  return false;
}

function edgeIndex(s: GameState, a: number, b: number): number {
  let ax = a % s.w, ay = Math.floor(a / s.w), bx = b % s.w, by = Math.floor(b / s.w);
  if (by < ay || (by === ay && bx < ax)) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  const dx = bx - ax, dy = by - ay;
  const dir = dy === 0 ? (dx === 1 ? 0 : -1) : dy === 1 ? (dx === 0 ? 1 : dx === 1 ? 2 : dx === -1 ? 3 : -1) : -1;
  return dir < 0 ? -1 : (ay * s.w + ax) * 4 + dir;
}

/** Carriers take everything waiting at the farm to the nearest granary a few times per workday. */
function maybeDeliver(s: GameState, v: Villager): boolean {
  const b = getB(s, v.inside);
  if (!b || !def(b.kind).farmStorage || b.food < 1) return false; // farms and hunters
  if (b.workers.indexOf(v.id) >= carrierCount(b)) return false; // not a carrier
  const S = CONFIG.schedule, F = CONFIG.food;
  const day = dayNumber(s);
  if (v.deliveryDay !== day) { v.deliveryDay = day; v.deliveries = 0; }
  const prog = (hourOf(s) - S.workStart) / (S.workEnd - S.workStart);
  if (v.deliveries >= F.deliveriesPerDay || prog < (v.deliveries + 0.75) / F.deliveriesPerDay) return false;
  v.deliveries++;
  const g = nearestStorage(s, b);
  if (!g) return false;
  const lb = Math.min(b.food, (def(g.kind).foodStorage ?? 0) - g.food);
  b.food -= lb;
  v.task = { to: g.id, lb };
  v.goalKey = ''; // re-plan: go deliver
  return true;
}

/** Night fast-forward: true while it's night and every villager is indoors asleep. */
export function allAsleep(s: GameState): boolean {
  if (s.hallId == null) return false;
  const h = hourOf(s), S = CONFIG.schedule;
  if (!(h >= S.sleepStart || h < S.workStart)) return false;
  return s.villagers.every(v => v.mode === 'inside' && v.goalKind === 'home');
}

/** Keep a hauler's trip and a wright's site valid (buildings can be removed, work can end). */
function checkTasks(s: GameState, v: Villager) {
  const h = v.haul;
  if (h) {
    if (h.stage === 'fetch') {
      // a trip not started yet is dropped if either end is gone, the job ended, or work is over
      if (!getB(s, h.from) || !getB(s, h.to) || v.job == null || !workHours(s)) { v.haul = null; if (v.mode !== 'inside') v.goalKey = ''; }
    } else if (!getB(s, h.to) || (h.kind === 'site' && !getB(s, h.to)!.site)) {
      // carrying goods to somewhere that's gone (or a site that got finished): to the nearest stockpile instead
      retarget(s, v); v.goalKey = '';
    }
  }
  if (v.site != null) {
    const b = getB(s, v.site);
    if (!b || !b.site || v.job == null) { v.site = null; v.goalKey = ''; }
  }
}

/** An idle hauler or wright at their workplace looks for something to do. */
function think(s: GameState, v: Villager) {
  const jb = getB(s, v.job);
  if (!jb || !workHours(s)) return;
  v.think -= DT;
  if (v.think > 0) return;
  if (jb.kind === 'stockpile') {
    v.think = CONFIG.haul.thinkSeconds * (0.8 + rand(s) * 0.4);
    const h = pickHaul(s, v);
    if (h) { v.haul = h; v.goalKey = ''; }
  } else if (jb.kind === 'wrights') {
    v.think = CONFIG.build.thinkSeconds * (0.8 + rand(s) * 0.4);
    // at a site that has run out of materials (or at the lodge): look for work
    const cur = getB(s, v.site);
    if (cur && siteWorkable(s, cur)) return;
    const b = pickSite(s, v);
    if (b && b.id !== v.site) { v.site = b.id; v.goalKey = ''; }
    else if (!b && v.site != null) { v.site = null; v.goalKey = ''; } // nothing to build: back to the lodge
  }
}

function updateVillager(s: GameState, v: Villager) {
  v.px = v.x; v.py = v.y;
  checkTasks(s, v);
  // free time: start (or continue) the evening route of errands
  {
    const S = CONFIG.schedule, h = hourOf(s);
    if (h >= S.workEnd && h < S.sleepStart + v.jitter && !v.task) {
      const day = dayNumber(s);
      if (v.evening !== day) { v.evening = day; v.stops = 0; } // a new evening
      if (v.errandB == null && v.errandDay !== day) pickNextErrand(s, v);
    } else if (v.errandB != null) v.errandB = null; // free time is over
  }
  const want = desired(s, v);
  const key = want.kind + ':' + want.b;
  if (key !== v.goalKey) {
    v.goalKey = key; v.goalKind = want.kind; v.goalB = want.b;
    startGoal(s, v);
  }
  const P = CONFIG.paths;
  const fade = DT / CONFIG.villagers.doorFadeSeconds;
  v.vis = v.mode === 'inside' ? Math.max(0, v.vis - fade) : Math.min(1, v.vis + fade);
  let speed = CONFIG.villagers.walkTilesPerSecond * DT;

  switch (v.mode) {
    case 'inside': {
      if ((v.goalKind === 'fetch' || v.goalKind === 'drop') && v.haul) {
        v.timer -= DT;
        if (v.timer > 0) return;
        if (v.goalKind === 'fetch') haulPickUp(s, v);
        else haulDrop(s, v);
        if (!v.haul && workHours(s) && v.job != null) {
          // done (or nothing to pick up): pick the next job from here, no need to walk back to the stockpile first
          const next = pickHaul(s, v);
          if (next) v.haul = next;
        }
        v.goalKey = ''; // re-plan
        return;
      }
      if (v.goalKind === 'deliver' && v.task) {
        v.timer -= DT;
        if (v.timer <= 0) { // put the food in storage, then head back to work
          const g = getB(s, v.task.to), farm = getB(s, v.job);
          if (g && !storageOpen(g)) { // keeper was unassigned meanwhile: take it to the next open store
            const alt = nearestStorage(s, g);
            if (alt) { v.task.to = alt.id; v.goalKey = ''; return; }
          }
          const room = g && storageOpen(g) ? (def(g.kind).foodStorage ?? 0) - g.food : 0;
          const put = Math.max(0, Math.min(room, v.task.lb));
          if (g) g.food += put;
          if (farm && v.task.lb > put) farm.food += v.task.lb - put; // didn't fit: back to the farm
          v.task = null; v.carry = null;
        }
        return;
      }
      if (v.goalKind === 'hall') {
        v.timer -= DT;
        if (v.timer <= 0) v.hallDay = dayNumber(s);
      }
      return;
    }
    case 'walk': {
      const ti = tileOf(s, v);
      const roadBonus = P.roadSpeedBonus + techBonus(s, 'roads');
      if (roadBonus && s.wear[ti] >= 1) speed *= 1 + roadBonus;
      if (v.way.length) {
        if (moveToward(v, v.way[0].x, v.way[0].y, speed)) v.way.shift();
      } else if (v.path.length) {
        const n = v.path[0];
        if (s.occ[n] !== -1) { startGoal(s, v); return; } // something got built in the way
        const c = centerOf(s, n);
        if (moveToward(v, c.x, c.y, speed)) v.path.shift();
      } else if (v.approach) {
        v.approach = false;
        const b = getB(s, v.goalB);
        if (b) v.way = laneToDoor(b, { x: v.x, y: v.y });
      } else {
        arrive(s, v);
      }
      break;
    }
    case 'work': {
      if (maybeDeliver(s, v)) break;
      think(s, v);
      if (v.timer > 0) { v.timer -= DT; break; }
      if (v.dest) {
        const Wk = CONFIG.work;
        if (moveToward(v, v.dest.x, v.dest.y, speed * 0.45)) { v.dest = null; v.timer = Wk.atSpotMin + rand(s) * (Wk.atSpotMax - Wk.atSpotMin); }
      } else {
        const b = getB(s, v.inside);
        if (b) pickWorkSpot(s, v, b); else v.goalKey = '';
      }
      break;
    }
    case 'idle': {
      if (v.goalKind === 'errand') {
        v.timer -= DT;
        if (v.timer <= 0) { // done here: on to the next place (or home)
          const eb = getB(s, v.errandB), day = dayNumber(s);
          if (eb?.kind === 'granary') v.ateAt = day;
          if (eb?.kind === 'tavern') v.tavernDay = day;
          if (eb?.kind === 'chapel') v.chapelDay = day;
          v.lastErrand = v.errandB; v.errandB = null; v.dest = null;
          pickNextErrand(s, v);
          break;
        }
        if (v.dest) {
          if (moveToward(v, v.dest.x, v.dest.y, speed * 0.35)) v.dest = null;
        } else if (rand(s) < 0.04) { // pause a moment, then drift somewhere else nearby
          const b = getB(s, v.goalB);
          if (b) v.dest = millSpot(s, b);
        }
        break;
      }
      if (v.goalKind !== 'wander') { v.goalKey = ''; break; } // lost: re-plan
      if (v.timer > 0) { v.timer -= DT; break; }
      startGoal(s, v); // stroll somewhere else
      break;
    }
  }

  // foot traffic: count every step from one open tile to the next (any kind of walking)
  const ti = tileOf(s, v);
  if (ti !== v.lastTile) {
    const prev = v.lastTile;
    v.lastTile = ti;
    if (prev >= 0 && s.occ[ti] === -1 && s.occ[prev] === -1) {
      const e = edgeIndex(s, prev, ti);
      if (e >= 0) s.edgeToday[e] += P.trafficPerStep;
    }
  }
}

// ---------- births ----------

/** Why no babies are being born right now (null = births are happening). */
export function birthBlock(s: GameState): string | null {
  if (rates(s).food <= 0) return 'Food is going down';
  if (foodStored(s) <= 0) return 'Granary is empty';
  if (beds(s) <= civilians(s)) return 'No free beds';
  return null;
}

/** Expected births per day right now. */
export function birthRate(s: GameState): number {
  if (birthBlock(s)) return 0;
  let r = 0;
  for (const b of s.buildings) {
    const cap = def(b.kind).beds ?? 0;
    if (cap && b.residents.length < cap) r += CONFIG.births.chancePerHousePerDay * (1 + techBonus(s, 'births'));
  }
  return r;
}

// ---------- the tick ----------

/**
 * Once a night: roads move slowly toward how busy each link has been lately.
 * At most one level up every few days, one level down every few days, and a
 * gap between the up and down thresholds so roads don't flicker.
 */
function updateRoads(s: GameState) {
  const P = CONFIG.paths;
  const up = [P.faint, P.trail, P.road];
  let changed = false;
  const n = s.edgeToday.length;
  for (let e = 0; e < n; e++) {
    const avg = (s.edgeAvg[e] = s.edgeAvg[e] * (1 - P.dailyAverage) + s.edgeToday[e] * P.dailyAverage);
    s.edgeToday[e] = 0;
    if (avg < 0.01) s.edgeAvg[e] = 0;
    const L = s.edgeLevel[e];
    if (s.edgeAge[e] < 250) s.edgeAge[e]++;
    if (L < 3 && avg >= up[L] && s.edgeAge[e] >= P.upgradeDays) {
      s.edgeLevel[e] = L + 1; s.edgeAge[e] = 0; changed = true;
    } else if (L > 0 && avg < up[L - 1] * P.downFactor && s.edgeAge[e] >= P.downgradeDays) {
      s.edgeLevel[e] = L - 1; s.edgeAge[e] = 0; changed = true;
    }
  }
  if (!changed) return;
  // tile wear (for pathfinding): the best road touching each tile
  s.wear.fill(0);
  const W = s.w, D = [[1, 0], [0, 1], [1, 1], [-1, 1]];
  for (let e = 0; e < n; e++) {
    const L = s.edgeLevel[e];
    if (!L) continue;
    const a = e >> 2, d = D[e & 3];
    const b = a + d[1] * W + d[0];
    const w = L / 3;
    if (w > s.wear[a]) s.wear[a] = w;
    if (b >= 0 && b < s.wear.length && w > s.wear[b]) s.wear[b] = w;
  }
  s.roadVersion++;
}

export function tick(s: GameState) {
  if (s.hallId == null) return; // nothing happens until the Town Hall is placed
  s.tick++;

  for (const v of s.villagers) updateVillager(s, v);

  // production happens only for workers who are actually working at a spot in their building
  const S = CONFIG.schedule;
  const shift = ((S.workEnd - S.workStart) / 24) * TICKS_PER_DAY * CONFIG.work.busyShare;
  const present = new Map<number, number>();
  const hr = hourOf(s);
  const building = new Map<number, number>(); // wrights hammering at each site
  if (hr >= S.workStart && hr < S.workEnd) // work only counts during working hours
    for (const v of s.villagers) {
      if (v.job != null && onShift(v)) {
        if (v.squad != null) v.trained = true; // soldiers at the training grounds
        if (working(v)) present.set(v.job, (present.get(v.job) ?? 0) + 1);
      }
      if (v.site != null && v.mode === 'work' && v.inside === v.site && v.dest == null)
        building.set(v.site, (building.get(v.site) ?? 0) + 1);
    }
  for (const b of s.buildings) {
    const d = def(b.kind), o = d.output;
    if (!o || !isBuilt(b)) continue;
    const e = efficiency(s, b, present.get(b.id) ?? 0);
    if (!e) continue;
    // farm food waits at the farm until a farmer carries it to a granary
    if (o.food) b.food = Math.min(d.farmStorage ?? Infinity, b.food + (o.food * e * outMul(s, 'food')) / shift);
    s.gold += ((o.gold ?? 0) * e * outMul(s, 'gold')) / shift;
    // goods wait on the building's shelf for haulers; a full shelf (or no supplies) stops the work
    const g = madeHere(b);
    if (g) {
      let n = ((o[g] ?? 0) * e * outMul(s, g)) / shift;
      n = Math.max(0, Math.min(n, (d.shelf ?? Infinity) - amountOf(b, g)));
      for (const [ig, per] of Object.entries(d.input ?? {}) as [Good, number][]) n = Math.min(n, amountOf(b, ig) / per);
      for (const [ig, per] of Object.entries(d.input ?? {}) as [Good, number][]) b.goods[ig] = amountOf(b, ig) - n * per;
      if (n > 0) b.goods[g] = amountOf(b, g) + n;
    }
  }
  // building sites: wrights turn the delivered materials into the building
  const perTick = 24 / TICKS_PER_DAY; // game hours per tick
  for (const [id, n] of building) {
    const b = getB(s, id);
    if (!b?.site) continue;
    const need = siteHours(s, b);
    b.site.work = Math.min(need * siteMaterials(s, b), b.site.work + n * perTick);
    if (b.site.work >= need - 1e-6) finishBuilding(s, b);
  }
  // everyone eats from storage (fullest store first), slowly, during free time only
  const pop = population(s);
  const freeTicks = ((S.sleepStart - S.workEnd) / 24) * TICKS_PER_DAY;
  let need = hr >= S.workEnd && hr < S.sleepStart ? (pop * CONFIG.food.perVillagerPerDay) / freeTicks : 0;
  const stores = s.buildings.filter(b => def(b.kind).foodStorage && b.food > 0).sort((a, b) => b.food - a.food);
  for (const b of stores) {
    if (need <= 0) break;
    const take = Math.min(b.food, need);
    b.food -= take; need -= take;
  }
  s.gold += (civilians(s) * CONFIG.tax.goldPerVillagerPerDay * (1 + techBonus(s, 'tax'))) / TICKS_PER_DAY; // taxes (soldiers don't pay)
  s.gold = Math.max(0, s.gold - armyUpkeep(s) / TICKS_PER_DAY);              // army upkeep

  // births: need a food surplus, food in the granary, and a free bed
  if (!birthBlock(s)) {
    const p = CONFIG.births.chancePerHousePerDay * (1 + techBonus(s, 'births')) / TICKS_PER_DAY;
    for (const b of s.buildings) {
      const cap = def(b.kind).beds ?? 0;
      if (!cap || b.residents.length >= cap) continue;
      if (rand(s) < p) {
        const D = doorPt(b);
        const v = makeVillager(s, D.x, D.y);
        v.home = b.id; b.residents.push(v.id);
        v.inside = b.id; v.mode = 'inside'; v.vis = 0;
        v.goalKind = 'home'; v.goalB = b.id; v.goalKey = 'home:' + b.id;
        s.villagers.push(v);
        s.births++;
      }
    }
  }

  // research at the Town Hall
  if (s.research) {
    s.research.days += 1 / TICKS_PER_DAY;
    const t = techDef(s.research.id);
    if (!t || s.research.days >= t.days) { if (t) s.techs.push(t.id); s.research = null; }
  }

  // roads change once a night
  if (dayNumber(s) !== s.roadDay && hr >= CONFIG.paths.updateHour && hr < S.workStart) {
    s.roadDay = dayNumber(s);
    updateRoads(s);
    updateTraining(s);
  }

  if (s.tick % 20 === 0) assignHomes(s);
}

/** Rebuild derived data after loading a save. */
export function rebuildDerived(s: GameState) {
  s.occ = new Int32Array(s.w * s.h).fill(-1);
  for (const b of s.buildings) setOcc(s, b, b.id);
}

// ---------- tech tree ----------

export const techDef = (id: string): TechDef | undefined => CONFIG.tech.list.find(t => t.id === id);
export const hasTech = (s: GameState, id: string) => s.techs.includes(id);

/** Sum of an effect over all researched techs (e.g. 0.3 = +30%). */
export function techBonus(s: GameState, key: TechEffect): number {
  let v = 0;
  for (const id of s.techs) v += techDef(id)?.effect[key] ?? 0;
  return v;
}
/** Output multiplier from techs for farms (food), lumber camps (wood) and markets (gold). */
export function outMul(s: GameState, res: 'food' | 'gold' | Good): number {
  if (res === 'stone' || res === 'furniture') return 1;
  return 1 + techBonus(s, res === 'food' ? 'farm' : res === 'wood' ? 'wood' : 'market');
}

/** Why a tech can't be researched right now (null = it can). */
export function techBlock(s: GameState, id: string): string | null {
  const t = techDef(id);
  if (!t) return 'Unknown';
  if (hasTech(s, id)) return 'Done';
  if (s.research?.id === id) return 'Researching';
  if (s.hallId == null) return 'Needs a Town Hall';
  const missing = t.needs.filter(n => !hasTech(s, n));
  if (missing.length) return 'Needs ' + missing.map(n => techDef(n)?.name ?? n).join(', ');
  if (!s.unlockAll && s.hallLevel < t.hall) return `Hall Lv ${t.hall}`;
  if (s.research) return 'Busy researching';
  if (s.gold < t.cost) return `Needs ${t.cost} gold`;
  return null;
}

export function startResearch(s: GameState, id: string): boolean {
  if (techBlock(s, id)) return false;
  s.gold -= techDef(id)!.cost;
  s.research = { id, days: 0 };
  return true;
}

/** Stop the current research and get the gold back. */
export function cancelResearch(s: GameState): boolean {
  if (!s.research) return false;
  s.gold += techDef(s.research.id)?.cost ?? 0;
  s.research = null;
  return true;
}
