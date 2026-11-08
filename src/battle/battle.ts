import { CONFIG, type UnitKind } from '../config';

// =====================================================================
//  Battle simulation. Left side (0) = you, right side (1) = enemy.
//  Every soldier has their own HP; squads move together, soldiers pick
//  their own targets. Knows nothing about drawing.
// =====================================================================

export type Side = 0 | 1;
export const BATTLE_TPS = 20;
const DT = 1 / BATTLE_TPS;

export interface SquadSetup { unit: UnitKind; rank: number }
export interface BattleSetup { sides: [SquadSetup[], SquadSetup[]] }

export interface BSoldier {
  id: number; side: Side; squad: number; unit: UnitKind; slot: number;
  x: number; y: number; px: number; py: number;
  hp: number; cd: number; target: number; retarget: number;
  dir: number; step: number; flash: number; lunge: number; lungeDir: number;
  dead: boolean; fled: boolean; charge: boolean; idle: number; moved: number;
}
export interface BSquad {
  id: number; side: Side; unit: UnitKind; rank: number; num: number;
  members: number[]; cx: number; cy: number; face: number;
  target: number; retarget: number;
  broken: boolean; brokenAt: number; fleeing: boolean; gone: boolean;
  lastFight: number; // last time any member attacked (to avoid stand-offs)
}
export interface Arrow { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; target: number; dmg: number; hit: boolean; side: Side }

export interface BattleState {
  t: number; rng: number; W: number; H: number;
  soldiers: BSoldier[]; squads: BSquad[]; arrows: Arrow[];
  over: boolean; winner: Side | -1;
}

function rand(b: BattleState) {
  let t = (b.rng = (b.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const unitSize = (u: UnitKind) => CONFIG.military.units[u].size;
const stats = (u: UnitKind) => CONFIG.battle.units[u];

/** Formation slot of soldier i in a squad, relative to its centre, facing +x. */
function slotOffset(u: UnitKind, i: number): { dx: number; dy: number } {
  const S = CONFIG.battle.spacing;
  if (u === 'cavalry') return { dx: 0, dy: (i - 2) * S * 1.4 };
  const file = i % 5, rank = Math.floor(i / 5);
  return { dx: -rank * S, dy: (file - 2) * S };
}

// ---------- setup ----------

export function createBattle(setup: BattleSetup, seed = 1): BattleState {
  const B = CONFIG.battle;
  const b: BattleState = { t: 0, rng: seed, W: B.fieldW, H: B.fieldH, soldiers: [], squads: [], arrows: [], over: false, winner: -1 };
  let sid = 1, qid = 1;
  for (const side of [0, 1] as Side[]) {
    const list = setup.sides[side];
    // default formation: swordsmen in front, spearmen behind, archers at the back, cavalry on the flanks
    const lines: Record<string, SquadSetup[]> = { swordsmen: [], spearmen: [], archers: [], cavalry: [] };
    for (const q of list) lines[q.unit].push(q);
    const depthX: Record<string, number> = { swordsmen: 5.2, spearmen: 4.2, archers: 3.0 };
    const nums: Partial<Record<UnitKind, number>> = {};
    const place = (q: SquadSetup, x: number, y: number) => {
      const fx = side === 0 ? x : b.W - x, face = side === 0 ? 1 : -1;
      nums[q.unit] = (nums[q.unit] ?? 0) + 1;
      const sq: BSquad = { id: qid++, side, unit: q.unit, rank: q.rank, num: nums[q.unit]!, members: [], cx: fx, cy: y, face, target: -1, retarget: 0, broken: false, brokenAt: 0, fleeing: false, gone: false, lastFight: 0 };
      for (let i = 0; i < unitSize(q.unit); i++) {
        const o = slotOffset(q.unit, i);
        const s: BSoldier = {
          id: sid++, side, squad: sq.id, unit: q.unit, slot: i,
          x: fx + o.dx * face, y: y + o.dy, px: 0, py: 0, hp: B.soldierHp, cd: rand(b) * 1.5, target: -1, retarget: rand(b),
          dir: face > 0 ? 0 : Math.PI, step: rand(b) * 10, flash: 0, lunge: 0, lungeDir: 0,
          dead: false, fled: false, charge: true, idle: 0, moved: 0,
        };
        s.px = s.x; s.py = s.y;
        b.soldiers.push(s); sq.members.push(s.id);
      }
      b.squads.push(sq);
    };
    const gap = B.squadGap;
    for (const u of ['swordsmen', 'spearmen', 'archers'] as UnitKind[]) {
      const n = lines[u].length;
      lines[u].forEach((q, i) => place(q, depthX[u], b.H / 2 + (i - (n - 1) / 2) * gap));
    }
    // cavalry: alternate top and bottom flank, further out each time
    const inf = Math.max(lines.swordsmen.length, lines.spearmen.length, lines.archers.length, 1);
    lines.cavalry.forEach((q, i) => {
      const out = (inf - 1) / 2 * gap + 3.2 + Math.floor(i / 2) * 2.8;
      const y = Math.min(b.H - 1, Math.max(1, b.H / 2 + (i % 2 ? out : -out)));
      place(q, 4.6, y);
    });
  }
  return b;
}

// ---------- helpers ----------

const alive = (s: BSoldier) => !s.dead && !s.fled;
export const squadHp = (b: BattleState, q: BSquad) => {
  let hp = 0;
  for (const id of q.members) { const s = b.soldiers[id - 1]; if (alive(s)) hp += s.hp; }
  return hp / (q.members.length * CONFIG.battle.soldierHp);
};
export const squadAlive = (b: BattleState, q: BSquad) => q.members.filter(id => alive(b.soldiers[id - 1])).length;

function damageOf(att: BSoldier, attSq: BSquad, def: BSoldier, defSq: BSquad, melee: boolean): number {
  const B = CONFIG.battle, A = stats(att.unit), D = stats(def.unit);
  let dmg = att.unit === 'archers' && melee ? A.meleeDamage ?? A.damage : A.damage;
  dmg *= 1 + B.rankDamage * attSq.rank;
  if (A.strongVs.includes(def.unit)) dmg *= B.counterBonus;
  dmg *= 1 - Math.min(0.6, D.defense + B.rankDefense * defSq.rank);
  return dmg;
}

// ---------- the tick ----------

export function stepBattle(b: BattleState) {
  if (b.over) return;
  const B = CONFIG.battle;
  b.t += DT;
  const sq = (id: number) => b.squads[id - 1];
  const so = (id: number) => b.soldiers[id - 1];

  // marching pace of each side's infantry (they keep together like one army)
  const marchPace = [Infinity, Infinity];
  for (const q of b.squads) if (!q.gone && !q.fleeing && q.unit !== 'cavalry') marchPace[q.side] = Math.min(marchPace[q.side], stats(q.unit).speed);

  // squads: health, breaking, fleeing, choosing a target squad, moving
  // (the order flips every step so neither side always reacts first)
  const squadOrder = Math.round(b.t * BATTLE_TPS) % 2 ? b.squads : [...b.squads].reverse();
  for (const q of squadOrder) {
    if (q.gone) continue;
    const hp = squadHp(b, q);
    if (squadAlive(b, q) === 0) { q.gone = true; continue; }
    if (!q.broken && hp <= B.breakAt) { q.broken = true; q.brokenAt = b.t; }
    if (q.broken && !q.fleeing && b.t - q.brokenAt >= B.fightAfterBreakSeconds) q.fleeing = true;
    // centre = average position of living members
    let sx = 0, sy = 0, n = 0;
    for (const id of q.members) { const s = so(id); if (alive(s)) { sx += s.x; sy += s.y; n++; } }
    const ax = sx / n, ay = sy / n;
    if (q.fleeing) continue;
    q.retarget -= DT;
    if (q.retarget <= 0 || q.target < 0 || sq(q.target).gone || sq(q.target).fleeing) {
      q.retarget = 1;
      let best = -1, bd = Infinity;
      for (const e of b.squads) {
        if (e.side === q.side || e.gone || e.fleeing) continue;
        let d = Math.hypot(e.cx - ax, e.cy - ay);
        if (q.unit !== 'cavalry' && q.unit !== 'archers') d += Math.abs(e.cy - ay) * 1.5; // infantry: the enemy in front of us
        if (stats(q.unit).strongVs.includes(e.unit)) d -= 5; // prefer what we're good against
        if (stats(e.unit).strongVs.includes(q.unit)) d += 2; // avoid what beats us
        if (d < bd) { bd = d; best = e.id; }
      }
      q.target = best;
    }
    const tq = q.target > 0 ? sq(q.target) : null;
    const U = stats(q.unit);
    if (!tq) continue;
    const dx = tq.cx - q.cx, dy = tq.cy - q.cy, d = Math.hypot(dx, dy);
    q.face = dx >= 0 ? 1 : -1;
    let move = 0;
    if (q.unit === 'archers') {
      // archers always fight: advance until the nearest enemy squad is well within range, never retreat
      let nd = Infinity;
      for (const e of b.squads) if (e.side !== q.side && !e.gone && !e.fleeing) nd = Math.min(nd, Math.hypot(e.cx - q.cx, e.cy - q.cy));
      const idle = b.t - q.lastFight > 4;
      if (nd > (U.range ?? 7) * (idle ? 0.4 : 0.55)) move = U.speed;
    } else if (q.unit === 'cavalry') {
      if (d > 1.0) move = U.speed;
    } else {
      // infantry march together (at the pace of the slowest infantry squad on their side)
      // until their front rank meets the enemy's front, then hold the line
      if (Math.abs(dx) > U.reach + 0.25) move = b.t - q.lastFight < 2 ? U.speed : marchPace[q.side];
      else if (Math.abs(dy) > 0.8 && b.t - q.lastFight > 1) { // enemy is beside us (another lane): shift over
        q.cy += Math.sign(dy) * U.speed * DT;
        q.cy = Math.max(0.5, Math.min(b.H - 0.5, q.cy));
      }
    }
    if (move && d > 0.01) {
      if (q.unit === 'cavalry') { q.cx += (dx / d) * move * DT; q.cy += (dy / d) * move * DT; }
      else {
        // infantry and archers keep their lane: march straight ahead, sliding only a little sideways
        q.cx += Math.sign(dx) * move * DT;
        q.cy += Math.max(-0.25, Math.min(0.25, dy)) * move * DT;
      }
      q.cx = Math.max(0.5, Math.min(b.W - 0.5, q.cx)); q.cy = Math.max(0.5, Math.min(b.H - 0.5, q.cy));
    }
  }

  // spatial grid for nearby lookups
  const grid = new Map<number, BSoldier[]>();
  const key = (x: number, y: number) => (Math.floor(y) + 4) * 1000 + Math.floor(x) + 4;
  for (const s of b.soldiers) if (alive(s)) { const k = key(s.x, s.y); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s); }
  const nearby = (x: number, y: number, r: number, f: (s: BSoldier) => void) => {
    const R = Math.ceil(r);
    for (let gy = Math.floor(y) - R; gy <= Math.floor(y) + R; gy++) for (let gx = Math.floor(x) - R; gx <= Math.floor(x) + R; gx++) {
      const a = grid.get((gy + 4) * 1000 + gx + 4); if (a) for (const s of a) f(s);
    }
  };

  // living members' order in each squad (front rank fills first)
  const aliveIdx = new Map<number, number>();
  for (const q of b.squads) {
    let n = 0;
    for (const id of q.members) if (alive(so(id))) aliveIdx.set(id, n++);
  }

  // soldiers (hits are collected and applied together, so neither side strikes first)
  const hits: { t: BSoldier; dmg: number }[] = [];
  const order = b.soldiers.length;
  const start = Math.floor(rand(b) * order);
  for (let k = 0; k < order; k++) {
    const s = b.soldiers[(start + k) % order];
    if (!alive(s)) continue;
    s.px = s.x; s.py = s.y;
    if (s.flash > 0) s.flash -= DT;
    if (s.lunge > 0) s.lunge -= DT;
    s.cd -= DT;
    const q = sq(s.squad), U = stats(s.unit);
    let speed = U.speed;
    const goTo = (tx: number, ty: number, sp: number, stopAt = 0.05) => {
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (d <= stopAt) return false;
      const m = Math.min(d - stopAt, sp * DT);
      s.x += (dx / d) * m; s.y += (dy / d) * m;
      s.dir = Math.atan2(dy, dx); s.step += m * 30; s.moved += m;
      return true;
    };
    if (q.fleeing) { // run off our own side of the field
      goTo(s.side === 0 ? -3 : b.W + 3, s.y, speed * B.fleeSpeed);
      if (s.x < -1 || s.x > b.W + 1) s.fled = true;
      continue;
    }
    // my place in the formation: living members fill the front rank first,
    // so when someone in front falls, the soldier behind steps up into the gap
    const slotIdx = aliveIdx.get(s.id) ?? s.slot;
    const slot = slotOffset(s.unit, slotIdx);
    const sx = q.cx + slot.dx * q.face, sy = q.cy + slot.dy;
    const isArcher = s.unit === 'archers', isCav = s.unit === 'cavalry';
    const backRank = !isCav && slotIdx >= 5;
    // spears are long: spearmen in the second rank can still jab past the front rank
    const meleeReach = U.reach + (s.unit === 'spearmen' && backRank ? B.spacing : 0);

    // pick an enemy soldier to fight (refreshed often)
    s.retarget -= DT;
    let t = s.target > 0 ? so(s.target) : null;
    if (!t || !alive(t) || s.retarget <= 0) {
      s.retarget = 0.25 + rand(b) * 0.15;
      const engaged = b.t - q.lastFight < 3;
      // archers: anyone in bow range; others: nearby, or further away once the squad is fighting
      const radius = isArcher ? U.range ?? 7 : isCav ? 8 : engaged ? 6 : B.aggroRange;
      let best: BSoldier | null = null, bd = Infinity;
      nearby(s.x, s.y, radius, e => {
        if (e.side === s.side || !alive(e)) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d > radius) return;
        // prefer enemies in front of my own place in the line (keeps the line tidy)
        let score = d + (isArcher || isCav ? 0 : Math.abs(e.y - sy) * 0.8);
        if (e.squad === q.target) score -= 0.5;
        if (U.strongVs.includes(e.unit)) score -= 0.8;
        if (score < bd) { bd = score; best = e; }
      });
      t = best; s.target = t ? (t as BSoldier).id : -1;
    }

    if (t) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      const meleeNow = !isArcher || d < 1.1;
      const reach = meleeNow ? meleeReach : U.range ?? 7;
      if (d <= reach) {
        s.dir = Math.atan2(t.y - s.y, t.x - s.x);
        if (s.cd <= 0) {
          const tq = sq(t.squad);
          let dmg = damageOf(s, q, t, tq, meleeNow);
          if (isCav && s.charge && s.moved > 2) { // charge! (spearmen brace: no charge bonus against them)
            if (t.unit !== 'spearmen') dmg *= U.chargeBonus ?? 1;
            s.charge = false;
          }
          dmg *= 0.85 + rand(b) * 0.3;
          if (meleeNow) {
            s.lunge = 0.18; s.lungeDir = s.dir;
            if (rand(b) < B.hitChance) hits.push({ t, dmg });
          } else {
            const dur = d / B.arrowSpeed;
            b.arrows.push({ x: s.x, y: s.y, sx: s.x, sy: s.y - 0.2, tx: t.x + (rand(b) - 0.5) * 0.3, ty: t.y, t: 0, dur, target: t.id, dmg, hit: rand(b) < B.arrowHitChance, side: s.side });
          }
          s.cd = U.cooldown * (0.85 + rand(b) * 0.3);
        }
        s.idle = 0; s.moved = 0; q.lastFight = b.t;
        // archers keep up with their squad while shooting; infantry drift back toward their spot in the line
        if (isArcher && !meleeNow) goTo(sx, sy, speed * 0.6);
        else if (!isCav) goTo(s.x + (sx - s.x) * 0.3, s.y + (sy - s.y) * 0.3, speed * 0.3, 0.05);
      } else if (isCav) {
        goTo(t.x, t.y, speed, reach * 0.9);
      } else if (meleeNow) {
        // step up to the enemy, but stay roughly in my lane of the line
        const fx = t.x - Math.sign(t.x - s.x || q.face) * reach * 0.85;
        const fy = backRank && s.unit === 'spearmen' ? sy : t.y * 0.3 + sy * 0.7; // keep to my lane of the line
        goTo(fx, fy, speed, 0.05);
      } else {
        goTo(sx, sy, speed * 1.1); // archer out of range: keep with the squad
      }
    } else {
      // no one to fight: keep formation (cavalry regain their charge after a breather)
      s.idle += DT;
      if (s.idle > 3) s.charge = true;
      goTo(sx, sy, Math.max(speed, stats(q.unit).speed) * 1.3);
      if (!isCav) s.step = q.cx * 30 * q.face; // march in step with the rest of the squad
    }
  }

  for (const h of hits) {
    if (h.t.dead) continue;
    h.t.hp -= h.dmg; h.t.flash = 0.12;
    if (h.t.hp <= 0) { h.t.dead = true; h.t.hp = 0; }
  }

  // keep soldiers from standing on top of each other
  // (all pushes are worked out first, then applied, so neither side is favoured)
  const push = new Map<BSoldier, [number, number]>();
  for (const s of b.soldiers) {
    if (!alive(s)) continue;
    let px = 0, py = 0;
    nearby(s.x, s.y, 1, e => {
      if (e === s || !alive(e)) return;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy), min = e.unit === 'cavalry' || s.unit === 'cavalry' ? 0.42 : 0.3;
      if (d > 0.001 && d < min) { const k = (min - d) * 0.25; px += (dx / d) * k; py += (dy / d) * k; }
    });
    if (px || py) push.set(s, [px, py]);
  }
  for (const [s, [px, py]] of push) { s.x += px; s.y = Math.max(0.3, Math.min(b.H - 0.3, s.y + py)); }

  // arrows in flight
  for (const a of b.arrows) {
    a.t += DT;
    const k = Math.min(1, a.t / a.dur);
    a.x = a.sx + (a.tx - a.sx) * k; a.y = a.sy + (a.ty - a.sy) * k - Math.sin(k * Math.PI) * 0.6 * a.dur;
    if (k >= 1 && a.hit) {
      const t = so(a.target);
      if (alive(t)) { t.hp -= a.dmg; t.flash = 0.12; if (t.hp <= 0) { t.dead = true; t.hp = 0; } }
      a.hit = false;
    }
  }
  b.arrows = b.arrows.filter(a => a.t < a.dur + 0.6); // spent arrows stay a moment

  // end: a side with no squads left on the field (gone or fleeing) loses
  const still = [0, 1].map(sd => b.squads.some(q => q.side === sd && !q.gone && !q.fleeing));
  if (!still[0] || !still[1] || b.t >= B.maxSeconds) {
    b.over = true;
    b.winner = still[0] && !still[1] ? 0 : still[1] && !still[0] ? 1 : -1;
  }
}

/** Run a whole battle instantly (for the "run many battles" test). */
export function runBattle(setup: BattleSetup, seed: number) {
  const b = createBattle(setup, seed);
  while (!b.over) stepBattle(b);
  return b;
}
