import { CONFIG, GOODS, type Cost, type Good } from '../config';
import type { Building, GameState, Haul, Pt, Villager } from './types';
import { def, doorPt, getB } from './sim';

// =====================================================================
//  Goods, stockpiles, haulers and building sites.
//
//  Wood, stone and furniture are real things: every unit is always in
//  exactly one place: a stockpile, a work building's shelf, a building
//  site, or a hauler's arms. Haulers (Stockpile workers) move them;
//  wrights (Wright's Lodge workers) turn delivered materials into buildings.
// =====================================================================

const H = () => CONFIG.haul;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
// (worked out from CONFIG here: sim.ts and this file import each other)
const TICKS_PER_HOUR = (CONFIG.time.dayLengthSeconds * CONFIG.time.ticksPerSecond) / 24;

/** Finished (a Town Hall being upgraded still works). */
export const isBuilt = (b: Building) => !b.site || !!b.site.upgrade;
/** A finished stockpile. */
export const isStockpile = (b: Building) => !!def(b.kind).storage && isBuilt(b);
/** A building site that isn't finished yet (including a Town Hall upgrade). */
export const isSite = (b: Building) => !!b.site;

export const amountOf = (b: Building, g: Good) => b.goods[g] ?? 0;
export const goodsIn = (b: Building) => GOODS.reduce((a, g) => a + amountOf(b, g), 0);
export const roomIn = (b: Building) => (def(b.kind).storage ?? 0) - goodsIn(b);
/** The good a work building makes (wood, stone, furniture), if any. */
export function madeHere(b: Building): Good | null {
  const o = def(b.kind).output;
  if (!o) return null;
  for (const g of GOODS) if (o[g]) return g;
  return null;
}

// ---------- building sites ----------

/** What this site still needs carried to it in total (its cost, without gold). */
export function siteCost(s: GameState, b: Building): Cost {
  if (b.site?.upgrade) return CONFIG.townHall.levels[s.hallLevel]?.upgradeCost ?? {};
  return def(b.kind).cost;
}
export const siteNeed = (s: GameState, b: Building, g: Good) => siteCost(s, b)[g] ?? 0;
/** Wright-hours of work to finish this site. */
export function siteHours(s: GameState, b: Building): number {
  if (b.site?.upgrade) return CONFIG.townHall.levels[s.hallLevel]?.buildHours ?? 10;
  const d = def(b.kind);
  return d.buildHours ?? d.w * d.h * CONFIG.build.hoursPerTile;
}
/** Share (0..1) of the materials that have arrived. */
export function siteMaterials(s: GameState, b: Building): number {
  let need = 0, got = 0;
  for (const g of GOODS) { const n = siteNeed(s, b, g); need += n; got += Math.min(n, amountOf(b, g)); }
  return need ? got / need : 1;
}
/** Share (0..1) of the building work done. */
export const siteProgress = (s: GameState, b: Building) => b.site ? Math.min(1, b.site.work / siteHours(s, b)) : 1;
/** Wrights can only build as far as the materials that have arrived allow. */
export const siteWorkable = (s: GameState, b: Building) =>
  !!b.site && b.site.work < siteHours(s, b) * siteMaterials(s, b) - 1e-6;
/** Most wrights that can work on one site at once. */
export const siteWrightCap = (b: Building) => Math.max(2, Math.round(b.w * b.h * CONFIG.build.wrightsPerTile));
/** Game hours since the site was started. */
const waited = (s: GameState, b: Building) => b.site ? (s.tick - b.site.since) / TICKS_PER_HOUR : 0;

// ---------- stock totals ----------

/** Everything in finished stockpiles. */
export const stockTotal = (s: GameState, g: Good) =>
  s.buildings.reduce((a, b) => a + (isStockpile(b) ? amountOf(b, g) : 0), 0);
/** Goods promised to building sites that haven't been delivered yet. */
export function owedToSites(s: GameState, g: Good): number {
  // goods already in a hauler's arms on the way to a site are no longer in a stockpile, so they don't count twice
  const carried = new Map<number, number>();
  for (const v of s.villagers) if (v.haul?.stage === 'carry' && v.haul.good === g) carried.set(v.haul.to, (carried.get(v.haul.to) ?? 0) + v.haul.got);
  return s.buildings.reduce((a, b) => a + (b.site ? Math.max(0, siteNeed(s, b, g) - amountOf(b, g) - (carried.get(b.id) ?? 0)) : 0), 0);
}
/** What's left in the stockpiles for new building plans. */
export const available = (s: GameState, g: Good) => stockTotal(s, g) - owedToSites(s, g);
export const stockCap = (s: GameState) =>
  s.buildings.reduce((a, b) => a + (isStockpile(b) ? def(b.kind).storage! : 0), 0);

/** Put goods into stockpiles (nearest to `near` first, where there's room). Returns what didn't fit. */
export function putInStockpiles(s: GameState, g: Good, n: number, near?: Pt): number {
  const piles = s.buildings.filter(isStockpile);
  if (near) piles.sort((a, b) => dist(doorPt(a), near) - dist(doorPt(b), near));
  for (const b of piles) {
    if (n <= 0) break;
    const put = Math.min(n, roomIn(b));
    if (put <= 0) continue;
    b.goods[g] = amountOf(b, g) + put; n -= put;
  }
  return n;
}

// ---------- reservations ----------

type Res = Map<number, Partial<Record<Good, number>>>;
/** Goods haulers have promised to pick up (out) and are bringing (in), per building. */
function reservations(s: GameState): { out: Res; inc: Res } {
  const out: Res = new Map(), inc: Res = new Map();
  const add = (m: Res, id: number, g: Good, n: number) => { const r = m.get(id) ?? {}; r[g] = (r[g] ?? 0) + n; m.set(id, r); };
  for (const v of s.villagers) {
    const h = v.haul;
    if (!h) continue;
    if (h.stage === 'fetch') { add(out, h.from, h.good, h.amt); add(inc, h.to, h.good, h.amt); }
    else add(inc, h.to, h.good, h.got);
  }
  return { out, inc };
}
const resOf = (m: Res, id: number, g: Good) => m.get(id)?.[g] ?? 0;
const resAll = (m: Res, id: number) => GOODS.reduce((a, g) => a + resOf(m, id, g), 0);

/** Goods on their way to a building right now (for the info panels). */
export function incoming(s: GameState, b: Building, g: Good): number {
  let n = 0;
  for (const v of s.villagers) if (v.haul && v.haul.to === b.id && v.haul.good === g) n += v.haul.stage === 'fetch' ? v.haul.amt : v.haul.got;
  return n;
}

// ---------- haulers: picking a job ----------

/**
 * An idle hauler picks the best job. Three kinds of job:
 *   1. site:    carry materials from a stockpile to a building site      (priority 3)
 *   2. input:   carry supplies from a stockpile to a workshop            (priority 2)
 *   3. collect: carry goods from a work building's shelf to a stockpile  (priority 1, up to 3 as the shelf fills)
 * Each job's score = priority / (trip length in tiles + tripPad). The trip is
 * hauler -> pick-up -> drop-off, so nearby jobs win unless something far away
 * is more urgent. Building sites count as closer the longer they've waited.
 * Goods already promised to other haulers are left out, so two haulers never
 * go for the same load.
 */
export function pickHaul(s: GameState, v: Villager): Haul | null {
  const C = H();
  const { out, inc } = reservations(s);
  const piles = s.buildings.filter(isStockpile);
  if (!piles.length) return null;
  const here: Pt = { x: v.x, y: v.y };
  const free = (b: Building, g: Good) => Math.floor(amountOf(b, g) - resOf(out, b.id, g) + 1e-6);
  const room = (b: Building) => Math.floor(roomIn(b) - resAll(inc, b.id) + 1e-6);
  let best: Haul | null = null, bestScore = 0;
  const consider = (kind: Haul['kind'], from: Building, to: Building, good: Good, amt: number, prio: number, bonus = 0) => {
    amt = Math.floor(amt + 1e-6); // whole units only
    if (amt < 1) return;
    const trip = (dist(here, doorPt(from)) + dist(doorPt(from), doorPt(to))) * 1.3;
    const score = prio / Math.max(1, trip + C.tripPad - bonus);
    if (score > bestScore) { bestScore = score; best = { from: from.id, to: to.id, good, amt, got: 0, stage: 'fetch', kind }; }
  };
  /** The stockpile with this good that makes the shortest trip to `to`. */
  const sourceFor = (to: Building, g: Good) => {
    let src: Building | null = null, bd = Infinity;
    for (const p of piles) {
      if (p === to || free(p, g) < 1) continue;
      const d = dist(here, doorPt(p)) + dist(doorPt(p), doorPt(to));
      if (d < bd) { bd = d; src = p; }
    }
    return src;
  };

  for (const b of s.buildings) {
    const d = def(b.kind);
    // 1. building sites
    if (b.site) {
      for (const g of GOODS) {
        const rem = siteNeed(s, b, g) - amountOf(b, g) - resOf(inc, b.id, g);
        if (rem < 1) continue;
        const src = sourceFor(b, g);
        if (src) consider('site', src, b, g, Math.min(C.carry[g], rem, free(src, g)), C.sitePriority, waited(s, b) * C.sitePerHour);
      }
      if (!isBuilt(b)) continue; // nothing else happens at an unfinished building
    }
    // 2. workshop supplies
    if (d.input && b.workers.length) {
      for (const g of Object.keys(d.input) as Good[]) {
        const want = (d.inputKeep ?? 0) - amountOf(b, g) - resOf(inc, b.id, g);
        if (want < Math.min(C.carry[g], d.inputKeep ?? 0) * 0.5) continue;
        const src = sourceFor(b, g);
        if (src) consider('input', src, b, g, Math.min(C.carry[g], want, free(src, g)), C.inputPriority);
      }
    }
    // 3. collecting from shelves
    const g = madeHere(b);
    if (g && d.shelf) {
      const have = free(b, g);
      if (have < 1) continue;
      const full = amountOf(b, g) / d.shelf;
      if (have < C.carry[g] * C.minLoad && full < 0.8) continue;
      let dst: Building | null = null, bd = Infinity;
      for (const p of piles) {
        if (room(p) < 1) continue;
        const dd = dist(doorPt(b), doorPt(p));
        if (dd < bd) { bd = dd; dst = p; }
      }
      if (dst) consider('collect', b, dst, g, Math.min(C.carry[g], have, room(dst)), C.collectPriority + C.fullShelfPriority * Math.min(1, full));
    }
  }
  return best;
}

/** Hauler reached the pick-up: take the goods (as much as is really there). */
export function haulPickUp(s: GameState, v: Villager): boolean {
  const h = v.haul!, b = getB(s, h.from);
  const take = b ? Math.min(h.amt, Math.floor(amountOf(b, h.good) + 1e-6)) : 0;
  if (!b || take < 1) { v.haul = null; return false; }
  b.goods[h.good] = amountOf(b, h.good) - take;
  h.got = take; h.stage = 'carry';
  return true;
}

/** Hauler reached the drop-off: put the goods down (a full stockpile sends them to the next one). */
export function haulDrop(s: GameState, v: Villager): boolean {
  const h = v.haul!, b = getB(s, h.to);
  if (b && isStockpile(b)) {
    const put = Math.min(h.got, Math.max(0, Math.floor(roomIn(b))));
    b.goods[h.good] = amountOf(b, h.good) + put;
    h.got -= put;
    if (h.got > 0) return retarget(s, v);
  } else if (b) {
    b.goods[h.good] = amountOf(b, h.good) + h.got;
    h.got = 0;
  } else return retarget(s, v);
  v.haul = null; v.carry = null;
  return true;
}

/** Whatever a hauler is carrying has nowhere to go: take it to the nearest stockpile with room. */
export function retarget(s: GameState, v: Villager): boolean {
  const h = v.haul!;
  let dst: Building | null = null, bd = Infinity;
  for (const p of s.buildings) {
    if (!isStockpile(p) || p.id === h.to || roomIn(p) < 1) continue;
    const d = dist(v, doorPt(p));
    if (d < bd) { bd = d; dst = p; }
  }
  if (!dst) { v.haul = null; v.carry = null; return false; } // nowhere at all: it's dropped (lost)
  h.to = dst.id; h.kind = 'collect';
  return true;
}

// ---------- wrights: picking a site ----------

/**
 * An idle wright picks a site to work on: one that has materials waiting
 * (wrights can only build as far as the delivered materials allow) and
 * isn't already full of wrights. Nearest first, but every game hour a site
 * has waited makes it count as `waitBonus` tiles closer, so old sites
 * don't get forgotten. A wright sticks to a site until it's finished or
 * runs out of materials.
 */
export function pickSite(s: GameState, v: Villager): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of s.buildings) {
    if (!b.site || !siteWorkable(s, b)) continue;
    const n = s.villagers.reduce((a, q) => a + (q !== v && q.site === b.id ? 1 : 0), 0);
    if (n >= siteWrightCap(b)) continue;
    const d = dist(v, { x: b.x + b.w / 2, y: b.y + b.h / 2 }) - waited(s, b) * CONFIG.build.waitBonus;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
