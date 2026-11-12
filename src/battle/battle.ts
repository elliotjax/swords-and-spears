import { CONFIG, type UnitKind } from '../config';
import { commanderThink, newCommander, postOf, type Commander, type Mission } from './commander';
import { pushOpTick } from './pushop';

// =====================================================================
//  Battle simulation v3. Left side (0) = you, right side (1) = enemy.
//  Every soldier has their own HP. Squads are rotating formations that
//  march as one line, charge, and then HOLD a fighting line: soldiers
//  keep their place and fight whoever is in front of them, the ends of
//  the line wrap round, the stronger squad pushes the weaker one back.
//  Morale (courage) drops from losses, flanking and friends running.
//  Knows nothing about drawing.
// =====================================================================

export type Side = 0 | 1;
export const BATTLE_TPS = 20;
const DT = 1 / BATTLE_TPS;

export interface Pt { x: number; y: number }
/**
 * One squad. x/y (optional) = where the player deployed it, and path = the arrow they drew,
 * both in "left side" field coordinates (mirrored automatically if the side starts on the right).
 */
export interface SquadSetup {
  unit: UnitKind; rank: number; x?: number; y?: number; path?: Pt[]; order?: Order;
  guard?: boolean; // with order 'hold': hold only until it makes sense to join in (a friend nearby is fighting, or it's being shot to pieces)
}
/** Bonuses from techs for one side (0.1 = +10%). */
export type SideBonus = Partial<Record<'damage' | 'armour' | 'range' | 'charge' | 'morale', number>>;
/** orders[side] = true: the player commanded this side (squads with no arrow hold their ground). */
export interface BattleSetup {
  sides: [SquadSetup[], SquadSetup[]]; bonus?: [SideBonus, SideBonus]; orders?: [boolean, boolean];
  commander?: [boolean, boolean]; // true: that side is led by the army commander (its squads' orders are ignored: the commander gives missions)
  field?: { W: number; H: number }; // fixed field size (deployment screen), instead of fitting the armies
}
/** free = the battle AI decides; hold = stand your ground and fight what comes; path = follow the drawn arrow, then free. */
export type Order = 'free' | 'hold' | 'path';

export interface BSoldier {
  id: number; side: Side; squad: number; unit: UnitKind; slot: number;
  x: number; y: number; px: number; py: number;
  hp: number; cd: number; target: number; retarget: number;
  dir: number; step: number; flash: number; lunge: number; lungeDir: number;
  dead: boolean; fled: boolean; charge: boolean; moved: number;
  stagger: number;            // knocked off balance by a charge or a heavy blow (can't strike)
  diedAt: number;             // battle time of death (for the fall animation)
  // each soldier is a little different
  skill: number;              // hit chance and blocking (about 0.8-1.2)
  nerve: number;              // bravery 0-1 (brave ones go looking for fights and don't run on their own)
  pace: number;               // how quick on their feet
  foes: number;               // enemies attacking this soldier right now (last step)
  hurtBy: number; hurtAt: number; // who last hit them, and when (they may turn on them)
  routing: boolean;           // lost their nerve and running on their own
  inMelee: boolean;           // an enemy is right next to them (last step)
}
export type SquadState = 'march' | 'formup' | 'charge' | 'melee' | 'withdraw'; // formup = squaring up to the enemy just before the charge
export interface BSquad {
  id: number; side: Side; unit: UnitKind; rank: number; num: number;
  src: number;                // index of this squad in setup.sides[side]
  members: number[];
  cx: number; cy: number;     // formation anchor (front-centre of the block)
  ang: number;                // facing angle (radians)
  mx: number; my: number;     // mass centre of living soldiers
  homeY: number;              // where in the line the squad started (keeps the line while marching)
  state: SquadState;
  target: number; retarget: number; flankSide: number;
  broken: boolean; brokenAt: number; fleeing: boolean; gone: boolean;
  brokeBy: 'hp' | 'morale' | '';
  morale: number;
  lastFight: number;          // last time any member struck
  lastHit: number;            // last time any member was hit
  firstFight: number;         // when the squad first fought (-1 = not yet)
  meleeSince: number;         // when the current melee started (-1 = not in melee)
  withdrawUntil: number; wx: number; wy: number;
  viaEdge: boolean;
  detached?: boolean;         // a detachment split off another squad during the battle
  lull: boolean;              // infantry: stepped back a pace to catch its breath between bouts (surges and lulls)
  lullAt: number;             // when the lull started
  chargeAt: number;           // infantry: when our charge last hit home (momentum for a few seconds)
  boutEnd: number;            // when this bout of fighting ends (-1 = not fighting a bout)
  cohesion: number;           // 0..1: how well the squad keeps together (drops in long fights, flank attacks and pushes; recovers in lulls)
          // a raider riding along its wing's edge to get round the enemy line (stays on it until level with its target)
  ammo: number; volley: number; // archers: arrows left (whole squad); volley unused
  hold: boolean;              // archers: standing still and shooting (only move again if the enemy gets well out of range)
  order: Order;               // the player's order (see Order)
  path: Pt[]; pathI: number;  // the drawn arrow, and the next point on it
  commit: number;             // on a path but caught in a real fight: finish this enemy squad first (-1 = none)
  commitX: number; commitY: number; // where we left the path (don't chase too far from it)
  guard: boolean; arrowsTaken: number; // 'hold' squads on guard join the fight when a friend nearby is fighting or after taking this many arrow hits
  fatigue: number;            // 0 fresh .. 1 exhausted: rises while fighting (fast while pushing), falls while resting; tired squads hit softer, parry worse, move slower
  pushSince: number;          // when the current push began (-1 = not pushing): if two squads push each other, the one that started first keeps going
  pushing: boolean;           // driving forward into the enemy right now (shoving them back; very tiring)
  bracing: boolean;           // standing firm against a push (tiring; no ground given)
  mission: Mission | null;    // what the army commander told this squad to do, and why (null = no commander)
  support: number;            // friendly squads close beside us (0, 1 or 2 sides): friends beside you steady you
  role: '' | 'guard' | 'raid'; // cavalry: guard our flank against enemy cavalry, or raid (archers, rear of the enemy line)
  waiting: boolean;           // in reserve right now: standing behind a friendly squad that's fighting, ready to step in
  inLine: boolean;            // still marching as part of the army's formation (free squads, until the enemy is close)
  lineDepth: number;          // how far behind the army's front this squad stands (keeps the formation's shape on the march)
  fwd: 1 | -1;                // which way is "forward" for this side (+x or -x)
  hitBy: Record<number, number>; // enemy squad id -> last time they hit us
}
export interface Arrow { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; target: number; dmg: number; hit: boolean; side: Side; squad: number }
/** Short-lived effects for drawing: dust from charges, blood from hits. */
export interface Fx { x: number; y: number; t: number; kind: 'dust' | 'blood' | 'clash' }
/** Marks left on the ground (blood). */
export interface Mark { x: number; y: number; k: number }

export interface BattleState {
  t: number; rng: number; W: number; H: number;
  soldiers: BSoldier[]; squads: BSquad[]; arrows: Arrow[];
  fx: Fx[]; marks: Mark[];
  over: boolean; winner: Side | -1;
  decidedAt: number;          // when one side ran out of fighting squads (-1 = not yet)
  firstContact: number;       // when the first blow of the battle landed (-1 = not yet)
  home: [number, number];     // x of each side's own edge (where they flee to)
  bonus: [SideBonus, SideBonus];
  cmd: [Commander | null, Commander | null]; // each side's army commander (null = squads follow their own orders)
  line: { front: number; lo: number; hi: number }[]; // each side's infantry line right now: how far forward, and its two ends (y)
  stats: { hits: [number, number]; flankHits: [number, number]; lulls: number }; // melee hits TAKEN by each side, and how many came from the flank/rear (for tools/battle-check)
}

function rand(b: BattleState) {
  let t = (b.rng = (b.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A fixed 0..1 number for a pair of ids (repeatable "personal taste"). */
const hash01 = (a: number, b: number) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const unitSize = (u: UnitKind) => CONFIG.military.units[u].size;
const stats = (u: UnitKind) => CONFIG.battle.units[u];
/** Body radius of a soldier (tiles); ordinary soldiers 0.13, horses 0.2, the boss 0.75. */
const bodyR = (u: UnitKind) => stats(u).radius ?? (u === 'cavalry' ? 0.2 : 0.13);
/** How much further apart two soldiers' centres are than ordinary ones when they touch (so reach and spacing work for giants). */
const ext = (a: UnitKind, z: UnitKind) => bodyR(a) + bodyR(z) - 0.26;
/** A soldier's full health. */
const maxHp = (u: UnitKind) => stats(u).hp ?? CONFIG.battle.soldierHp;
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/** Formation slot i of a squad: (forward, right) offsets from the anchor, in tiles. */
function slotLocal(u: UnitKind, i: number): { f: number; r: number; file: number; rank: number } {
  const S = CONFIG.battle.spacing;
  if (u === 'boss') return { f: 0, r: 0, file: 2, rank: 0 }; // (a lone giant stands in the middle of its slot)
  const file = i % 5, rank = Math.floor(i / 5);
  if (u === 'cavalry') return { f: -rank * S * 1.6, r: (file - 2) * S * 1.5, file, rank };
  return { f: -rank * S, r: (file - 2) * S, file, rank };
}
function slotWorld(q: BSquad, i: number) {
  const o = slotLocal(q.unit, i), c = Math.cos(q.ang), s = Math.sin(q.ang);
  const r = Math.cos(q.ang) < 0 ? -o.r : o.r; // squads facing left are a true mirror image
  return { x: q.cx + c * o.f - s * r, y: q.cy + s * o.f + c * r, file: o.file, rank: o.rank };
}
/** Half the width of a squad's front (tiles). */
export const halfFront = (u: UnitKind) => CONFIG.battle.spacing * (u === 'cavalry' ? 3.2 : 2.2);

// ---------- setup ----------

export function createBattle(setup: BattleSetup, seed = 1, swapSides = false): BattleState {
  const B = CONFIG.battle, S = B.soldier;
  // ---- layout: rows of up to maxRow squads, swordsmen in front, then spearmen, then archers; cavalry on the wings ----
  const gap = halfFront('swordsmen') * 2 + 0.6;   // squads stand side by side with a small gap
  const cavGap = halfFront('cavalry') * 2 + 0.6;
  type Spot = { q: SquadSetup; i: number; depth: number; off: number }; // depth: tiles behind the front line; off: sideways from the middle
  const layouts = ([0, 1] as Side[]).map(side => {
    const by: Record<string, { q: SquadSetup; i: number }[]> = { swordsmen: [], heavy: [], boss: [], spearmen: [], archers: [], cavalry: [] };
    setup.sides[side].forEach((q, i) => by[q.unit].push({ q, i }));
    const spots: Spot[] = [];
    let row = 0, widest = 0;
    // the front row: the boss and heavy swordsmen in the middle, plain swordsmen either side of them
    const sw = by.swordsmen, hv = by.heavy, half = Math.ceil(sw.length / 2);
    const front = [...sw.slice(0, half), ...by.boss, ...hv, ...sw.slice(half)];
    for (const u of ['swordsmen', 'spearmen', 'archers'] as UnitKind[]) {
      const list = u === 'swordsmen' ? front : by[u];
      for (let i = 0; i < list.length; i += B.maxRow) {
        const chunk = list.slice(i, i + B.maxRow);
        widest = Math.max(widest, chunk.length);
        chunk.forEach((e, k) => spots.push({ ...e, depth: row * B.rowGap, off: (k - (chunk.length - 1) / 2) * gap }));
        row++;
      }
    }
    const infHalf = Math.max(1, widest) * gap / 2;
    // cavalry: two wings, filling outward then backward
    const cav = by.cavalry, perWing = Math.ceil(cav.length / 2);
    const across = Math.max(1, Math.min(3, Math.ceil(perWing / 3)));
    cav.forEach((e, i) => {
      const wing = i % 2 ? 1 : -1, k = Math.floor(i / 2);
      const col = k % across, r = Math.floor(k / across);
      spots.push({ ...e, depth: 0.6 + r * B.rowGap * 1.3, off: wing * (infHalf + 0.9 + cavGap * (col + 0.5)) });
    });
    const cavCols = cav.length ? across : 0;
    const halfW = infHalf + (cavCols ? 0.9 + cavGap * cavCols : 0);
    const depth = Math.max(0, ...spots.map(p => p.depth));
    return { spots, halfW, depth };
  });
  const H = setup.field?.H ?? Math.max(B.fieldH, Math.ceil(Math.max(layouts[0].halfW, layouts[1].halfW) * 2 + 4));
  const frontX = 2.5 + Math.max(layouts[0].depth, layouts[1].depth);
  const W = setup.field?.W ?? Math.max(B.fieldW, Math.ceil(frontX * 2 + B.armyGap));
  const b: BattleState = {
    t: 0, rng: seed, W, H, soldiers: [], squads: [], arrows: [], fx: [], marks: [],
    over: false, winner: -1, decidedAt: -1, firstContact: -1, home: [-3, W + 3],
    bonus: setup.bonus ?? [{}, {}],
    cmd: [setup.commander?.[0] ? newCommander(0) : null, setup.commander?.[1] ? newCommander(1) : null],
    line: [{ front: -Infinity, lo: 0, hi: 0 }, { front: -Infinity, lo: 0, hi: 0 }],
    stats: { hits: [0, 0], flankHits: [0, 0], lulls: 0 },
  };
  if (swapSides) b.home = [W + 3, -3];
  let sid = 1, qid = 1;
  const pick = (r: [number, number]) => r[0] + rand(b) * (r[1] - r[0]);
  for (const side of [0, 1] as Side[]) {
    const nums: Partial<Record<UnitKind, number>> = {};
    const onLeft = (side === 0) !== swapSides;
    const face = onLeft ? 0 : Math.PI;
    const ordered = !!setup.orders?.[side], led = !!setup.commander?.[side];
    const mx = (x: number) => onLeft ? x : b.W - x;
    const place = (q: SquadSetup, src: number, x: number, y: number) => {
      const fx = mx(x);
      nums[q.unit] = (nums[q.unit] ?? 0) + 1;
      const sq: BSquad = {
        id: qid++, side, unit: q.unit, rank: q.rank, num: nums[q.unit]!, src, members: [],
        cx: fx, cy: y, ang: face, mx: fx, my: y, homeY: y, state: 'march', target: -1, retarget: 0, flankSide: 0,
        broken: false, brokenAt: 0, fleeing: false, gone: false, brokeBy: '',
        morale: B.morale.start, lastFight: -99, lastHit: -99, firstFight: -1, meleeSince: -1,
        viaEdge: false, lull: false, lullAt: -9, chargeAt: -9, boutEnd: -1, cohesion: 1, withdrawUntil: 0, wx: 0, wy: 0, ammo: q.unit === 'archers' ? B.archerAmmo * unitSize(q.unit) : 0, volley: 0, hold: false, hitBy: {},
        order: led ? 'free' : q.order ?? (!ordered ? 'free' : q.path && q.path.length ? 'path' : 'hold'),
        fatigue: 0, pushSince: -1, pushing: false, bracing: false, mission: null, guard: !led && !!q.guard, arrowsTaken: 0, support: 0, role: '', waiting: false, inLine: false, lineDepth: 0, fwd: onLeft ? 1 : -1,
        path: (q.path ?? []).map(p => ({ x: mx(p.x), y: p.y })), pathI: 0, commit: -1, commitX: 0, commitY: 0,
      };
      for (let i = 0; i < unitSize(q.unit); i++) {
        const p = slotWorld(sq, i);
        const s: BSoldier = {
          id: sid++, side, squad: sq.id, unit: q.unit, slot: i,
          x: p.x + (rand(b) - 0.5) * 0.06 * (onLeft ? 1 : -1), y: p.y + (rand(b) - 0.5) * 0.06, px: 0, py: 0,
          hp: stats(q.unit).hp ?? B.soldierHp, cd: rand(b) * 1.5, target: -1, retarget: rand(b) * 0.3,
          dir: face, step: 0, flash: 0, lunge: 0, lungeDir: 0, dead: false, fled: false, charge: true, moved: 0,
          stagger: 0, diedAt: -1,
          skill: pick(S.skill), nerve: rand(b), pace: pick(S.pace), foes: 0, hurtBy: 0, hurtAt: -9, routing: false, inMelee: false,
        };
        s.px = s.x; s.py = s.y;
        b.soldiers.push(s); sq.members.push(s.id);
      }
      b.squads.push(sq);
    };
    for (const p of layouts[side].spots) place(p.q, p.i, p.q.x ?? frontX - p.depth, p.q.y ?? b.H / 2 + p.off);
    // free squads march as one army: remember each one's place behind the army's front
    const mine = b.squads.filter(q => q.side === side);
    const front = Math.max(...mine.map(q => q.cx * q.fwd));
    for (const q of mine) { q.lineDepth = front - q.cx * q.fwd; q.inLine = q.order === 'free'; }
  }
  // cavalry jobs: if the enemy has cavalry, one squad per wing guards our flank against it; the rest raid
  for (const side of [0, 1] as Side[]) {
    const cav = b.squads.filter(q => q.side === side && q.unit === 'cavalry');
    const enemyCav = b.squads.filter(q => q.side !== side && q.unit === 'cavalry').length;
    if (b.cmd[side]) continue; // commander-led: cavalry get missions instead of fixed roles
    for (const q of cav) q.role = 'raid';
    if (!enemyCav || !cav.length) continue;
    if (cav.length === 1) { if (enemyCav >= 2) cav[0].role = 'guard'; continue; }
    if (cav.length < 4) { cav[0].role = 'guard'; continue; } // 2-3 squads: one guard, the rest raid
    for (const top of [true, false]) {                       // 4+: one guard per wing, the rest raid
      const wing = cav.filter(q => (q.homeY < b.H / 2) === top).sort((a, z) => a.lineDepth - z.lineDepth);
      if (wing.length) wing[0].role = 'guard';
    }
  }
  return b;
}

// ---------- helpers ----------

const alive = (s: BSoldier) => !s.dead && !s.fled;
/** Still fighting for their squad (alive and not running away on their own). */
const fights = (s: BSoldier) => !s.dead && !s.fled && !s.routing;
export const squadHp = (b: BattleState, q: BSquad) => {
  let hp = 0;
  for (const id of q.members) { const s = b.soldiers[id - 1]; if (fights(s)) hp += s.hp; }
  return hp / (q.members.length * maxHp(q.unit));
};
export const squadAlive = (b: BattleState, q: BSquad) => q.members.filter(id => fights(b.soldiers[id - 1])).length;
export const active = (q: BSquad) => !q.gone && !q.fleeing;
/** Archers with arrows left shoot; out of arrows they fight like (weak) infantry. */
export const shooter = (q: BSquad) => q.unit === 'archers' && q.ammo > 0;
export const wavering = (q: BSquad) => !q.broken && q.morale < CONFIG.battle.morale.waverAt;

/** Is the attacker at (ax, ay) hitting this squad from the side or behind? */
const fromFlank = (defSq: BSquad, def: BSoldier, ax: number, ay: number) =>
  Math.cos(angDiff(defSq.ang, Math.atan2(ay - def.y, ax - def.x))) < -0.2;

function damageOf(b: BattleState, att: BSoldier, attSq: BSquad, def: BSoldier, defSq: BSquad, melee: boolean): number {
  const B = CONFIG.battle, A = stats(att.unit), D = stats(def.unit);
  let dmg = att.unit === 'archers' && melee ? A.meleeDamage ?? A.damage : A.damage;
  dmg *= B.deadliness * (1 - B.fatigue.damage * attSq.fatigue); // tired arms hit softer
  dmg *= (1 + (b.bonus[att.side].damage ?? 0)) * (1 - (b.bonus[def.side].armour ?? 0));
  dmg *= 1 + B.rankDamage * attSq.rank;
  if (A.strongVs.includes(def.unit)) dmg *= B.counterBonus;
  dmg *= 1 - Math.min(0.6, D.defense + B.rankDefense * defSq.rank);
  dmg *= 1 - (D.armor ?? 0); // plate armour: turns away a share of every blow, on top of defense
  // hitting a squad from the side or behind hurts more (it can't face everyone)
  if (melee && fromFlank(defSq, def, att.x, att.y)) dmg *= B.flankBonus;
  return dmg;
}

let moraleResist: [number, number] = [0, 0];
function loseMorale(q: BSquad, amount: number) {
  q.morale -= amount * (1 - CONFIG.battle.morale.rankResist * q.rank) * (1 - moraleResist[q.side]) / (stats(q.unit).courage ?? 1);
}

// ---------- the tick ----------

export function stepBattle(b: BattleState) {
  if (b.over) return;
  const B = CONFIG.battle, M = B.morale, C = B.charge;
  moraleResist = [b.bonus[0].morale ?? 0, b.bonus[1].morale ?? 0];
  const rangeOf = (side: Side, u: UnitKind) => (stats(u).range ?? 7) * (1 + (b.bonus[side].range ?? 0));
  b.t += DT;
  const sq = (id: number) => b.squads[id - 1];
  const so = (id: number) => b.soldiers[id - 1];
  const O = B.orders, A = B.ai;
  /** Where threatened archers should fall back to: just behind the nearest friendly infantry, on the far side from the threat (null = stay). */
  const archerCover = (q: BSquad): Pt | null => {
    let th: BSquad | null = null, td = A.archerFallBack;
    for (const e of b.squads) if (e.side !== q.side && active(e) && !shooter(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < td) { td = d; th = e; } }
    if (!th) return null;
    let f: BSquad | null = null, fd = A.archerCoverRange;
    for (const o of b.squads) if (o.side === q.side && o !== q && active(o) && !o.broken && !shooter(o) && o.unit !== 'cavalry') { const d = Math.hypot(o.mx - q.mx, o.my - q.my); if (d < fd) { fd = d; f = o; } }
    if (!f) return null;
    const dx = f.mx - th.mx, dy = f.my - th.my, d = Math.hypot(dx, dy) || 1;
    const p = { x: Math.max(0.6, Math.min(b.W - 0.6, f.mx + dx / d * 1.8)), y: Math.max(0.6, Math.min(b.H - 0.6, f.my + dy / d * 1.8)) };
    // already safely behind our friend (the friend is closer to the threat than we are)? then stand and shoot
    return Math.hypot(p.x - q.mx, p.y - q.my) < 0.7 || (d < td && Math.hypot(q.mx - f.mx, q.my - f.my) < 2.2) ? null : p;
  };
  /** The next point on a squad's drawn arrow (null when it's done: the squad is then free to fight anyone). */
  const pathStep = (q: BSquad): Pt | null => {
    while (q.pathI < q.path.length && Math.hypot(q.path[q.pathI].x - q.cx, q.path[q.pathI].y - q.cy) < O.pointReach) q.pathI++;
    if (q.pathI >= q.path.length) { q.order = 'free'; return null; }
    return q.path[q.pathI];
  };
  /** A squad that left its path to finish a fight goes back to it once that enemy is beaten, or once it's chased too far. */
  const pathResume = (q: BSquad): boolean => {
    if (q.commit < 0) return true;
    const c = sq(q.commit);
    if (!c || c.gone || c.broken || c.fleeing || Math.hypot(q.mx - q.commitX, q.my - q.commitY) > O.maxChase) {
      q.commit = -1;
      // carry on from the nearest point of the path ahead
      let bi = q.pathI, bd = Infinity;
      for (let i = q.pathI; i < q.path.length; i++) { const d = Math.hypot(q.path[i].x - q.cx, q.path[i].y - q.cy); if (d < bd) { bd = d; bi = i; } }
      q.pathI = bi;
      return true;
    }
    return false;
  };

  // spatial grid for nearby lookups
  const grid = new Map<number, BSoldier[]>();
  for (const s of b.soldiers) if (alive(s)) {
    const k = (Math.floor(s.y) + 8) * 1000 + Math.floor(s.x) + 8;
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s);
  }
  const nearby = (x: number, y: number, r: number, f: (s: BSoldier) => void) => {
    const R = Math.ceil(r);
    for (let gy = Math.floor(y) - R; gy <= Math.floor(y) + R; gy++) for (let gx = Math.floor(x) - R; gx <= Math.floor(x) + R; gx++) {
      const a = grid.get((gy + 8) * 1000 + gx + 8); if (a) for (const s of a) f(s);
    }
  };

  // ---- squads: mass centre, morale, breaking ----
  const newlyBroken: BSquad[] = [];
  for (const q of b.squads) {
    if (q.gone) continue;
    let sx = 0, sy = 0, n = 0;
    for (const id of q.members) { const s = so(id); if (fights(s)) { sx += s.x; sy += s.y; n++; } }
    if (!n) { q.gone = true; continue; }
    q.mx = sx / n; q.my = sy / n;
    if (q.broken) {
      if (!q.fleeing && b.t - q.brokenAt >= B.fightAfterBreakSeconds) q.fleeing = true;
      continue;
    }
    // ganged up on: every extra enemy squad fighting us at once wears courage down
    let attackers = 0;
    for (const k in q.hitBy) if (b.t - q.hitBy[k] < 1.5) attackers++;
    if (attackers > 1) loseMorale(q, M.outnumberedPerSec * (attackers - 1) * M.supportFront[q.support] * DT); // (friends beside you help here too)
    // between blows courage comes back (faster with friends beside us)
    if (b.t - q.lastHit > M.recoverAfter - q.support * 0.75) q.morale = Math.min(M.start, q.morale + M.recoverPerSec * (1 + q.support * 0.5) * DT);
    const hpBreak = squadHp(b, q) <= B.breakAt, moraleBreak = q.morale <= 0;
    if (hpBreak || moraleBreak) {
      q.broken = true; q.brokenAt = b.t; q.brokeBy = hpBreak ? 'hp' : 'morale'; q.morale = Math.max(0, q.morale);
      newlyBroken.push(q);
    }
  }
  // friends beside us: a friendly squad close on our left and/or right (it steadies us)
  for (const q of b.squads) {
    if (!active(q) || q.broken) continue;
    const fx = Math.cos(q.ang), fy = Math.sin(q.ang);
    let left = false, right = false;
    for (const o of b.squads) {
      if (o === q || o.side !== q.side || !active(o) || o.broken || shooter(o)) continue;
      const dx = o.mx - q.mx, dy = o.my - q.my, f = dx * fx + dy * fy, r = -dx * fy + dy * fx;
      if (Math.abs(f) > M.supportDepth || Math.abs(r) < 0.4 || Math.abs(r) > halfFront(q.unit) + halfFront(o.unit) + M.supportGap) continue;
      if (r > 0) right = true; else left = true;
    }
    q.support = (left ? 1 : 0) + (right ? 1 : 0);
  }
  // a squad breaking shakes its friends nearby and heartens the enemy
  for (const br of newlyBroken) for (const o of b.squads) {
    if (o === br || !active(o) || o.broken) continue;
    if (Math.hypot(o.mx - br.mx, o.my - br.my) > M.nearbyRange) continue;
    if (o.side === br.side) {
      let friends = 0;
      for (const f of b.squads) if (f !== o && f !== br && f.side === o.side && active(f) && !f.broken && Math.hypot(f.mx - o.mx, f.my - o.my) <= M.nearbyRange) friends++;
      loseMorale(o, M.friendBrokeLoss * 3 / (3 + friends));
    }
    else o.morale = Math.min(M.start, o.morale + M.enemyBrokeGain);
  }

  // how many of our squads are already going for each enemy squad (to spread out)
  const attackersOf = new Map<number, number>();
  for (const q of b.squads) if (active(q) && q.target > 0 && !shooter(q)) attackersOf.set(q.target, (attackersOf.get(q.target) ?? 0) + 1);

  // the army advances together: infantry march at the slowest infantry pace until close to the enemy
  const marchPace = [Infinity, Infinity];
  for (const q of b.squads) if (active(q) && q.unit !== 'cavalry') marchPace[q.side] = Math.min(marchPace[q.side], stats(q.unit).speed);

  // the army's line: free squads still marching in formation keep pace with the slowest of them (nobody runs ahead)
  const armyF = [Infinity, Infinity], engaged = [false, false];
  for (const q of b.squads) {
    if (!active(q)) continue;
    if (q.inLine && !shooter(q)) armyF[q.side] = Math.min(armyF[q.side], q.cx * q.fwd + q.lineDepth);
    if (!q.inLine && q.unit !== 'cavalry' && (q.state === 'melee' || q.state === 'formup' || q.state === 'charge')) engaged[q.side] = true;
  }

  // each side's infantry front (how far forward its foot soldiers are): enemies behind it are behind our line
  const sideFront = [-Infinity, -Infinity], fwdOf: [number, number] = [1, -1];
  for (const q of b.squads) {
    fwdOf[q.side] = q.fwd;
    if (active(q) && !q.broken && q.unit !== 'cavalry' && !shooter(q)) sideFront[q.side] = Math.max(sideFront[q.side], q.mx * q.fwd);
  }
  for (const sd of [0, 1]) { const L = b.line[sd]; L.front = sideFront[sd]; L.lo = Infinity; L.hi = -Infinity; }
  for (const q of b.squads) if (active(q) && !q.broken && q.unit !== 'cavalry' && !shooter(q)) { const L = b.line[q.side]; L.lo = Math.min(L.lo, q.my); L.hi = Math.max(L.hi, q.my); }
  // the army commanders think (every few seconds; the order flips so neither side goes first)
  for (const sd of Math.floor(b.t / B.commander.thinkSeconds) % 2 ? [0, 1] : [1, 0]) { const c = b.cmd[sd]; if (c) { commanderThink(b, c); if (c.op) pushOpTick(b, c); } } // (they take turns thinking first; a push operation has its own, faster manager)
  const behindLine = (side: Side, x: number) => isFinite(sideFront[side]) && x * fwdOf[side] < sideFront[side] - 0.5;
  const enemyCavLeft = [0, 1].map(sd => b.squads.some(q => q.side !== sd && q.unit === 'cavalry' && active(q) && !q.broken));

  // who is being pushed by whom (from the last step)
  const pusherOf = new Map<number, BSquad>();
  for (const q of b.squads) if (q.pushing && active(q) && q.target > 0) pusherOf.set(q.target, q);

  // ---- squads: choose a target and move the formation (order flips each step: fair to both sides) ----
  const order = Math.round(b.t * BATTLE_TPS) % 2 ? b.squads : [...b.squads].reverse();
  for (const q of order) {
    if (!active(q)) continue;
    const U = stats(q.unit), isCav = q.unit === 'cavalry';
    const fighting = b.t - q.lastFight < A.fightingLatch;
    // tiredness: fighting wears a squad out (pushing and bracing much faster); standing out of the fight rests it
    {
      const F = B.fatigue;
      if (q.state === 'melee' && fighting) q.fatigue = Math.min(1, q.fatigue + F.meleePerSec * (q.pushing ? F.pushMul : q.bracing ? F.braceMul : 1) * DT);
      else if (q.state !== 'melee' && q.state !== 'charge') q.fatigue = Math.max(0, q.fatigue - F.restPerSec * DT);
      // cohesion: fighting, being pushed and being hit from the side wear it down; a breather (a lull) restores it
      const CO = B.cohesion;
      if (q.state === 'melee' && fighting) q.cohesion -= (CO.meleePerSec + (pusherOf.has(q.id) && !q.bracing ? CO.pushedPerSec : 0)) * DT;
      else if (q.state !== 'charge') q.cohesion += CO.recoverPerSec * (q.lull ? CO.lullMul : 1) * DT;
      q.cohesion = Math.max(0, Math.min(1, q.cohesion));
      if (q.state === 'melee' && fighting && q.fatigue >= B.push.exhaustedAt && !q.broken) loseMorale(q, B.push.exhaustedMoralePerSec * DT);
    }
    // on guard: stop holding once a friend nearby is in a fight, or we've been shot at long enough
    if (q.order === 'hold' && q.guard) {
      let join = q.arrowsTaken >= A.guardArrows;
      if (!join) for (const o of b.squads) if (o !== q && o.side === q.side && active(o) && o.state === 'melee' && Math.hypot(o.mx - q.mx, o.my - q.my) < A.guardJoinRange) { join = true; break; }
      if (join) q.order = 'free';
    }
    const K = B.commander;
    // riding round to hit something (a raider, or a commander's raid / shock / flank mission): don't stop for their cavalry on the way
    const raiding = isCav && (b.cmd[q.side] ? !!q.mission && (q.mission.kind === 'raid' || q.mission.kind === 'shock' || q.mission.kind === 'flank') : q.role === 'raid');
    // cavalry may run down routing enemies; everyone else ignores them
    const targetable = (e: BSquad) => !e.gone && (!e.fleeing || isCav);

    if (q.role === 'guard' && !enemyCavLeft[q.side]) q.role = 'raid'; // enemy cavalry beaten: go raiding
    q.retarget -= DT;
    let tq = q.target > 0 ? sq(q.target) : null;
    // ---- the commander's mission: the squad works out HOW ----
    const ms = b.cmd[q.side] ? q.mission : null;
    let fixed = false, posted = false;
    if (ms && !q.broken) {
      const mt = ms.target > 0 ? sq(ms.target) : null;
      if (mt && !mt.gone && (!mt.fleeing || ms.kind === 'pursue')) {
        // a mission against one enemy squad: that's our target (from the side or rear for flank / shock missions)
        tq = mt; q.target = mt.id; fixed = true; q.inLine = false;
        if (ms.kind === 'flank' || ms.kind === 'shock') q.flankSide = -(q.mx - mt.mx) * Math.sin(mt.ang) + (q.my - mt.my) * Math.cos(mt.ang) >= 0 ? 1 : -1;
        else if (q.retarget <= 0) q.flankSide = 0;
      } else if (ms.kind === 'reserve' || ms.kind === 'screen' || ms.kind === 'disengage') {
        // posted: stay at our post, but deal with anything that comes close (bounded initiative)
        posted = true; fixed = true; tq = null;
        if (ms.kind === 'disengage') {
          if (q.state === 'melee') { const p = postOf(b, q); q.state = 'withdraw'; q.withdrawUntil = ms.until; q.wx = p.x; q.wy = p.y; }
        } else {
          const R = ms.kind === 'screen' ? K.screenRange : K.reserveRange;
          let bd = R;
          for (const e of b.squads) {
            if (e.side === q.side || !active(e) || e.broken) continue;
            if (isCav && e.unit === 'spearmen' && e.state !== 'melee' && e.target !== q.id) continue; // cavalry don't go head-on into fresh spears
            // a screen holds its wing: it only goes for enemies that are coming at us (charging, fighting, or very close), not ones standing guard opposite
            if (ms.kind === 'screen' && !(e.state === 'charge' || e.state === 'melee' || e.target === q.id && e.state !== 'march' || Math.hypot(e.mx - q.mx, e.my - q.my) < K.screenClose)) continue;
            const d = Math.hypot(e.mx - q.mx, e.my - q.my) - (b.t - (q.hitBy[e.id] ?? -99) < A.threatMemory ? 3 : 0);
            if (d < bd) { bd = d; tq = e; }
          }
          if (tq) { posted = false; q.target = tq.id; q.inLine = false; }
        }
      }
    }
    if (!fixed && (!tq || !targetable(tq) || (q.retarget <= 0 && !fighting && q.state !== 'withdraw'))) {
      q.retarget = 1 + rand(b) * 0.5;
      let best: BSquad | null = null, bd = Infinity;
      for (const e of b.squads) {
        if (e.side === q.side || !targetable(e)) continue;
        const ex = e.mx - q.mx, ey = e.my - q.my;
        let d = Math.hypot(ex, ey);
        // guards only go for enemy cavalry that comes near them or is attacking a friend
        if (isCav && q.role === 'guard' && q.order === 'free' && (e.unit !== 'cavalry' || (d > A.guardRange && !(e.target > 0 && sq(e.target).side === q.side && e.state === 'melee')))) continue;
        // raiders leave enemy cavalry alone unless it's on us
        if (isCav && q.role === 'raid' && e.unit === 'cavalry') d += A.raidCavAvoid; // raiders leave enemy cavalry to our guards
        if (isCav && q.role === 'raid' && e.unit === 'archers') d -= A.raidArcherBonus;
        // infantry turn to meet enemy cavalry raiding behind our line (spearmen most of all)
        if (!isCav && !shooter(q) && q.state !== 'melee' && e.unit === 'cavalry' && behindLine(q.side, e.mx) && d < A.rearCavRange)
          d -= A.rearCavBonus + (q.unit === 'spearmen' ? 2 : 0);
        if (!isCav && !shooter(q)) { // infantry go for the enemy squad opposite them (keeps the line together)
          const fx = Math.cos(q.ang), fy = Math.sin(q.ang);
          d = Math.abs(ex * fx + ey * fy) * 0.5 + Math.abs(-ex * fy + ey * fx) * A.lateralWeight;
          d += hash01(q.id, e.id) * A.targetJitter; // every squad sizes things up a little differently (no perfect lanes)
        }
        if (U.strongVs.includes(e.unit)) d -= 4;             // go for what we beat
        if (stats(e.unit).strongVs.includes(q.unit)) d += 3; // avoid what beats us
        if (isCav && e.unit === 'archers') d -= 3;
        if (!shooter(q)) {
          const ef = e.target > 0 ? sq(e.target) : null;      // who that enemy is going for
          const busy = e.state === 'melee' && !!ef && ef !== q; // already fighting one of our friends
          // protect friends: an enemy coming at a friend's flank or rear is a priority
          if (ef && ef !== q && ef.side === q.side && !shooter(e) && Math.hypot(e.mx - ef.mx, e.my - ef.my) < A.protectRange &&
              Math.cos(angDiff(ef.ang, Math.atan2(e.my - ef.my, e.mx - ef.mx))) < 0.2) d -= A.protectBonus;
          if (wavering(e)) d -= isCav ? A.cavWaverBonus : A.waverBonus;   // finish off a squad that's about to break
          if (busy && (attackersOf.get(e.id) ?? 0) === 0) d -= A.unattendedBonus; // nobody is answering this one yet
          if (busy && ef && (wavering(ef) || squadHp(b, ef) < A.helpHp) && Math.hypot(e.mx - q.mx, e.my - q.my) < A.helpRange) d -= A.helpBonus; // a friend is losing: go help
          if (isCav) {
            if (busy) d -= A.cavBusyBonus;                    // cavalry love an enemy that's busy: hit it from behind
            else if (e.unit === 'spearmen') d += A.cavSpearFear; // ...and hate fresh spearmen who can brace
          }
        }
        if (!shooter(q)) d += ((attackersOf.get(e.id) ?? 0) - (q.target === e.id ? 1 : 0)) * 3.5; // spread out
        if (e.broken) d += 2;
        if (e.fleeing) d += 6;
        if (d < bd) { bd = d; best = e; }
      }
      tq = best; q.target = tq ? tq.id : -1;
      if (tq) {
        // if another of our squads is already on them, swing round to whichever flank is closer
        const others = (attackersOf.get(tq.id) ?? 0) - (q.target === tq.id ? 1 : 0);
        q.flankSide = 0;
        // outside the enemy's frontage (our line is longer): wrap round its end
        const lat = -(q.mx - tq.mx) * Math.sin(tq.ang) + (q.my - tq.my) * Math.cos(tq.ang);
        const outside = !isCav && Math.abs(lat) > halfFront(tq.unit) + halfFront(q.unit) * 0.6;
        if ((others > 0 || outside) && !shooter(q)) {
          // the closer of its two flanks (a tie goes to the one nearer the middle of the field)
          const T = tq, off = halfFront(T.unit) + 0.8, pt = (f: number) => ({ x: T.mx + Math.cos(T.ang + f * Math.PI / 2) * off, y: T.my + Math.sin(T.ang + f * Math.PI / 2) * off });
          const p1 = pt(1), p2 = pt(-1);
          const d1 = Math.hypot(p1.x - q.mx, p1.y - q.my), d2 = Math.hypot(p2.x - q.mx, p2.y - q.my);
          q.flankSide = Math.abs(d1 - d2) > 0.05 ? (d1 < d2 ? 1 : -1)
            : Math.abs(Math.abs(p1.y - b.H / 2) - Math.abs(p2.y - b.H / 2)) > 0.01 ? (Math.abs(p1.y - b.H / 2) < Math.abs(p2.y - b.H / 2) ? 1 : -1)
            : (p1.y > p2.y ? 1 : -1);
        }
      }
    }
    // hit by a squad we're not fighting, while our own target is still out of reach: turn on the attacker (don't get flanked for free)
    if (!q.broken && q.state !== 'withdraw' && !shooter(q)) {
      let th: BSquad | null = null, tt = b.t - A.threatMemory;
      for (const k in q.hitBy) if (q.hitBy[k] > tt) { const e = sq(Number(k)); if (e && targetable(e) && !shooter(e)) { th = e; tt = q.hitBy[k]; } }
      const raidOn = raiding && th?.unit === 'cavalry' && tq?.unit !== 'cavalry'; // raiders don't turn to duel cavalry
      if (th && tq && th !== tq && !raidOn && !(b.t - (q.hitBy[tq.id] ?? -99) < A.threatMemory) && Math.hypot(tq.mx - q.mx, tq.my - q.my) > A.engagedDist) {
        tq = th; q.target = th.id; q.flankSide = 0; q.retarget = 2;
      }
    }
    // infantry on an arrow: once an enemy squad is close, leave the arrow and fight like a free squad (and stay free afterwards)
    if (q.order === 'path' && !isCav && !shooter(q)) {
      for (const e of b.squads) if (e.side !== q.side && active(e) && Math.hypot(e.mx - q.mx, e.my - q.my) < O.engageDist) { q.order = 'free'; q.inLine = false; q.commit = -1; break; }
    }
    // on a path but committed to a real fight: that enemy squad is the target until it's beaten
    if (q.commit > 0) {
      const c = sq(q.commit);
      if (c && !c.gone && !c.broken && !c.fleeing) { tq = c; q.target = c.id; }
    }
    let station = false, post: Pt | null = null;
    if (posted) {
      // nobody to deal with: stand at our post (facing the nearest enemy), still marching with the army until it's close
      let nd = Infinity;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < nd) { nd = d; tq = e; } }
      station = !!tq && !q.inLine && q.state !== 'withdraw';
      if (station) post = postOf(b, q);
    } else if (!tq && q.role === 'guard' && q.order === 'free') {
      // a guard with nothing to do: keep marching with the army, then wait on our wing level with our infantry front
      let nd = Infinity;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my) + (e.unit === 'cavalry' ? 0 : 100); if (d < nd) { nd = d; tq = e; } }
      station = !!tq && !q.inLine;
    }
    if (!tq) continue;

    const toE = Math.atan2(tq.my - q.my, tq.mx - q.mx);
    const dE = Math.hypot(tq.mx - q.mx, tq.my - q.my);
    const fwdX = Math.cos(q.ang), fwdY = Math.sin(q.ang);
    let gx = q.cx, gy = q.cy, speed = U.speed, faceTo = toE, turnRate = 1.6;
    let contact = false, wp: Pt | null = null, cover: Pt | null = null;
    let viaRun = false; // running through a gap in their line first (a commander's breakthrough charge)

    if (shooter(q)) {
      // archers: walk up until the enemy is well within range, then stand and shoot volleys
      let nd = Infinity, nx = tq.mx, ny = tq.my;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < nd) { nd = d; nx = e.mx; ny = e.my; } }
      // the commander gave us a focus: walk up to shoot it (unless something else is right on top of us)
      if (ms?.kind === 'support' && fixed && tq && active(tq) && nd > 3) { nd = Math.hypot(tq.mx - q.mx, tq.my - q.my); nx = tq.mx; ny = tq.my; }
      // standing and shooting until the enemy is well out of range, then walk up to a comfortable distance
      const range = rangeOf(q.side, q.unit), want = range * 0.6;
      const a = Math.atan2(ny - q.my, nx - q.mx);
      const inRange = nd <= range * 0.95;
      const wp = q.order === 'path' && !inRange ? pathStep(q) : null; // on an arrow: walk on only while nothing is in range
      if (q.order === 'path' && (cover = archerCover(q))) { gx = cover.x; gy = cover.y; speed = U.speed * 1.15; }
      else if (wp) { gx = wp.x; gy = wp.y; } // following the player's arrow
      else if (q.order === 'path') { /* stand and shoot */ }
      else if (q.order !== 'hold' && (cover = archerCover(q))) {
        // enemy fighters closing in: fall back behind the nearest friendly infantry (still shooting)
        q.hold = false; gx = cover.x; gy = cover.y; speed = U.speed * 1.15;
      } else if (q.order !== 'hold') {
        if (q.hold && nd > range * 0.9) q.hold = false;
        if (!q.hold && nd <= want + 0.2) q.hold = true;
        if (!q.hold) { gx = nx - Math.cos(a) * want; gy = ny - Math.sin(a) * want; }
      }
      q.state = nd < 1.5 ? 'melee' : 'march';
      faceTo = wp && nd > range ? Math.atan2(gy - q.cy, gx - q.cx) : a; turnRate = 1.5;
    } else if (q.state === 'withdraw') {
      // cavalry pulling out to charge again (infantry in a lull: stepping back a pace, still facing the enemy, then standing)
      gx = q.wx; gy = q.wy; speed = U.speed * (q.lull ? 0.6 : 1.1);
      faceTo = q.lull ? toE : Math.atan2(gy - q.cy, gx - q.cx); turnRate = q.lull ? 1.5 : 3;
      // (a lull is over at once if someone keeps hitting us: we fight back)
      const struck = q.lull && Object.values(q.hitBy).some(t => t > q.lullAt + 0.8 && b.t - t < 0.3);
      if ((!q.lull && Math.hypot(gx - q.cx, gy - q.cy) < 0.6) || b.t > q.withdrawUntil || struck) {
        // a line charge: friends beside us who have had their breather come back in with us
        if (q.lull && !struck) for (const o of b.squads) if (o !== q && o.side === q.side && o.lull && o.state === 'withdraw' && b.t - o.lullAt > B.lull.joinAfter && Math.hypot(o.mx - q.mx, o.my - q.my) < B.lull.joinRange) o.withdrawUntil = b.t;
        q.state = 'march'; q.meleeSince = -1; q.lull = false;
        for (const id of q.members) so(id).charge = true; // ready to charge again
      }
    } else {
      // approach point: in front of the target, or on its flank if a friend is already there
      let ax = tq.mx, ay = tq.my;
      if (q.flankSide) {
        const side = tq.ang + q.flankSide * Math.PI / 2;
        const fl = { x: tq.mx + Math.cos(side) * (halfFront(tq.unit) + 0.8), y: tq.my + Math.sin(side) * (halfFront(tq.unit) + 0.8) };
        ax = fl.x; ay = fl.y;
        if (isCav && tq.state === 'melee') {
          // cavalry hit a busy enemy from behind: ride round its flank first if we're still in front of it
          const inFront = (q.mx - tq.mx) * Math.cos(tq.ang) + (q.my - tq.my) * Math.sin(tq.ang) > 0;
          if (!inFront || Math.hypot(fl.x - q.mx, fl.y - q.my) < 1.2) { ax = tq.mx - Math.cos(tq.ang) * 1.6; ay = tq.my - Math.sin(tq.ang) * 1.6; }
        }
      }
      if (isCav && tq.unit === 'archers' && dE > 4) ay += (tq.my > b.H / 2 ? 1 : -1) * 2; // ride round the outer edge
      gx = ax; gy = ay;
      // raiders don't ride through the enemy line: if enemy foot is in the way, go round by our wing's edge first
      if (raiding && dE > 4) {
        const wy = q.homeY < b.H / 2 ? 1.2 : b.H - 1.2;
        if (q.viaEdge) { // keep riding along the edge until level with the target (no dithering at the edge of the "blocked" test)
          if (Math.abs(q.mx - ax) < A.raidTurnIn || Math.abs(q.my - wy) > b.H) q.viaEdge = false;
          else { gx = ax; gy = wy; }
        } else if (Math.abs(q.my - wy) > 1.6 && Math.abs(q.mx - ax) >= A.raidTurnIn) { // (once level with the target there is nothing more to ride round: go in)
          let blocked = false;
          const sx = ax - q.mx, sy2 = ay - q.my, L2 = sx * sx + sy2 * sy2 || 1;
          for (const e of b.squads) {
            if (e === tq || e.side === q.side || !active(e) || e.unit === 'cavalry') continue;
            const k = Math.max(0, Math.min(1, ((e.mx - q.mx) * sx + (e.my - q.my) * sy2) / L2));
            if (Math.hypot(q.mx + sx * k - e.mx, q.my + sy2 * k - e.my) < A.raidClearance) { blocked = true; break; }
          }
          if (blocked) { q.viaEdge = true; gx = ax; gy = wy; }
        }
      } else q.viaEdge = false;
      // a breakthrough charge: first through the gap the commander pointed at (a point just behind their line), then onto the target
      if (ms?.via && !ms.viaDone && fixed && !isCav) {
        if (Math.hypot(q.mx - ms.via.x, q.my - ms.via.y) < 1.4 || b.t > ms.since + K.viaSeconds) ms.viaDone = true;
        else {
          viaRun = true; gx = ms.via.x; gy = ms.via.y;
          // not lined up with the hole yet: go to its mouth on our side first, then straight through (no cutting across the fighting)
          const mouthF = ms.via.x * q.fwd - K.gapMouth;
          if (q.mx * q.fwd < mouthF + 0.6 && Math.abs(q.my - ms.via.y) > 0.9) { gx = mouthF * q.fwd; gy = ms.via.y; }
        }
      }
      if (station) { // waiting at a post (a commander's reserve or screen, or an old-style guard on its wing)
        if (post) { gx = post.x; gy = post.y; }
        else { gx = isFinite(sideFront[q.side]) ? (sideFront[q.side] - 0.5) * q.fwd : q.cx; gy = q.homeY; }
      }
      // a friendly squad is already fighting right in front of us: wait just behind it, ready to step in
      // (unless it's getting worn down: then push up and join the fight)
      let support: BSquad | null = null;
      if (!isCav && !q.flankSide && q.state !== 'melee') {
        const ux = Math.cos(toE), uy = Math.sin(toE);
        let bestF = 3.4;
        for (const o of b.squads) {
          if (o === q || o.side !== q.side || !active(o) || o.state !== 'melee' || o.unit === 'cavalry' || shooter(o)) continue;
          const ox = o.mx - q.mx, oy = o.my - q.my;
          const f = ox * ux + oy * uy, r = Math.abs(-ox * uy + oy * ux);
          if (f > 0.3 && f < bestF && r < halfFront(o.unit) + halfFront(q.unit) * 0.7 && squadHp(b, o) > A.reliefHp && !wavering(o)) { bestF = f; support = o; }
        }
      }
      q.waiting = !!support;
      if (support) { gx = support.cx - Math.cos(toE) * 1.25; gy = support.cy - Math.sin(toE) * 1.25; }

      // is the enemy right in front of our line? (forward gap from our front rank)
      let gap = Infinity;
      const band = viaRun ? K.gapBand : halfFront(q.unit) + 0.35, rx = -fwdY, ry = fwdX; // (running through a hole: only someone right in our path stops us)
      const passing = raiding && tq.unit !== 'cavalry'; // raiders ride past enemy cavalry on the way to their target
      nearby(q.cx, q.cy, 2.5, e => {
        if (e.side === q.side) return;
        if (passing && e.unit === 'cavalry') return;
        const ex = e.x - q.cx, ey = e.y - q.cy;
        const f = ex * fwdX + ey * fwdY, r = ex * rx + ey * ry;
        if (Math.abs(r) < band && f > -1.2 && f < gap) gap = f; // (enemies pushed into our ranks count too)
      });
      contact = gap < 1.6;

      if (contact || (fighting && !(passing && dE > 2.5))) {
        q.state = 'melee';
        if (q.meleeSince < 0) q.meleeSince = b.t;
        // the stronger squad leans in, the weaker gives ground
        const ours = squadAlive(b, q) / q.members.length * (0.5 + q.morale / 200);
        const theirs = squadAlive(b, tq) / tq.members.length * (0.5 + tq.morale / 200);
        const adv = Math.max(-1, Math.min(1, (ours - theirs) * 2));
        // a push: drive forward into them (ordered by the commander; needs the strength for it). The enemy either braces
        // (stands firm, if it still has the legs and the nerve) or is shoved back.
        const PU = B.push, pb = pusherOf.get(q.id) ?? null, pushedBy = !!pb;
        let push = !isCav && !!ms?.push && !q.broken && !wavering(q) && q.fatigue < PU.maxFatigue;
        // two squads can't both push each other: whoever started first keeps going (same moment: the stronger one), the other must brace or give way
        if (push && pushedBy) push = q.pushSince >= 0 && (pb!.pushSince < 0 || q.pushSince < pb!.pushSince || (q.pushSince === pb!.pushSince && (ours > theirs || (ours === theirs && (hash01(Math.min(q.id, pb!.id) * 7919 + Math.max(q.id, pb!.id), Math.round(q.pushSince * 20)) < 0.5) === (q.id < pb!.id)))));
        q.pushing = push; q.pushSince = push ? (q.pushSince >= 0 ? q.pushSince : b.t) : -1;
        q.bracing = pushedBy && !q.pushing && !q.broken && !wavering(q) && q.fatigue < PU.braceMaxFatigue;
        // a braced squad still gives ground, slowly; an unbraced one is driven back fast
        const lean = q.pushing ? PU.lean : pushedBy ? 0 : adv * B.melee.pressGap;
        // being pushed: the whole squad is driven back, away from the pushers (slowly if braced, fast if not)
        if (pb && !q.pushing) {
          const dx = q.mx - pb.mx, dy = q.my - pb.my, dd = Math.hypot(dx, dy) || 1;
          if (dd < PU.shoveRange) { const v = stats(pb.unit).speed * (q.bracing ? PU.braceGiveSpeed : PU.giveSpeed) * DT; q.cx += dx / dd * v; q.cy = Math.max(0.4, Math.min(b.H - 0.4, q.cy + dy / dd * v)); }
        }
        if (q.pushing && rand(b) < 0.25) b.fx.push({ x: q.cx + (rand(b) - 0.5) * 1.6, y: q.cy + (rand(b) - 0.5) * 1.6, t: 0, kind: 'dust' }); // feet churning the ground
        if (pushedBy && !q.bracing && !q.pushing) loseMorale(q, PU.pushedMoralePerSec * M.supportFront[q.support] * DT); // being driven back is frightening
        const want = U.reach * (isCav ? 0.55 : 0.8) - lean;
        if (gap < Infinity) {
          const err = gap - want;
          let step = err > 0 ? Math.min(err, U.speed * (q.pushing ? PU.speed : 0.5) * DT) : Math.max(err * 0.5, -U.speed * 0.35 * DT);
          // a push locks the two squads together: the pushers drive forward exactly as fast as the enemy is forced back
          // (never bouncing back), and the squad being pushed can't step forward again
          if (q.pushing) step = pusherOf.get(tq.id) === q && dE < PU.shoveRange ? U.speed * (tq.bracing ? PU.braceGiveSpeed : PU.giveSpeed) * DT : Math.max(step, 0);
          else if (pushedBy) step = Math.min(step, 0);
          // they stepped back to catch their breath: so do we (no chasing into their line)... unless we're fresh and our commander
          // is an aggressive one: then we go straight at them while they rest
          else if (tq.lull && !(q.cohesion > B.lull.pounceCohesion && q.fatigue < B.lull.pounceFatigue && (b.cmd[q.side]?.temper?.aggr ?? 0) > B.lull.pounceAggr)) step = Math.min(step, 0);
          else if (!isCav) {
            // the squad beside us is being driven back: bend back with it (still fighting), so the line bends instead of snapping
            for (const o of b.squads) {
              if (o === q || o.side !== q.side || !pusherOf.has(o.id) || o.pushing || !active(o)) continue;
              const ox = o.mx - q.mx, oy = o.my - q.my, f = ox * fwdX + oy * fwdY, r = Math.abs(-ox * fwdY + oy * fwdX);
              if (f < -PU.followGap && f > -4 && r < halfFront(q.unit) + halfFront(o.unit) + M.supportGap) { step = Math.min(step, -U.speed * PU.followSpeed * DT); break; }
            }
          }
          gx = q.cx + fwdX * step / DT; gy = q.cy + fwdY * step / DT; // move along our facing
          speed = Math.abs(step) / DT;
        } else {
          speed = U.speed * 0.6; // the enemy slipped away from our front: follow them
        }
        faceTo = toE; turnRate = 0.9; // a fighting line wheels slowly
        // following an arrow and caught in a real (lasting) fight: finish that enemy squad off first
        if (q.order === 'path' && q.commit < 0 && b.t - q.meleeSince > O.commitAfter) { q.commit = tq.id; q.commitX = q.mx; q.commitY = q.my; }
        // surges and lulls: after a bout of fighting, an infantry squad that isn't pushing, being pushed or winning outright
        // steps back a pace to catch its breath (the enemy does the same), then surges in again with a fresh charge
        const LU = B.lull;
        if (!isCav && !shooter(q) && q.unit !== 'boss' && tq.unit !== 'cavalry' && !q.broken && !q.pushing && !pushedBy && !tq.pushing) {
          if (q.boutEnd < 0) q.boutEnd = b.t + (LU.bout[0] + rand(b) * (LU.bout[1] - LU.bout[0])) * (0.6 + q.cohesion * 0.6);
          else if (b.t > q.boutEnd && !wavering(tq) && !(ms?.push) && !Object.entries(q.hitBy).some(([id, t]) => Number(id) !== tq.id && b.t - t < 2)) {
            q.state = 'withdraw'; q.lull = true; q.lullAt = b.t; q.boutEnd = -1; b.stats.lulls++;
            q.withdrawUntil = b.t + LU.rest[0] + rand(b) * (LU.rest[1] - LU.rest[0]);
            q.wx = Math.max(0.5, Math.min(b.W - 0.5, q.mx - fwdX * LU.back)); q.wy = Math.max(0.5, Math.min(b.H - 0.5, q.my - fwdY * LU.back));
          }
        }
        // cavalry stuck in a grinding melee pull out and charge again (not when told to hold)
        if (isCav && q.order !== 'hold' && tq.unit !== 'archers' && b.t - q.meleeSince > C.cycleAfter && squadHp(b, q) > C.cycleMinHp && !q.broken) {
          q.state = 'withdraw'; q.withdrawUntil = b.t + 6;
          const back = Math.atan2(q.my - tq.my, q.mx - tq.mx);
          q.wx = Math.max(1, Math.min(b.W - 1, q.mx + Math.cos(back) * C.withdrawDist));
          q.wy = Math.max(1, Math.min(b.H - 1, q.my + Math.sin(back) * C.withdrawDist));
        }
      } else if (station) {
        q.meleeSince = -1; q.state = 'march'; speed = post && Math.hypot(gx - q.cx, gy - q.cy) > 1.5 ? U.speed : U.speed * 0.6;
        faceTo = q.fwd > 0 ? 0 : Math.PI; turnRate = 2;
      } else if (!isCav && q.order !== 'hold' && tq.unit === 'cavalry' && dE < A.braceDist && (tq.target === q.id || tq.state === 'charge')) {
        // cavalry coming at us: stop, close ranks and face the charge (spearmen brace)
        q.meleeSince = -1; q.state = 'formup'; gx = q.cx; gy = q.cy; speed = 0; faceTo = toE; turnRate = 3;
      } else if (q.order === 'hold') {
        // holding: stand our ground, turn to face what's coming
        q.meleeSince = -1;
        q.state = 'march'; gx = q.cx; gy = q.cy; speed = 0;
        faceTo = dE < 12 ? toE : q.ang; turnRate = 1;
      } else if (q.order === 'path' && pathResume(q) && (wp = pathStep(q))) {
        // following the player's arrow
        q.meleeSince = -1;
        q.state = 'march'; gx = wp.x; gy = wp.y; speed = U.speed;
        faceTo = Math.atan2(gy - q.cy, gx - q.cx); turnRate = 2.5;
      } else {
        q.meleeSince = -1;
        // still marching with the army: keep our place in its formation, face straight ahead, walk at the army's pace
        if (q.inLine) {
          let nd = Infinity;
          for (const e of b.squads) if (e.side !== q.side && active(e)) nd = Math.min(nd, Math.hypot(e.mx - q.mx, e.my - q.my));
          const release = isCav ? nd < O.cavEngage || engaged[q.side] : nd < O.engageDist;
          if (release || !isFinite(armyF[q.side])) q.inLine = false;
        }
        if (q.inLine) {
          q.state = 'march';
          gx = (armyF[q.side] + 0.6 - q.lineDepth) * q.fwd; gy = q.homeY;
          speed = isFinite(marchPace[q.side]) ? marchPace[q.side] : U.speed * 0.7;
          // the commander's plan is to hold and let them come: the line stands its ground (it still meets them when they're close)
          // (a plan that refuses a flank: that wing's squads stand while the other wing goes forward)
          const pl = b.cmd[q.side]?.plan, Ln = b.line[q.side], third = Math.max(1, Ln.hi - Ln.lo) / 3;
          const refused = pl?.kind === 'refuse' && (pl.strike < 0 ? q.my > Ln.hi - third : q.my < Ln.lo + third);
          if (ms?.kind === 'advance' && (pl?.defend || refused) && b.t > 3) { gx = q.cx; gy = q.cy; }
          faceTo = q.fwd > 0 ? 0 : Math.PI; turnRate = 2;
        } else {
          // close to the enemy: square up to them (ranks closing, weapons ready), then charge
          const charging = dE < C.distance && !support;
          const forming = !charging && !support && !isCav && dE < C.distance + O.formUp;
          q.state = charging ? 'charge' : forming ? 'formup' : 'march';
          speed = support ? U.speed * 0.6 : forming ? marchPace[q.side] * 0.7 : q.state === 'march' && !isCav ? marchPace[q.side] : U.speed * (charging ? 1.2 : 1);
          if (!isFinite(speed)) speed = U.speed;
          // a breakthrough charge goes in at a run (no stopping to dress the ranks), a little faster than a normal charge
          if (viaRun) { q.state = 'charge'; speed = U.speed * 1.2; }
          if (ms?.rush && !isCav) speed = Math.max(speed, U.speed) * (1 + K.rushSpeed);
          faceTo = forming && !viaRun ? toE : Math.hypot(gx - q.cx, gy - q.cy) > 0.6 ? Math.atan2(gy - q.cy, gx - q.cx) : toE;
          if (forming) turnRate = 2.6;
        }
      }
    }
    q.ang += Math.max(-turnRate * DT, Math.min(turnRate * DT, angDiff(q.ang, faceTo)));

    // steer around our own squads (not while locked in a fighting line)
    let rx = 0, ry = 0;
    if (!contact) for (const o of b.squads) {
      if (o === q || o.side !== q.side || !active(o)) continue;
      const dx = q.cx - o.cx, dy = q.cy - o.cy, d = Math.hypot(dx, dy), min = halfFront(q.unit) + halfFront(o.unit) + 0.2;
      if (d > 0.01 && d < min) { rx += (dx / d) * (min - d); ry += (dy / d) * (min - d); }
    }
    const dx = gx - q.cx + rx * 0.8, dy = gy - q.cy + ry * 0.8, d = Math.hypot(dx, dy);
    if (d > 0.005) {
      const m = Math.min(d, Math.max(speed, Math.hypot(rx, ry) > 0 ? 0.4 : 0) * (1 - B.fatigue.slow * q.fatigue) * DT);
      q.cx += (dx / d) * m; q.cy += (dy / d) * m;
    }
    q.cx = Math.max(0.4, Math.min(b.W - 0.4, q.cx)); q.cy = Math.max(0.4, Math.min(b.H - 0.4, q.cy));

  }

  // still-fighting members' order in each squad (front rank fills first, so the back steps up into gaps)
  const aliveIdx = new Map<number, number>();
  for (const q of b.squads) { let n = 0; for (const id of q.members) if (fights(so(id))) aliveIdx.set(id, n++); }

  // ---- soldiers (hits are collected and applied together, so neither side strikes first) ----
  type Hit = { t: BSoldier; dmg: number; by: BSoldier; charge: boolean; flank: boolean; kb: number; heavy: boolean };
  const hits: Hit[] = [];
  const SO = B.soldier, ML = B.melee;
  const foesNow = new Uint16Array(b.soldiers.length + 1); // attackers on each soldier this step
  const arrowsOn = new Map<number, number>(); // archers aiming at each enemy squad (last step)
  for (const s of b.soldiers) if (s.unit === 'archers' && alive(s) && s.target > 0) { const t = so(s.target); arrowsOn.set(t.squad, (arrowsOn.get(t.squad) ?? 0) + 1); }
  const N = b.soldiers.length, start = Math.floor(rand(b) * N);
  for (let k = 0; k < N; k++) {
    const s = b.soldiers[(start + k) % N];
    if (!alive(s)) continue;
    s.px = s.x; s.py = s.y;
    if (s.flash > 0) s.flash -= DT;
    if (s.lunge > 0) s.lunge -= DT;
    if (s.stagger > 0) s.stagger -= DT;
    s.cd -= DT;
    const q = sq(s.squad), U = stats(s.unit);
    const isCav = s.unit === 'cavalry', shoots = shooter(q);
    const goTo = (tx: number, ty: number, sp: number, stopAt = 0.04) => {
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (d <= stopAt) return;
      const m = Math.min(d - stopAt, sp * s.pace * (1 - B.fatigue.slow * q.fatigue) * (q.mission?.rush && !isCav ? 1 + B.commander.rushSpeed : 1) * DT);
      s.x += (dx / d) * m; s.y += (dy / d) * m;
      s.dir = Math.atan2(dy, dx); s.step += m * 30; s.moved += m;
    };
    if (q.fleeing || s.routing) {
      goTo(b.home[s.side], s.y + (rand(b) - 0.5) * 0.2, U.speed * B.fleeSpeed);
      if (s.x < -1 || s.x > b.W + 1) s.fled = true;
      continue;
    }
    // badly hurt in a shaken squad, a soldier may lose their nerve and run on their own (brave ones rarely do)
    if (!q.broken && !isCav && s.hp < maxHp(s.unit) * SO.panicHp && q.morale < M.waverAt + 25 &&
        rand(b) < SO.panicPerSec * DT * (1 - s.nerve) * 2) {
      s.routing = true; s.target = -1;
      loseMorale(q, M.deathLoss / q.members.length * 0.5);
      continue;
    }
    const idx = aliveIdx.get(s.id) ?? s.slot;
    const slot = slotWorld(q, idx);
    const front = isCav || slot.rank === 0;
    const edge = slot.file === 0 || slot.file === 4;
    const meleeReach = U.reach + (s.unit === 'spearmen' && slot.rank === 1 ? B.spacing * 1.2 : 0); // spears reach past the front rank
    // how far this soldier may step out of formation to fight; formations fray the longer a melee goes on
    // formations fray as cohesion goes (a fresh squad fights in its ranks; a worn-out one is every man for himself)
    const fray = q.meleeSince >= 0 ? ML.frayMax * (1 - q.cohesion) + (q.cohesion < B.cohesion.looseAt ? B.cohesion.looseLeash : 0) : 0;
    const leash = (q.broken ? ML.brokenLeash : isCav ? ML.cavLeash : q.state === 'charge' ? ML.chargeLeash
      : front ? (edge ? ML.edgeLeash : ML.frontLeash) : (edge ? ML.frontLeash : ML.backLeash)) + fray;
    // in a melee, soldiers outside the front rank with nobody to fight go looking (wrapping round, flanking)
    // in a melee, soldiers with nobody to fight go looking (wrapping round, flanking): the back ranks further, the front rank a little
    const hunt = q.state === 'melee' && !shoots ? Math.max(leash, (ML.huntLeash + fray) * (0.75 + s.nerve * 0.5) * (front && !isCav ? ML.frontHunt : 1)) : leash;

    if (q.state === 'withdraw') { goTo(slot.x, slot.y, U.speed * 1.3); continue; }

    // ---- who to fight ----
    s.retarget -= DT;
    let t = s.target > 0 ? so(s.target) : null;
    const dT = t ? Math.hypot(t.x - s.x, t.y - s.y) - ext(s.unit, t.unit) : Infinity;
    const locked = !!t && alive(t) && !shoots && dT <= meleeReach + 0.35; // once locked in a fight, they fight to the death...
    if (locked && s.hurtBy > 0 && s.hurtBy !== t!.id && b.t - s.hurtAt < 0.3) {
      // ...unless someone else hits them from the side: they may turn on them
      const h = so(s.hurtBy);
      if (alive(h) && !h.routing && Math.hypot(h.x - s.x, h.y - s.y) < meleeReach + 0.3 && rand(b) < SO.react) { t = h; s.target = h.id; }
      s.hurtBy = 0;
    } else if (!locked && (!t || !alive(t) || s.retarget <= 0)) {
      s.retarget = shoots ? 0.6 + rand(b) * 0.3 : 0.25 + rand(b) * 0.2;
      const radius = shoots ? rangeOf(s.side, s.unit) : meleeReach + hunt + 0.5;
      let best: BSoldier | null = null, bs = Infinity;
      nearby(s.x, s.y, radius, e => {
        if (e.side === s.side || !alive(e)) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d > radius) return;
        let score: number;
        if (shoots) {
          score = d;
          if (e.routing || sq(e.squad).fleeing) score += 6;
          if (e.inMelee) score += 5; // don't shoot into a melee where our own men are fighting (if there's anything else)
          if (e.unit === 'cavalry' && behindLine(s.side, e.x)) score -= A.archerRearCav; // cavalry raiding behind our line
          score += (arrowsOn.get(e.squad) ?? 0) * A.archerSpread;             // ...but don't all shoot the same squad
          if (e.squad === q.target && b.cmd[q.side]) score -= A.archerFocus;     // the commander's focus
        } else {
          // the enemy nearest our place in the line, but also near us
          score = Math.hypot(e.x - slot.x, e.y - slot.y) * ML.slotWeight + d * (1 - ML.slotWeight);
          if (e.squad === q.target) score -= 0.4;
          if (U.strongVs.includes(e.unit)) score -= 0.3;
          if (e.routing || sq(e.squad).fleeing) score += isCav ? 0 : 1.5;
          score += 0.35 * Math.max(0, e.foes - 1);            // don't all pile onto one man
          if (e.foes >= 1 && fromFlank(sq(e.squad), e, s.x, s.y)) score -= 0.5; // hit someone who's busy, from the side
        }
        if (score < bs) { bs = score; best = e; }
      });
      t = best; s.target = t ? (t as BSoldier).id : -1;
    }

    if (t) {
      const ex = ext(s.unit, t.unit), d = Math.hypot(t.x - s.x, t.y - s.y) - ex;
      const meleeNow = !shoots || d < 1.1;
      const reach = meleeNow ? meleeReach : rangeOf(s.side, s.unit);
      const room = locked || hunt > leash ? hunt : leash; // how far from our place we may be while fighting this one
      if (d <= reach) {
        s.dir = Math.atan2(t.y - s.y, t.x - s.x);
        if (meleeNow) foesNow[t.id]++;
        // spearmen brace: a charging horse runs onto a set spear (a free strike, whatever the timing)
        const brace = meleeNow && s.unit === 'spearmen' && s.charge && t.unit === 'cavalry' && t.charge && t.moved > 1;
        if ((s.cd <= 0 || brace) && s.stagger <= 0) {
          let dmg = damageOf(b, s, q, t, sq(t.squad), meleeNow);
          let charged = false, kb = 0, heavy = false;
          if (brace) { dmg *= C.braceBonus; s.charge = false; }
          else if (meleeNow && s.charge && s.moved > (isCav ? 1.5 : C.infantryRun)) { // charge impact (spearmen brace against horses)
            charged = true;
            if (isCav) { if (t.unit !== 'spearmen') { dmg *= (U.chargeBonus ?? 1) * (1 + (b.bonus[s.side].charge ?? 0)); kb = C.cavKnockback; } }
            else { dmg *= C.infantryBonus * (1 + (b.bonus[s.side].charge ?? 0)); kb = C.knockback; q.chargeAt = b.t; } // (the squad's momentum: see below)
            s.charge = false;
          }
          const momentum = !isCav && b.t - q.chargeAt < C.momentumSeconds; // just charged in: the rush carries the first moments of the fight
          if (momentum && !charged) dmg *= 1 + C.momentumDamage;
          // every blow is different: glancing, ordinary or heavy
          const roll = rand(b);
          if (roll < SO.glanceChance) dmg *= SO.glance;
          else if (roll > 1 - SO.heavyChance) { dmg *= SO.heavy; heavy = true; }
          else dmg *= 0.85 + rand(b) * 0.3;
          // ganged up on: a soldier fighting several enemies at once can't put everything into each blow
          const giant = (stats(s.unit).mass ?? 1) > 1; // a giant isn't hampered by being swarmed, and swarming it doesn't give a bonus to hit
          if (!giant) dmg /= 1 + SO.ganged * Math.max(0, s.foes - 1);
          if (meleeNow) {
            s.lunge = 0.18; s.lungeDir = s.dir;
            const hitP = B.hitChance * s.skill * ((stats(t.unit).mass ?? 1) > 1 ? 1 : 1 + SO.gangedHit * Math.max(0, t.foes - 1));
            // the defender may block a blow coming from in front of them (harder with several attackers)
            const facing = Math.cos(angDiff(t.dir, Math.atan2(s.y - t.y, s.x - t.x))) > 0.3;
            // parrying: only blows from the front, not while off balance or mid-swing; much harder if they're busy fighting someone else
            const busy = t.target !== s.id ? SO.busyParry : 1;
            const blockP = facing && t.stagger <= 0 && t.lunge <= 0 && !brace && !charged ? stats(t.unit).block * (1 - B.cohesion.blockLoss * (1 - sq(t.squad).cohesion)) * t.skill * busy * (1 - B.fatigue.parry * sq(t.squad).fatigue) * (sq(t.squad).pushing ? B.push.exposedParry : 1) / (1 + SO.ganged * Math.max(0, t.foes - 1)) : 0;
            if (rand(b) < hitP && rand(b) >= blockP) {
              hits.push({ t, dmg, by: s, charge: charged, flank: fromFlank(sq(t.squad), t, s.x, s.y), kb, heavy });
              if (U.splash) { // a slam: everyone close to the target takes a share of the blow and is knocked off balance
                const sp = U.splash;
                nearby(t.x, t.y, sp.radius, e => {
                  if (e === t || e.side === s.side || !alive(e) || Math.hypot(e.x - t.x, e.y - t.y) > sp.radius) return;
                  hits.push({ t: e, dmg: dmg * sp.share, by: s, charge: false, flank: false, kb: 0, heavy: true });
                });
                for (let i = 0; i < 4; i++) b.fx.push({ x: t.x + (rand(b) - 0.5) * sp.radius, y: t.y + (rand(b) - 0.5) * sp.radius, t: 0, kind: 'dust' });
              }
            }
            else if (rand(b) < 0.35) b.fx.push({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 - 0.2, t: 0, kind: 'clash' }); // missed or blocked: sparks
            s.cd = (U.meleeCooldown ?? U.cooldown) * B.tempo * (0.8 + rand(b) * 0.4) / (0.9 + s.skill * 0.1) / (q.pushing ? 1 + B.push.attackSpeed : 1) / (momentum ? 1 + C.momentumSpeed : 1); // men in a push (or a fresh charge) strike faster
          } else {
            const dur = d / B.arrowSpeed, spread = 0.15 + d * 0.04;
            const hit = rand(b) < B.arrowHitChance * (0.85 + s.skill * 0.15);
            const tx = hit ? t.x : t.x + (rand(b) - 0.5) * spread * 4, ty = hit ? t.y : t.y + (rand(b) - 0.5) * spread * 4;
            b.arrows.push({ x: s.x, y: s.y, sx: s.x, sy: s.y - 0.2, tx, ty, t: 0, dur, target: t.id, dmg, hit, side: s.side, squad: q.id });
            s.cd = U.cooldown * B.tempo * (0.85 + rand(b) * 0.3); // nock the next arrow (each archer at their own pace)
            q.ammo--;
          }
          q.lastFight = b.t;
          if (q.firstFight < 0) q.firstFight = b.t;
          if (b.firstContact < 0) b.firstContact = b.t;
        }
        s.moved = 0;
        if (!meleeNow) goTo(slot.x, slot.y, U.speed * 0.6); // archers keep their place while shooting
        else {
          // fighting: plant your feet. Only step if you're far too close, or have drifted well away from your place
          const ox = s.x - slot.x, oy = s.y - slot.y, off = Math.hypot(ox, oy);
          if (off > room + 0.2) goTo(slot.x + ox / off * room, slot.y + oy / off * room, U.speed * 0.5);
          else if (d < 0.28) { const a = Math.atan2(s.y - t.y, s.x - t.x); goTo(s.x + Math.cos(a) * 0.1, s.y + Math.sin(a) * 0.1, U.speed * 0.3, 0.01); }
        }
      } else if (meleeNow) {
        // step toward the enemy, but only as far as our place in the line allows
        const a = Math.atan2(t.y - s.y, t.x - s.x);
        let tx = t.x - Math.cos(a) * (reach * 0.85 + ex), ty = t.y - Math.sin(a) * (reach * 0.85 + ex);
        const ox = tx - slot.x, oy = ty - slot.y, off = Math.hypot(ox, oy);
        if (off > room) { tx = slot.x + ox / off * room; ty = slot.y + oy / off * room; }
        goTo(tx, ty, U.speed * (q.state === 'charge' ? 1.3 : 1.1));
      } else {
        goTo(slot.x, slot.y, U.speed * 1.2);
      }
    } else if (q.state === 'melee' && !front && !isCav) {
      // back ranks with nobody to fight lean forward, ready to fill a gap
      goTo(slot.x + Math.cos(q.ang) * ML.pressForward, slot.y + Math.sin(q.ang) * ML.pressForward, U.speed);
    } else {
      goTo(slot.x, slot.y, U.speed * (q.state === 'charge' ? 1.35 : q.state === 'formup' ? 1.6 : 1.25)); // forming up: dress the ranks quickly
      if (!isCav && q.state === 'march') s.step = (q.cx * Math.cos(q.ang) + q.cy * Math.sin(q.ang)) * 30; // in step
    }
    if (b.t - q.lastFight > 3) s.charge = true; // a breather restores the charge
    if (isCav && q.state === 'charge' && s.moved > 1 && rand(b) < 0.15) b.fx.push({ x: s.x - Math.cos(s.dir) * 0.3, y: s.y + 0.05, t: 0, kind: 'dust' });
  }
  for (const s of b.soldiers) s.foes = foesNow[s.id];

  const land = (h: Hit, arrow: boolean) => {
    const t = h.t, tq = sq(t.squad);
    t.hp -= h.dmg; t.flash = 0.12;
    tq.lastHit = b.t;
    if (h.by.side !== t.side) tq.hitBy[h.by.squad] = b.t;
    if (arrow && h.by.side !== t.side) tq.arrowsTaken++;
    // courage lost per hit grows with how hard the hit was (a scratch is not a gash)
    // (blows from the front hurt much less with friends close beside you; flank and rear blows don't care)
    if (h.by.side !== t.side) loseMorale(tq, (arrow ? M.arrowHitLoss : h.flank ? M.flankHitLoss : M.frontHitLoss * M.supportFront[tq.support]) * h.dmg / M.hitRef);
    if (!arrow && h.by.id) { t.hurtBy = h.by.id; t.hurtAt = b.t; b.stats.hits[t.side]++; if (h.flank) { b.stats.flankHits[t.side]++; tq.cohesion = Math.max(0, tq.cohesion - B.cohesion.flankHit); } }
    if (h.heavy) t.stagger = Math.max(t.stagger, SO.heavyStagger); // a heavy blow knocks them off balance
    if (h.charge) {
      loseMorale(tq, M.chargedLoss * (h.flank ? 1 : M.supportFront[tq.support])); // a charge into a solid line shakes it less
      tq.cohesion = Math.max(0, tq.cohesion - C.cohesionHit); // and knocks the ranks about
      t.stagger = C.stagger;
      if (h.kb) { const a = Math.atan2(t.y - h.by.y, t.x - h.by.x); t.x += Math.cos(a) * h.kb; t.y = Math.max(0.3, Math.min(b.H - 0.3, t.y + Math.sin(a) * h.kb)); }
    }
    if (rand(b) < 0.5) b.fx.push({ x: t.x, y: t.y - 0.25, t: 0, kind: 'blood' });
    if (t.hp <= 0) {
      t.dead = true; t.hp = 0; t.diedAt = b.t;
      loseMorale(tq, M.deathLoss / tq.members.length * (1 - M.supportDeath * tq.support));
      b.marks.push({ x: t.x + (rand(b) - 0.5) * 0.2, y: t.y + 0.05, k: rand(b) });
    } else if (rand(b) < 0.25) b.marks.push({ x: t.x + (rand(b) - 0.5) * 0.3, y: t.y + 0.05, k: rand(b) });
  };
  for (const h of hits) if (!h.t.dead) land(h, false);

  const weightOf = (s: BSoldier) => { const q = sq(s.squad); return (q.pushing ? B.push.weight : q.bracing ? B.push.braceWeight : 1) * (stats(s.unit).mass ?? 1); };
  // keep soldiers from standing on top of each other (all pushes worked out first, then applied)
  const push: [BSoldier, number, number][] = [];
  for (const s of b.soldiers) {
    if (!alive(s)) continue;
    let px = 0, py = 0, close = false;
    nearby(s.x, s.y, 1, e => {
      if (e === s || !alive(e)) return;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy);
      // enemies shove each other harder than friends do: two fighting lines press against each other instead of mixing
      const foe = e.side !== s.side;
      let wgt = 1; // how much of the shove this soldier takes (pushing or braced men give less; men being driven back give more)
      if (foe) { const we = weightOf(e), ws = weightOf(s); wgt = 2 * we / (we + ws); if (wgt > 1.3 && d < 0.36 && s.stagger <= 0 && rand(b) < B.push.staggerChance) s.stagger = B.push.staggerSeconds; }
      const x = ext(s.unit, e.unit);
      if (foe && d < 0.75 + x) close = true;
      const min = Math.max(bodyR(s.unit) + bodyR(e.unit), e.unit === 'cavalry' || s.unit === 'cavalry' ? 0.4 : 0) + (foe ? B.melee.foeGap : 0);
      if (d > 0.001 && d < min - 0.02) { const k = (min - 0.02 - d) * (foe ? 0.4 * wgt : 0.2); px += (dx / d) * k; py += (dy / d) * k; } // (a little give, so nobody jitters)
    });
    s.inMelee = close;
    if (px || py) push.push([s, px, py]);
  }
  for (const [s, px, py] of push) { s.x += px; s.y = Math.max(0.3, Math.min(b.H - 0.3, s.y + py)); }

  // arrows in flight; a miss can still hit whoever is standing where it comes down
  for (const a of b.arrows) {
    a.t += DT;
    const k = Math.min(1, a.t / a.dur);
    a.x = a.sx + (a.tx - a.sx) * k; a.y = a.sy + (a.ty - a.sy) * k - Math.sin(k * Math.PI) * 0.6 * a.dur;
    if (k >= 1 && a.dmg) {
      const shooterS = { squad: a.squad, side: a.side, x: a.sx, y: a.sy } as BSoldier;
      const t = so(a.target);
      if (a.hit && alive(t)) land({ t, dmg: a.dmg, by: shooterS, charge: false, flank: false, kb: 0, heavy: false }, true);
      else if (rand(b) < B.friendlyFire) {
        let near: BSoldier | null = null, nd = 0.22;
        nearby(a.tx, a.ty, 1, e => { if (!alive(e)) return; const d = Math.hypot(e.x - a.tx, e.y - a.ty); if (d < nd) { nd = d; near = e; } });
        if (near) land({ t: near, dmg: a.dmg, by: shooterS, charge: false, flank: false, kb: 0, heavy: false }, true);
      }
      a.dmg = 0;
    }
  }
  b.arrows = b.arrows.filter(a => a.t < a.dur + 0.6);
  for (const f of b.fx) f.t += DT;
  b.fx = b.fx.filter(f => f.t < 0.6);
  if (b.marks.length > 700) b.marks.splice(0, b.marks.length - 700);

  // end: a side with no squads left fighting loses; the winners chase them off for a few seconds
  const still = [0, 1].map(sd => b.squads.some(q => q.side === sd && active(q)));
  if (b.decidedAt < 0 && (!still[0] || !still[1])) {
    b.decidedAt = b.t;
    b.winner = still[0] && !still[1] ? 0 : still[1] && !still[0] ? 1 : -1;
  }
  const losersLeft = b.decidedAt >= 0 && b.winner !== -1 && b.soldiers.some(s => s.side !== b.winner && alive(s));
  if ((b.decidedAt >= 0 && (b.t - b.decidedAt >= B.pursuitSeconds || !losersLeft)) || b.t >= B.maxSeconds) b.over = true;
}

/**
 * Split a detachment off a squad: its rearmost `n` soldiers become a new small squad (same unit, rank and courage),
 * standing where they are. Used by the commander to send a few men through a gap when there's no reserve to send.
 */
export function detach(b: BattleState, q: BSquad, n: number): BSquad | null {
  const live = q.members.filter(id => fights(b.soldiers[id - 1]));
  if (live.length - n < 3 || n < 2) return null;
  const moved = live.slice(live.length - n); // the last in the order = the rear rank
  q.members = q.members.filter(id => !moved.includes(id));
  let cx = 0, cy = 0;
  for (const id of moved) { const s = b.soldiers[id - 1]; cx += s.x; cy += s.y; }
  cx /= n; cy /= n;
  const d: BSquad = {
    ...q, id: b.squads.length + 1, members: moved, cx, cy, mx: cx, my: cy, homeY: cy,
    state: 'march', target: -1, retarget: 0, flankSide: 0, meleeSince: -1, lull: false, boutEnd: -1, lullAt: -9, chargeAt: -9,
    pushing: false, bracing: false, pushSince: -1, mission: null, hitBy: {}, path: [], pathI: 0, commit: -1, inLine: false, waiting: false,
    viaEdge: false, firstFight: -1, detached: true,
  };
  moved.forEach((id, i) => { const s = b.soldiers[id - 1]; s.squad = d.id; s.slot = i; s.target = -1; });
  b.squads.push(d);
  return d;
}

/** Run a whole battle instantly (for the "run many battles" test). */
export function runBattle(setup: BattleSetup, seed: number, swapSides = false) {
  const b = createBattle(setup, seed, swapSides);
  while (!b.over) stepBattle(b);
  return b;
}
