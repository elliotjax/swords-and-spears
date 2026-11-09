import { CONFIG, type UnitKind } from '../config';

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
export interface SquadSetup { unit: UnitKind; rank: number; x?: number; y?: number; path?: Pt[]; order?: Order }
/** Bonuses from techs for one side (0.1 = +10%). */
export type SideBonus = Partial<Record<'damage' | 'armour' | 'range' | 'charge' | 'morale', number>>;
/** orders[side] = true: the player commanded this side (squads with no arrow hold their ground). */
export interface BattleSetup {
  sides: [SquadSetup[], SquadSetup[]]; bonus?: [SideBonus, SideBonus]; orders?: [boolean, boolean];
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
  ammo: number; volley: number; // archers: arrows left (whole squad); volley unused
  hold: boolean;              // archers: standing still and shooting (only move again if the enemy gets well out of range)
  order: Order;               // the player's order (see Order)
  path: Pt[]; pathI: number;  // the drawn arrow, and the next point on it
  commit: number;             // on a path but caught in a real fight: finish this enemy squad first (-1 = none)
  commitX: number; commitY: number; // where we left the path (don't chase too far from it)
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
}

function rand(b: BattleState) {
  let t = (b.rng = (b.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const unitSize = (u: UnitKind) => CONFIG.military.units[u].size;
const stats = (u: UnitKind) => CONFIG.battle.units[u];
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/** Formation slot i of a squad: (forward, right) offsets from the anchor, in tiles. */
function slotLocal(u: UnitKind, i: number): { f: number; r: number; file: number; rank: number } {
  const S = CONFIG.battle.spacing;
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
const halfFront = (u: UnitKind) => CONFIG.battle.spacing * (u === 'cavalry' ? 3.2 : 2.2);

// ---------- setup ----------

export function createBattle(setup: BattleSetup, seed = 1, swapSides = false): BattleState {
  const B = CONFIG.battle, S = B.soldier;
  // ---- layout: rows of up to maxRow squads, swordsmen in front, then spearmen, then archers; cavalry on the wings ----
  const gap = halfFront('swordsmen') * 2 + 0.6;   // squads stand side by side with a small gap
  const cavGap = halfFront('cavalry') * 2 + 0.6;
  type Spot = { q: SquadSetup; i: number; depth: number; off: number }; // depth: tiles behind the front line; off: sideways from the middle
  const layouts = ([0, 1] as Side[]).map(side => {
    const by: Record<string, { q: SquadSetup; i: number }[]> = { swordsmen: [], spearmen: [], archers: [], cavalry: [] };
    setup.sides[side].forEach((q, i) => by[q.unit].push({ q, i }));
    const spots: Spot[] = [];
    let row = 0, widest = 0;
    for (const u of ['swordsmen', 'spearmen', 'archers'] as UnitKind[]) {
      for (let i = 0; i < by[u].length; i += B.maxRow) {
        const chunk = by[u].slice(i, i + B.maxRow);
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
  };
  if (swapSides) b.home = [W + 3, -3];
  let sid = 1, qid = 1;
  const pick = (r: [number, number]) => r[0] + rand(b) * (r[1] - r[0]);
  for (const side of [0, 1] as Side[]) {
    const nums: Partial<Record<UnitKind, number>> = {};
    const onLeft = (side === 0) !== swapSides;
    const face = onLeft ? 0 : Math.PI;
    const ordered = !!setup.orders?.[side];
    const mx = (x: number) => onLeft ? x : b.W - x;
    const place = (q: SquadSetup, src: number, x: number, y: number) => {
      const fx = mx(x);
      nums[q.unit] = (nums[q.unit] ?? 0) + 1;
      const sq: BSquad = {
        id: qid++, side, unit: q.unit, rank: q.rank, num: nums[q.unit]!, src, members: [],
        cx: fx, cy: y, ang: face, mx: fx, my: y, homeY: y, state: 'march', target: -1, retarget: 0, flankSide: 0,
        broken: false, brokenAt: 0, fleeing: false, gone: false, brokeBy: '',
        morale: B.morale.start, lastFight: -99, lastHit: -99, firstFight: -1, meleeSince: -1,
        withdrawUntil: 0, wx: 0, wy: 0, ammo: q.unit === 'archers' ? B.archerAmmo * unitSize(q.unit) : 0, volley: 0, hold: false, hitBy: {},
        order: q.order ?? (!ordered ? 'free' : q.path && q.path.length ? 'path' : 'hold'),
        inLine: false, lineDepth: 0, fwd: onLeft ? 1 : -1,
        path: (q.path ?? []).map(p => ({ x: mx(p.x), y: p.y })), pathI: 0, commit: -1, commitX: 0, commitY: 0,
      };
      for (let i = 0; i < unitSize(q.unit); i++) {
        const p = slotWorld(sq, i);
        const s: BSoldier = {
          id: sid++, side, squad: sq.id, unit: q.unit, slot: i,
          x: p.x + (rand(b) - 0.5) * 0.06 * (onLeft ? 1 : -1), y: p.y + (rand(b) - 0.5) * 0.06, px: 0, py: 0,
          hp: B.soldierHp, cd: rand(b) * 1.5, target: -1, retarget: rand(b) * 0.3,
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
  return b;
}

// ---------- helpers ----------

const alive = (s: BSoldier) => !s.dead && !s.fled;
/** Still fighting for their squad (alive and not running away on their own). */
const fights = (s: BSoldier) => !s.dead && !s.fled && !s.routing;
export const squadHp = (b: BattleState, q: BSquad) => {
  let hp = 0;
  for (const id of q.members) { const s = b.soldiers[id - 1]; if (fights(s)) hp += s.hp; }
  return hp / (q.members.length * CONFIG.battle.soldierHp);
};
export const squadAlive = (b: BattleState, q: BSquad) => q.members.filter(id => fights(b.soldiers[id - 1])).length;
const active = (q: BSquad) => !q.gone && !q.fleeing;
/** Archers with arrows left shoot; out of arrows they fight like (weak) infantry. */
const shooter = (q: BSquad) => q.unit === 'archers' && q.ammo > 0;
export const wavering = (q: BSquad) => !q.broken && q.morale < CONFIG.battle.morale.waverAt;

/** Is the attacker at (ax, ay) hitting this squad from the side or behind? */
const fromFlank = (defSq: BSquad, def: BSoldier, ax: number, ay: number) =>
  Math.cos(angDiff(defSq.ang, Math.atan2(ay - def.y, ax - def.x))) < -0.2;

function damageOf(b: BattleState, att: BSoldier, attSq: BSquad, def: BSoldier, defSq: BSquad, melee: boolean): number {
  const B = CONFIG.battle, A = stats(att.unit), D = stats(def.unit);
  let dmg = att.unit === 'archers' && melee ? A.meleeDamage ?? A.damage : A.damage;
  dmg *= B.deadliness;
  dmg *= (1 + (b.bonus[att.side].damage ?? 0)) * (1 - (b.bonus[def.side].armour ?? 0));
  dmg *= 1 + B.rankDamage * attSq.rank;
  if (A.strongVs.includes(def.unit)) dmg *= B.counterBonus;
  dmg *= 1 - Math.min(0.6, D.defense + B.rankDefense * defSq.rank);
  // hitting a squad from the side or behind hurts more (it can't face everyone)
  if (melee && fromFlank(defSq, def, att.x, att.y)) dmg *= B.flankBonus;
  return dmg;
}

let moraleResist: [number, number] = [0, 0];
function loseMorale(q: BSquad, amount: number) {
  q.morale -= amount * (1 - CONFIG.battle.morale.rankResist * q.rank) * (1 - moraleResist[q.side]);
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
  const O = B.orders;
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
    if (attackers > 1) loseMorale(q, M.outnumberedPerSec * (attackers - 1) * DT);
    if (b.t - q.lastHit > M.recoverAfter) q.morale = Math.min(M.start, q.morale + M.recoverPerSec * DT);
    const hpBreak = squadHp(b, q) <= B.breakAt, moraleBreak = q.morale <= 0;
    if (hpBreak || moraleBreak) {
      q.broken = true; q.brokenAt = b.t; q.brokeBy = hpBreak ? 'hp' : 'morale'; q.morale = Math.max(0, q.morale);
      newlyBroken.push(q);
    }
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

  // ---- squads: choose a target and move the formation (order flips each step: fair to both sides) ----
  const order = Math.round(b.t * BATTLE_TPS) % 2 ? b.squads : [...b.squads].reverse();
  for (const q of order) {
    if (!active(q)) continue;
    const U = stats(q.unit), isCav = q.unit === 'cavalry';
    const fighting = b.t - q.lastFight < 1.5;
    // cavalry may run down routing enemies; everyone else ignores them
    const targetable = (e: BSquad) => !e.gone && (!e.fleeing || isCav);

    q.retarget -= DT;
    let tq = q.target > 0 ? sq(q.target) : null;
    if (!tq || !targetable(tq) || (q.retarget <= 0 && !fighting && q.state !== 'withdraw')) {
      q.retarget = 1 + rand(b) * 0.5;
      let best: BSquad | null = null, bd = Infinity;
      for (const e of b.squads) {
        if (e.side === q.side || !targetable(e)) continue;
        const ex = e.mx - q.mx, ey = e.my - q.my;
        let d = Math.hypot(ex, ey);
        if (!isCav && !shooter(q)) { // infantry go for the enemy squad opposite them (keeps the line together)
          const fx = Math.cos(q.ang), fy = Math.sin(q.ang);
          d = Math.abs(ex * fx + ey * fy) * 0.45 + Math.abs(-ex * fy + ey * fx) * 1.1;
        }
        if (U.strongVs.includes(e.unit)) d -= 4;             // go for what we beat
        if (stats(e.unit).strongVs.includes(q.unit)) d += 3; // avoid what beats us
        if (isCav && e.unit === 'archers') d -= 3;
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
    // on a path but committed to a real fight: that enemy squad is the target until it's beaten
    if (q.commit > 0) {
      const c = sq(q.commit);
      if (c && !c.gone && !c.broken && !c.fleeing) { tq = c; q.target = c.id; }
    }
    if (!tq) continue;

    const toE = Math.atan2(tq.my - q.my, tq.mx - q.mx);
    const dE = Math.hypot(tq.mx - q.mx, tq.my - q.my);
    const fwdX = Math.cos(q.ang), fwdY = Math.sin(q.ang);
    let gx = q.cx, gy = q.cy, speed = U.speed, faceTo = toE, turnRate = 1.6;
    let contact = false, wp: Pt | null = null;

    if (shooter(q)) {
      // archers: walk up until the enemy is well within range, then stand and shoot volleys
      let nd = Infinity, nx = tq.mx, ny = tq.my;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < nd) { nd = d; nx = e.mx; ny = e.my; } }
      // standing and shooting until the enemy is well out of range, then walk up to a comfortable distance
      const range = rangeOf(q.side, q.unit), want = range * 0.6;
      const a = Math.atan2(ny - q.my, nx - q.mx);
      const wp = q.order === 'path' ? pathStep(q) : null;
      if (wp) { gx = wp.x; gy = wp.y; } // following the player's arrow (shooting at whatever comes in range)
      else if (q.order !== 'hold') {
        if (q.hold && nd > range * 0.9) q.hold = false;
        if (!q.hold && nd <= want + 0.2) q.hold = true;
        if (!q.hold) { gx = nx - Math.cos(a) * want; gy = ny - Math.sin(a) * want; }
      }
      q.state = nd < 1.5 ? 'melee' : 'march';
      faceTo = wp && nd > range ? Math.atan2(gy - q.cy, gx - q.cx) : a; turnRate = 1.5;
    } else if (q.state === 'withdraw') {
      // cavalry pulling out to charge again
      gx = q.wx; gy = q.wy; speed = U.speed * 1.1;
      faceTo = Math.atan2(gy - q.cy, gx - q.cx); turnRate = 3;
      if (Math.hypot(gx - q.cx, gy - q.cy) < 0.6 || b.t > q.withdrawUntil) {
        q.state = 'march'; q.meleeSince = -1;
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
          if (f > 0.3 && f < bestF && r < halfFront(o.unit) + halfFront(q.unit) * 0.7 && squadHp(b, o) > 0.55) { bestF = f; support = o; }
        }
      }
      if (support) { gx = support.cx - Math.cos(toE) * 1.25; gy = support.cy - Math.sin(toE) * 1.25; }

      // is the enemy right in front of our line? (forward gap from our front rank)
      let gap = Infinity;
      const band = halfFront(q.unit) + 0.35, rx = -fwdY, ry = fwdX;
      nearby(q.cx, q.cy, 2.5, e => {
        if (e.side === q.side) return;
        const ex = e.x - q.cx, ey = e.y - q.cy;
        const f = ex * fwdX + ey * fwdY, r = ex * rx + ey * ry;
        if (Math.abs(r) < band && f > -1.2 && f < gap) gap = f; // (enemies pushed into our ranks count too)
      });
      contact = gap < 1.6;

      if (contact || fighting) {
        q.state = 'melee';
        if (q.meleeSince < 0) q.meleeSince = b.t;
        // the stronger squad leans in, the weaker gives ground
        const ours = squadAlive(b, q) / q.members.length * (0.5 + q.morale / 200);
        const theirs = squadAlive(b, tq) / tq.members.length * (0.5 + tq.morale / 200);
        const adv = Math.max(-1, Math.min(1, (ours - theirs) * 2));
        const want = U.reach * (isCav ? 0.55 : 0.8) - adv * B.melee.pressGap;
        if (gap < Infinity) {
          const err = gap - want;
          const step = err > 0 ? Math.min(err, U.speed * 0.5 * DT) : Math.max(err * 0.5, -U.speed * 0.35 * DT);
          gx = q.cx + fwdX * step / DT; gy = q.cy + fwdY * step / DT; // move along our facing
          speed = Math.abs(step) / DT;
        } else {
          speed = U.speed * 0.6; // the enemy slipped away from our front: follow them
        }
        faceTo = toE; turnRate = 0.9; // a fighting line wheels slowly
        // following an arrow and caught in a real (lasting) fight: finish that enemy squad off first
        if (q.order === 'path' && q.commit < 0 && b.t - q.meleeSince > O.commitAfter) { q.commit = tq.id; q.commitX = q.mx; q.commitY = q.my; }
        // cavalry stuck in a grinding melee pull out and charge again (not when told to hold)
        if (isCav && q.order !== 'hold' && tq.unit !== 'archers' && b.t - q.meleeSince > C.cycleAfter && squadHp(b, q) > C.cycleMinHp && !q.broken) {
          q.state = 'withdraw'; q.withdrawUntil = b.t + 6;
          const back = Math.atan2(q.my - tq.my, q.mx - tq.mx);
          q.wx = Math.max(1, Math.min(b.W - 1, q.mx + Math.cos(back) * C.withdrawDist));
          q.wy = Math.max(1, Math.min(b.H - 1, q.my + Math.sin(back) * C.withdrawDist));
        }
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
          faceTo = q.fwd > 0 ? 0 : Math.PI; turnRate = 2;
        } else {
          // close to the enemy: square up to them (ranks closing, weapons ready), then charge
          const charging = dE < C.distance && !support;
          const forming = !charging && !support && !isCav && dE < C.distance + O.formUp;
          q.state = charging ? 'charge' : forming ? 'formup' : 'march';
          speed = support ? U.speed * 0.6 : forming ? marchPace[q.side] * 0.7 : q.state === 'march' && !isCav ? marchPace[q.side] : U.speed * (charging ? 1.2 : 1);
          if (!isFinite(speed)) speed = U.speed;
          faceTo = forming ? toE : Math.hypot(gx - q.cx, gy - q.cy) > 0.6 ? Math.atan2(gy - q.cy, gx - q.cx) : toE;
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
      const m = Math.min(d, Math.max(speed, Math.hypot(rx, ry) > 0 ? 0.4 : 0) * DT);
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
      const m = Math.min(d - stopAt, sp * s.pace * DT);
      s.x += (dx / d) * m; s.y += (dy / d) * m;
      s.dir = Math.atan2(dy, dx); s.step += m * 30; s.moved += m;
    };
    if (q.fleeing || s.routing) {
      goTo(b.home[s.side], s.y + (rand(b) - 0.5) * 0.2, U.speed * B.fleeSpeed);
      if (s.x < -1 || s.x > b.W + 1) s.fled = true;
      continue;
    }
    // badly hurt in a shaken squad, a soldier may lose their nerve and run on their own (brave ones rarely do)
    if (!q.broken && !isCav && s.hp < B.soldierHp * SO.panicHp && q.morale < M.waverAt + 25 &&
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
    const fray = q.meleeSince >= 0 ? Math.min(ML.frayMax, (b.t - q.meleeSince) * ML.frayRate) : 0;
    const leash = (q.broken ? ML.brokenLeash : isCav ? ML.cavLeash : q.state === 'charge' ? 0.5
      : front ? (edge ? ML.edgeLeash : ML.frontLeash) : (edge ? ML.frontLeash : ML.backLeash)) + fray;
    // in a melee, soldiers outside the front rank with nobody to fight go looking (wrapping round, flanking)
    const hunt = q.state === 'melee' && !front && !shoots ? Math.max(leash, (ML.huntLeash + fray) * (0.75 + s.nerve * 0.5)) : leash;

    if (q.state === 'withdraw') { goTo(slot.x, slot.y, U.speed * 1.3); continue; }

    // ---- who to fight ----
    s.retarget -= DT;
    let t = s.target > 0 ? so(s.target) : null;
    const dT = t ? Math.hypot(t.x - s.x, t.y - s.y) : Infinity;
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
        } else {
          // the enemy nearest our place in the line, but also near us
          score = Math.hypot(e.x - slot.x, e.y - slot.y) * 0.7 + d * 0.3;
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
      const d = Math.hypot(t.x - s.x, t.y - s.y);
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
          else if (meleeNow && s.charge && s.moved > 1.5) { // charge impact (spearmen brace against horses)
            charged = true;
            if (isCav) { if (t.unit !== 'spearmen') { dmg *= (U.chargeBonus ?? 1) * (1 + (b.bonus[s.side].charge ?? 0)); kb = C.cavKnockback; } }
            else { dmg *= C.infantryBonus; kb = C.knockback; }
            s.charge = false;
          }
          // every blow is different: glancing, ordinary or heavy
          const roll = rand(b);
          if (roll < SO.glanceChance) dmg *= SO.glance;
          else if (roll > 1 - SO.heavyChance) { dmg *= SO.heavy; heavy = true; }
          else dmg *= 0.85 + rand(b) * 0.3;
          // ganged up on: a soldier fighting several enemies at once can't put everything into each blow
          dmg /= 1 + SO.ganged * Math.max(0, s.foes - 1);
          if (meleeNow) {
            s.lunge = 0.18; s.lungeDir = s.dir;
            const hitP = B.hitChance * s.skill * (1 + SO.gangedHit * Math.max(0, t.foes - 1));
            // the defender may block a blow coming from in front of them (harder with several attackers)
            const facing = Math.cos(angDiff(t.dir, Math.atan2(s.y - t.y, s.x - t.x))) > 0.3;
            // parrying: only blows from the front, not while off balance or mid-swing; much harder if they're busy fighting someone else
            const busy = t.target !== s.id ? SO.busyParry : 1;
            const blockP = facing && t.stagger <= 0 && t.lunge <= 0 && !brace && !charged ? stats(t.unit).block * t.skill * busy / (1 + SO.ganged * Math.max(0, t.foes - 1)) : 0;
            if (rand(b) < hitP && rand(b) >= blockP) hits.push({ t, dmg, by: s, charge: charged, flank: fromFlank(sq(t.squad), t, s.x, s.y), kb, heavy });
            else if (rand(b) < 0.35) b.fx.push({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 - 0.2, t: 0, kind: 'clash' }); // missed or blocked: sparks
            s.cd = (U.meleeCooldown ?? U.cooldown) * B.tempo * (0.8 + rand(b) * 0.4) / (0.9 + s.skill * 0.1);
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
        let tx = t.x - Math.cos(a) * reach * 0.85, ty = t.y - Math.sin(a) * reach * 0.85;
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
    // courage lost per hit grows with how hard the hit was (a scratch is not a gash)
    if (h.by.side !== t.side) loseMorale(tq, (arrow ? M.arrowHitLoss : h.flank ? M.flankHitLoss : M.frontHitLoss) * h.dmg / M.hitRef);
    if (!arrow && h.by.id) { t.hurtBy = h.by.id; t.hurtAt = b.t; }
    if (h.heavy) t.stagger = Math.max(t.stagger, SO.heavyStagger); // a heavy blow knocks them off balance
    if (h.charge) {
      loseMorale(tq, M.chargedLoss);
      t.stagger = C.stagger;
      if (h.kb) { const a = Math.atan2(t.y - h.by.y, t.x - h.by.x); t.x += Math.cos(a) * h.kb; t.y = Math.max(0.3, Math.min(b.H - 0.3, t.y + Math.sin(a) * h.kb)); }
    }
    if (rand(b) < 0.5) b.fx.push({ x: t.x, y: t.y - 0.25, t: 0, kind: 'blood' });
    if (t.hp <= 0) {
      t.dead = true; t.hp = 0; t.diedAt = b.t;
      loseMorale(tq, M.deathLoss / tq.members.length);
      b.marks.push({ x: t.x + (rand(b) - 0.5) * 0.2, y: t.y + 0.05, k: rand(b) });
    } else if (rand(b) < 0.25) b.marks.push({ x: t.x + (rand(b) - 0.5) * 0.3, y: t.y + 0.05, k: rand(b) });
  };
  for (const h of hits) if (!h.t.dead) land(h, false);

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
      if (foe && d < 0.75) close = true;
      const min = (e.unit === 'cavalry' || s.unit === 'cavalry' ? 0.4 : 0.26) + (foe ? 0.12 : 0);
      if (d > 0.001 && d < min - 0.02) { const k = (min - 0.02 - d) * (foe ? 0.4 : 0.2); px += (dx / d) * k; py += (dy / d) * k; } // (a little give, so nobody jitters)
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

/** Run a whole battle instantly (for the "run many battles" test). */
export function runBattle(setup: BattleSetup, seed: number, swapSides = false) {
  const b = createBattle(setup, seed, swapSides);
  while (!b.over) stepBattle(b);
  return b;
}
