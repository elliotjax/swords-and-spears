import { CONFIG, type BuildingKind } from '../config';
import { hash, noise2, rand } from './rng';
import { findPathToRect } from './path';
import { FOREST, GRASS, type Building, type GameState, type Villager } from './types';

// =====================================================================
//  The simulation ("game logic"). Knows nothing about drawing.
//  One call to tick() = one fixed step of 1/ticksPerSecond game-seconds.
// =====================================================================

export const SAVE_VERSION = 1;
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

  const s: GameState = {
    saveVersion: SAVE_VERSION,
    seed, rng: seed,
    w: W, h: H, tiles,
    traffic: new Float32Array(W * H),
    occ: new Int32Array(W * H).fill(-1),
    buildings: [], villagers: [],
    nextId: 1, tick: 0,
    wood: CONFIG.start.wood, gold: CONFIG.start.gold,
    granary: 0, hallLevel: 1, hallId: null, births: 0, version: 0,
  };
  return s;
}

function makeVillager(s: GameState, x: number, y: number): Villager {
  return {
    id: s.nextId++, x, y, px: x, py: y,
    home: null, job: null, mode: 'idle', inside: null,
    goalKey: '', goalB: null, goalKind: 'wander',
    path: [], dest: null, timer: rand(s) * 2, lastTile: -1, hallDay: -1, carry: null,
    look: { tunic: (rand(s) * 5) | 0, hair: (rand(s) * 5) | 0, skin: (rand(s) * 3) | 0 },
    jitter: rand(s) * CONFIG.schedule.personalJitter,
    ox: (rand(s) - 0.5) * 0.3, oy: (rand(s) - 0.5) * 0.3,
    dir: rand(s) * Math.PI * 2, step: rand(s) * 10,
  };
}

// ---------- queries ----------

export const dayNumber = (s: GameState) => Math.floor(s.tick / TICKS_PER_DAY) + 1;
export const dayFrac = (s: GameState) => (s.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
export const getB = (s: GameState, id: number | null) =>
  id == null ? undefined : s.buildings.find(b => b.id === id);
export const population = (s: GameState) => s.villagers.length;
export const beds = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (def(b.kind).beds ?? 0), 0);
export const houseCount = (s: GameState) =>
  s.buildings.filter(b => def(b.kind).isHouse).length;
export const houseCap = (s: GameState) =>
  CONFIG.townHall.levels[s.hallLevel - 1].houseCap;
export const idleCount = (s: GameState) => s.villagers.filter(v => v.job == null).length;
export const granaryCap = (s: GameState) =>
  Math.max(1, population(s)) * CONFIG.food.perVillagerPerDay * CONFIG.food.granaryDays;
export const presentWorkers = (s: GameState, b: Building) =>
  b.workers.reduce((a, id) => {
    const v = s.villagers.find(q => q.id === id);
    return a + (v && v.mode === 'work' && v.goalB === b.id ? 1 : 0);
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
  let food = 0, wood = 0, gold = 0;
  for (const b of s.buildings) {
    const o = def(b.kind).output;
    if (!o) continue;
    const e = efficiency(s, b, b.workers.length);
    food += (o.food ?? 0) * e; wood += (o.wood ?? 0) * e; gold += (o.gold ?? 0) * e;
  }
  const eat = population(s) * CONFIG.food.perVillagerPerDay;
  const tax = population(s) * CONFIG.tax.goldPerVillagerPerDay;
  return { foodProd: food, foodEat: eat, food: food - eat, wood, gold: gold + tax, tax };
}

// ---------- building placement ----------

export interface PlaceCheck { ok: boolean; reason?: string }

export function lockReason(s: GameState, kind: BuildingKind): string | null {
  const d = def(kind);
  if (d.comingSoon) return 'Coming soon';
  if (d.unlockHallLevel && s.hallLevel < d.unlockHallLevel) return `Hall Lv ${d.unlockHallLevel}`;
  return null;
}

/** Checks that don't depend on where the building goes (locks, limits, cost). */
export function buildCheck(s: GameState, kind: BuildingKind): PlaceCheck {
  const d = def(kind);
  const lock = lockReason(s, kind);
  if (lock) return { ok: false, reason: lock };
  if (kind === 'townHall' && s.hallId != null) return { ok: false, reason: 'Only one Town Hall' };
  if (kind !== 'townHall' && s.hallId == null) return { ok: false, reason: 'Place the Town Hall first' };
  if (d.isHouse && houseCount(s) >= houseCap(s))
    return { ok: false, reason: 'House limit: upgrade Town Hall' };
  if (s.wood < d.cost.wood) return { ok: false, reason: 'Not enough wood' };
  if (s.gold < d.cost.gold) return { ok: false, reason: 'Not enough gold' };
  return { ok: true };
}

export function canPlace(s: GameState, kind: BuildingKind, x: number, y: number): PlaceCheck {
  const d = def(kind);
  if (x < 0 || y < 0 || x + d.w > s.w || y + d.h > s.h) return { ok: false, reason: 'Off the map' };
  for (let ty = y; ty < y + d.h; ty++)
    for (let tx = x; tx < x + d.w; tx++) {
      const i = ty * s.w + tx;
      if (s.occ[i] !== -1) return { ok: false, reason: 'Space is taken' };
      const t = s.tiles[i] === FOREST ? 'forest' : 'grass';
      if (!d.allowedTiles.includes(t))
        return { ok: false, reason: d.allowedTiles[0] === 'forest' ? 'Needs forest' : 'Needs grassland' };
    }
  return buildCheck(s, kind);
}

function setOcc(s: GameState, b: Building, val: number) {
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) s.occ[y * s.w + x] = val;
}

export function place(s: GameState, kind: BuildingKind, x: number, y: number): Building | null {
  if (!canPlace(s, kind, x, y).ok) return null;
  const d = def(kind);
  s.wood -= d.cost.wood; s.gold -= d.cost.gold;
  const b: Building = { id: s.nextId++, kind, x, y, w: d.w, h: d.h, workers: [], residents: [] };
  s.buildings.push(b);
  setOcc(s, b, b.id);
  s.version++;
  if (kind === 'townHall') {
    s.hallId = b.id;
    s.tick = Math.round(TICKS_PER_DAY * (CONFIG.schedule.workStart + 0.02)); // start on a fresh morning
    // the founding villagers arrive and gather around the new hall
    s.granary = CONFIG.start.villagers * CONFIG.food.perVillagerPerDay * CONFIG.start.granaryDays;
    for (let i = 0; i < CONFIG.start.villagers; i++) {
      const a = (i / CONFIG.start.villagers) * Math.PI * 2;
      const v = makeVillager(s, x + d.w / 2 + Math.cos(a) * 2.6, y + d.h / 2 + Math.sin(a) * 2.6);
      s.villagers.push(v);
    }
  }
  // anyone standing on the new building's tiles gets nudged into re-planning
  for (const v of s.villagers) v.goalKey = '';
  assignHomes(s);
  return b;
}

export function remove(s: GameState, id: number): boolean {
  const b = getB(s, id);
  if (!b || b.kind === 'townHall') return false;
  const d = def(b.kind);
  s.wood += Math.floor(d.cost.wood * CONFIG.removeRefund);
  s.gold += Math.floor(d.cost.gold * CONFIG.removeRefund);
  for (const v of s.villagers) {
    if (v.job === id) v.job = null;
    if (v.home === id) v.home = null;
    if (v.inside === id) exitBuilding(s, v);
    v.goalKey = '';
  }
  setOcc(s, b, -1);
  s.buildings = s.buildings.filter(q => q !== b);
  s.version++;
  assignHomes(s);
  return true;
}

export function canUpgradeHall(s: GameState): PlaceCheck {
  const next = CONFIG.townHall.levels[s.hallLevel];
  if (!next || !next.upgradeCost) return { ok: false, reason: 'Max level' };
  if (s.wood < next.upgradeCost.wood) return { ok: false, reason: 'Not enough wood' };
  if (s.gold < next.upgradeCost.gold) return { ok: false, reason: 'Not enough gold' };
  return { ok: true };
}

export function upgradeHall(s: GameState): boolean {
  if (!canUpgradeHall(s).ok) return false;
  const c = CONFIG.townHall.levels[s.hallLevel].upgradeCost!;
  s.wood -= c.wood; s.gold -= c.gold; s.hallLevel++; s.version++;
  return true;
}

// ---------- job assignment ----------

export function addWorker(s: GameState, bid: number): boolean {
  const b = getB(s, bid);
  if (!b) return false;
  const cap = def(b.kind).workers ?? 0;
  if (b.workers.length >= cap) return false;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let best: Villager | null = null, bd = Infinity;
  for (const v of s.villagers) {
    if (v.job != null) continue;
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
  if (v) { v.job = null; v.goalKey = ''; }
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
    let best: Building | null = null, bd = Infinity;
    for (const b of s.buildings) {
      const cap = def(b.kind).beds ?? 0;
      if (b.residents.length >= cap) continue;
      const dd = Math.hypot(v.x - b.x - b.w / 2, v.y - b.y - b.h / 2);
      if (dd < bd) { bd = dd; best = b; }
    }
    if (!best) break;
    v.home = best.id; best.residents.push(v.id); v.goalKey = '';
  }
}

// ---------- villager behaviour ----------

function desired(s: GameState, v: Villager): { kind: Villager['goalKind']; b: number | null } {
  const S = CONFIG.schedule;
  const t = (dayFrac(s) - v.jitter + 1) % 1;
  const day = dayNumber(s);
  const home = v.home ?? s.hallId;
  if (t < S.workStart || t >= S.sleepStart) return { kind: 'home', b: home };
  if (t < S.workEnd) return v.job != null ? { kind: 'job', b: v.job } : { kind: 'wander', b: null };
  if (v.hallDay !== day && hash(v.id, day, 99) < S.hallVisitChance) return { kind: 'hall', b: s.hallId };
  return { kind: 'home', b: home };
}

function exitBuilding(_s: GameState, v: Villager) {
  v.inside = null;
  v.mode = 'idle';
}

function startGoal(s: GameState, v: Villager) {
  v.dest = null; v.path = []; v.timer = 0;
  if (v.goalKind === 'wander') {
    v.mode = 'idle';
    v.timer = rand(s) * 1.5;
    return;
  }
  const b = getB(s, v.goalB);
  if (!b) { v.mode = 'idle'; return; }
  if (v.inside === b.id) return; // already there
  if (v.inside != null) exitBuilding(s, v);
  // leaving work with goods in hand
  if (v.mode === 'work' || v.carry == null) {
    const jb = getB(s, v.job);
    if (v.mode === 'work' && jb) {
      v.carry = jb.kind === 'farm' ? 'basket' : jb.kind === 'lumberCamp' ? 'logs' : jb.kind === 'market' ? 'coins' : null;
    }
  }
  walkTo(s, v, b);
}

function walkTo(s: GameState, v: Villager, b: Building) {
  const sx = clampI(Math.floor(v.x), 0, s.w - 1), sy = clampI(Math.floor(v.y), 0, s.h - 1);
  const p = findPathToRect(s, sx, sy, b.x, b.y, b.w, b.h);
  v.mode = 'walk';
  v.path = p ?? [];
  if (!p) v.dest = { x: b.x + b.w / 2, y: b.y + b.h + 0.4 }; // fallback: walk straight
}

function arrive(s: GameState, v: Villager) {
  const b = getB(s, v.goalB);
  if (v.goalKind === 'wander' || !b) { v.mode = 'idle'; v.timer = 1 + rand(s) * 3; return; }
  if (v.goalKind === 'job') {
    v.mode = 'work'; v.carry = null; v.timer = 0;
    pickWorkSpot(s, v, b);
    return;
  }
  // home or hall: go inside
  v.mode = 'inside'; v.inside = b.id; v.carry = null;
  v.timer = CONFIG.schedule.hallVisitSeconds;
}

function pickWorkSpot(s: GameState, v: Villager, b: Building) {
  if (b.kind === 'lumberCamp') {
    // chop at the edge of the clearing
    const side = (rand(s) * 4) | 0;
    const t = rand(s);
    const pts = [
      { x: b.x + 0.2 + t * (b.w - 0.4), y: b.y + 0.15 },
      { x: b.x + 0.2 + t * (b.w - 0.4), y: b.y + b.h - 0.15 },
      { x: b.x + 0.15, y: b.y + 0.2 + t * (b.h - 0.4) },
      { x: b.x + b.w - 0.15, y: b.y + 0.2 + t * (b.h - 0.4) },
    ];
    v.dest = pts[side];
  } else if (b.kind === 'farm') {
    const row = (rand(s) * 5) | 0;
    v.dest = { x: b.x + 0.35 + rand(s) * (b.w - 0.7), y: b.y + 0.42 + row * ((b.h - 0.75) / 4) };
  } else {
    v.dest = { x: b.x + 0.3 + rand(s) * (b.w - 0.6), y: b.y + b.h - 0.3 - rand(s) * 0.4 };
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

function updateVillager(s: GameState, v: Villager) {
  v.px = v.x; v.py = v.y;
  const want = desired(s, v);
  const key = want.kind + ':' + want.b;
  if (key !== v.goalKey) {
    v.goalKey = key; v.goalKind = want.kind; v.goalB = want.b;
    startGoal(s, v);
  }
  const P = CONFIG.paths;
  let speed = CONFIG.villagers.walkTilesPerSecond * DT;

  switch (v.mode) {
    case 'inside': {
      if (v.goalKind === 'hall') {
        v.timer -= DT;
        if (v.timer <= 0) { v.hallDay = dayNumber(s); }
      }
      return;
    }
    case 'walk': {
      const ti = Math.floor(v.y) * s.w + Math.floor(v.x);
      if (P.roadSpeedBonus && ti >= 0 && ti < s.traffic.length && s.traffic[ti] >= P.road)
        speed *= 1 + P.roadSpeedBonus;
      if (v.path.length) {
        const n = v.path[0];
        if (s.occ[n] !== -1) { // something got built in the way
          const b = getB(s, v.goalB);
          if (b) walkTo(s, v, b); else v.mode = 'idle';
          return;
        }
        const tx = (n % s.w) + 0.5, ty = Math.floor(n / s.w) + 0.5;
        if (moveToward(v, tx, ty, speed)) v.path.shift();
      } else if (v.dest) {
        if (moveToward(v, v.dest.x, v.dest.y, speed)) { v.dest = null; }
      } else {
        arrive(s, v);
      }
      break;
    }
    case 'work': {
      if (v.timer > 0) { v.timer -= DT; break; }
      if (v.dest) {
        if (moveToward(v, v.dest.x, v.dest.y, speed * 0.45)) { v.dest = null; v.timer = 1.5 + rand(s) * 2.5; }
      } else {
        const b = getB(s, v.goalB);
        if (b) pickWorkSpot(s, v, b);
      }
      break;
    }
    case 'idle': {
      if (v.goalKind !== 'wander') {
        // lost (e.g. building removed): re-plan
        v.goalKey = '';
        break;
      }
      if (v.timer > 0) { v.timer -= DT; break; }
      if (v.dest) {
        if (moveToward(v, v.dest.x, v.dest.y, speed * 0.6)) { v.dest = null; v.timer = 2 + rand(s) * 4; }
      } else {
        const hall = getB(s, s.hallId);
        if (!hall) break;
        const R = CONFIG.villagers.wanderRadius;
        for (let k = 0; k < 8; k++) {
          const x = hall.x - R + rand(s) * (hall.w + 2 * R);
          const y = hall.y - R + rand(s) * (hall.h + 2 * R);
          const xi = Math.floor(x), yi = Math.floor(y);
          if (xi < 0 || yi < 0 || xi >= s.w || yi >= s.h) continue;
          if (s.occ[yi * s.w + xi] !== -1) continue;
          v.dest = { x, y };
          break;
        }
        if (!v.dest) v.timer = 1;
      }
      break;
    }
  }

  // foot traffic: wear the ground when stepping onto a new tile
  const xi = Math.floor(v.x), yi = Math.floor(v.y);
  if (xi >= 0 && yi >= 0 && xi < s.w && yi < s.h) {
    const ti = yi * s.w + xi;
    if (ti !== v.lastTile) {
      v.lastTile = ti;
      if (s.occ[ti] === -1 && v.mode !== 'work')
        s.traffic[ti] = Math.min(P.maxTraffic, s.traffic[ti] + P.trafficPerStep);
    }
  }
}

// ---------- the tick ----------

const decayFactor = Math.pow(1 - CONFIG.paths.decayPerDay, 1 / TICKS_PER_DAY);

export function tick(s: GameState) {
  if (s.hallId == null) return; // nothing happens until the Town Hall is placed
  s.tick++;

  for (const v of s.villagers) updateVillager(s, v);

  // production happens only for workers who are physically at their building
  const S = CONFIG.schedule;
  const shift = (S.workEnd - S.workStart) * TICKS_PER_DAY;
  let foodIn = 0;
  const present = new Map<number, number>();
  for (const v of s.villagers)
    if (v.mode === 'work' && v.goalB != null && v.goalB === v.job)
      present.set(v.goalB, (present.get(v.goalB) ?? 0) + 1);
  for (const b of s.buildings) {
    const o = def(b.kind).output;
    if (!o) continue;
    const e = efficiency(s, b, present.get(b.id) ?? 0);
    if (!e) continue;
    foodIn += ((o.food ?? 0) * e) / shift;
    s.wood += ((o.wood ?? 0) * e) / shift;
    s.gold += ((o.gold ?? 0) * e) / shift;
  }
  const pop = population(s);
  s.granary += foodIn - (pop * CONFIG.food.perVillagerPerDay) / TICKS_PER_DAY;
  s.granary = Math.max(0, Math.min(granaryCap(s), s.granary));
  s.gold += (pop * CONFIG.tax.goldPerVillagerPerDay) / TICKS_PER_DAY;

  // births: need a food surplus, food in the granary, and a free bed
  const r = rates(s);
  if (r.food > 0 && s.granary > 0) {
    const p = CONFIG.births.chancePerHousePerDay / TICKS_PER_DAY;
    for (const b of s.buildings) {
      const cap = def(b.kind).beds ?? 0;
      if (!cap || b.residents.length >= cap) continue;
      if (rand(s) < p) {
        const v = makeVillager(s, b.x + b.w / 2, b.y + b.h + 0.4);
        v.home = b.id; b.residents.push(v.id);
        s.villagers.push(v);
        s.births++;
      }
    }
  }

  // foot traffic slowly fades
  const t = s.traffic;
  for (let i = 0; i < t.length; i++) if (t[i] > 0) t[i] = t[i] < 0.05 ? 0 : t[i] * decayFactor;

  if (s.tick % 20 === 0) assignHomes(s);
}

function clampI(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }

/** Rebuild derived data after loading a save. */
export function rebuildDerived(s: GameState) {
  s.occ = new Int32Array(s.w * s.h).fill(-1);
  for (const b of s.buildings) setOcc(s, b, b.id);
}
