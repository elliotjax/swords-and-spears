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

export interface SquadSetup { unit: UnitKind; rank: number }
/** Bonuses from techs for one side (0.1 = +10%). */
export type SideBonus = Partial<Record<'damage' | 'armour' | 'range' | 'charge' | 'morale', number>>;
export interface BattleSetup { sides: [SquadSetup[], SquadSetup[]]; bonus?: [SideBonus, SideBonus] }

export interface BSoldier {
  id: number; side: Side; squad: number; unit: UnitKind; slot: number;
  x: number; y: number; px: number; py: number;
  hp: number; cd: number; target: number; retarget: number;
  dir: number; step: number; flash: number; lunge: number; lungeDir: number;
  dead: boolean; fled: boolean; charge: boolean; moved: number;
  stagger: number;            // knocked off balance by a charge (can't strike)
  diedAt: number;             // battle time of death (for the fall animation)
}
export type SquadState = 'march' | 'charge' | 'melee' | 'withdraw';
export interface BSquad {
  id: number; side: Side; unit: UnitKind; rank: number; num: number;
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
  ammo: number; volley: number; // archers: volleys left, time to next volley
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
  const B = CONFIG.battle;
  const b: BattleState = {
    t: 0, rng: seed, W: B.fieldW, H: B.fieldH, soldiers: [], squads: [], arrows: [], fx: [], marks: [],
    over: false, winner: -1, decidedAt: -1, firstContact: -1, home: [-3, B.fieldW + 3],
    bonus: setup.bonus ?? [{}, {}],
  };
  if (swapSides) b.home = [B.fieldW + 3, -3];
  let sid = 1, qid = 1;
  for (const side of [0, 1] as Side[]) {
    // default formation: swordsmen in front, spearmen behind, archers at the back, cavalry on the flanks
    const lines: Record<string, SquadSetup[]> = { swordsmen: [], spearmen: [], archers: [], cavalry: [] };
    for (const q of setup.sides[side]) lines[q.unit].push(q);
    const depthX: Record<string, number> = { swordsmen: 5.4, spearmen: 4.4, archers: 3.2 };
    const nums: Partial<Record<UnitKind, number>> = {};
    const onLeft = (side === 0) !== swapSides;
    const face = onLeft ? 0 : Math.PI;
    const place = (q: SquadSetup, x: number, y: number) => {
      const fx = onLeft ? x : b.W - x;
      nums[q.unit] = (nums[q.unit] ?? 0) + 1;
      const sq: BSquad = {
        id: qid++, side, unit: q.unit, rank: q.rank, num: nums[q.unit]!, members: [],
        cx: fx, cy: y, ang: face, mx: fx, my: y, homeY: y, state: 'march', target: -1, retarget: 0, flankSide: 0,
        broken: false, brokenAt: 0, fleeing: false, gone: false, brokeBy: '',
        morale: B.morale.start, lastFight: -99, lastHit: -99, firstFight: -1, meleeSince: -1,
        withdrawUntil: 0, wx: 0, wy: 0, ammo: q.unit === 'archers' ? B.archerAmmo : 0, volley: rand(b) * 1.5, hitBy: {},
      };
      for (let i = 0; i < unitSize(q.unit); i++) {
        const p = slotWorld(sq, i);
        const s: BSoldier = {
          id: sid++, side, squad: sq.id, unit: q.unit, slot: i,
          x: p.x + (rand(b) - 0.5) * 0.06 * (onLeft ? 1 : -1), y: p.y + (rand(b) - 0.5) * 0.06, px: 0, py: 0,
          hp: B.soldierHp, cd: rand(b) * 1.5, target: -1, retarget: rand(b) * 0.3,
          dir: face, step: 0, flash: 0, lunge: 0, lungeDir: 0, dead: false, fled: false, charge: true, moved: 0,
          stagger: 0, diedAt: -1,
        };
        s.px = s.x; s.py = s.y;
        b.soldiers.push(s); sq.members.push(s.id);
      }
      b.squads.push(sq);
    };
    const gap = halfFront('swordsmen') * 2 + 0.7; // squads stand side by side with a small gap
    for (const u of ['swordsmen', 'spearmen', 'archers'] as UnitKind[]) {
      const n = lines[u].length;
      lines[u].forEach((q, i) => place(q, depthX[u], b.H / 2 + (i - (n - 1) / 2) * gap));
    }
    const inf = Math.max(lines.swordsmen.length, lines.spearmen.length, lines.archers.length, 1);
    lines.cavalry.forEach((q, i) => {
      const out = ((inf - 1) / 2) * gap + gap * 0.5 + 1.6 + Math.floor(i / 2) * 2.6;
      const y = Math.min(b.H - 1, Math.max(1, b.H / 2 + (i % 2 ? out : -out)));
      place(q, 4.4, y);
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
    for (const id of q.members) { const s = so(id); if (alive(s)) { sx += s.x; sy += s.y; n++; } }
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
    if (o.side === br.side) loseMorale(o, M.friendBrokeLoss);
    else o.morale = Math.min(M.start, o.morale + M.enemyBrokeGain);
  }

  // how many of our squads are already going for each enemy squad (to spread out)
  const attackersOf = new Map<number, number>();
  for (const q of b.squads) if (active(q) && q.target > 0 && !shooter(q)) attackersOf.set(q.target, (attackersOf.get(q.target) ?? 0) + 1);

  // the army advances together: infantry march at the slowest infantry pace until close to the enemy
  const marchPace = [Infinity, Infinity];
  for (const q of b.squads) if (active(q) && q.unit !== 'cavalry') marchPace[q.side] = Math.min(marchPace[q.side], stats(q.unit).speed);

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
        let d = Math.hypot(e.mx - q.mx, e.my - q.my);
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
        if (others > 0 && !shooter(q)) {
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
    if (!tq) continue;

    const toE = Math.atan2(tq.my - q.my, tq.mx - q.mx);
    const dE = Math.hypot(tq.mx - q.mx, tq.my - q.my);
    const fwdX = Math.cos(q.ang), fwdY = Math.sin(q.ang);
    let gx = q.cx, gy = q.cy, speed = U.speed, faceTo = toE, turnRate = 1.6;
    let contact = false;

    if (shooter(q)) {
      // archers: walk up until the enemy is well within range, then stand and shoot volleys
      let nd = Infinity, nx = tq.mx, ny = tq.my;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < nd) { nd = d; nx = e.mx; ny = e.my; } }
      const want = rangeOf(q.side, q.unit) * 0.6;
      const a = Math.atan2(ny - q.my, nx - q.mx);
      if (nd > want) { gx = nx - Math.cos(a) * want; gy = ny - Math.sin(a) * want; }
      q.state = nd < 1.5 ? 'melee' : 'march';
      faceTo = a; turnRate = 1.5;
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
        ax += Math.cos(side) * (halfFront(tq.unit) + 0.8); ay += Math.sin(side) * (halfFront(tq.unit) + 0.8);
      }
      if (isCav && tq.unit === 'archers' && dE > 4) ay += (tq.my > b.H / 2 ? 1 : -1) * 2; // ride round the outer edge
      gx = ax; gy = ay;

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
        // cavalry stuck in a grinding melee pull out and charge again
        if (isCav && tq.unit !== 'archers' && b.t - q.meleeSince > C.cycleAfter && squadHp(b, q) > C.cycleMinHp && !q.broken) {
          q.state = 'withdraw'; q.withdrawUntil = b.t + 6;
          const back = Math.atan2(q.my - tq.my, q.mx - tq.mx);
          q.wx = Math.max(1, Math.min(b.W - 1, q.mx + Math.cos(back) * C.withdrawDist));
          q.wy = Math.max(1, Math.min(b.H - 1, q.my + Math.sin(back) * C.withdrawDist));
        }
      } else {
        q.meleeSince = -1;
        const charging = dE < C.distance;
        q.state = charging ? 'charge' : 'march';
        speed = q.state === 'march' && !isCav ? marchPace[q.side] : U.speed * (charging ? 1.2 : 1);
        if (!charging && !isCav && dE > 8) {
          // marching: keep our place in the battle line, drifting only slowly sideways
          gy = q.cy + (gy - q.cy) * 0.3 + (q.homeY - q.cy) * 0.15;
        }
        faceTo = Math.hypot(gx - q.cx, gy - q.cy) > 0.6 ? Math.atan2(gy - q.cy, gx - q.cx) : toE;
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

    // archers loose a volley together
    if (shooter(q)) {
      q.volley -= DT;
      if (q.volley <= 0) {
        q.volley = U.cooldown * (0.9 + rand(b) * 0.2);
        let any = false;
        for (const id of q.members) { const s = so(id); if (alive(s) && s.target > 0) { s.cd = rand(b) * 0.45; any = true; } }
        if (any) q.ammo--;
      }
    }
  }

  // living members' order in each squad (front rank fills first, so the back steps up into gaps)
  const aliveIdx = new Map<number, number>();
  for (const q of b.squads) { let n = 0; for (const id of q.members) if (alive(so(id))) aliveIdx.set(id, n++); }

  // ---- soldiers (hits are collected and applied together, so neither side strikes first) ----
  const hits: { t: BSoldier; dmg: number; by: BSoldier; charge: boolean; flank: boolean; kb: number }[] = [];
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
      const m = Math.min(d - stopAt, sp * DT);
      s.x += (dx / d) * m; s.y += (dy / d) * m;
      s.dir = Math.atan2(dy, dx); s.step += m * 30; s.moved += m;
    };
    if (q.fleeing) {
      goTo(b.home[s.side], s.y + (rand(b) - 0.5) * 0.2, U.speed * B.fleeSpeed);
      if (s.x < -1 || s.x > b.W + 1) s.fled = true;
      continue;
    }
    const idx = aliveIdx.get(s.id) ?? s.slot;
    const slot = slotWorld(q, idx);
    const front = isCav || slot.rank === 0;
    const edge = slot.file === 0 || slot.file === 4;
    const meleeReach = U.reach + (s.unit === 'spearmen' && slot.rank === 1 ? B.spacing * 1.2 : 0); // spears reach past the front rank
    // how far this soldier may step out of formation to fight
    const ML = B.melee;
    const leash = q.broken ? ML.brokenLeash : isCav ? ML.cavLeash : q.state === 'charge' ? 0.5
      : front ? (edge ? ML.edgeLeash : ML.frontLeash) : (edge ? ML.frontLeash : ML.backLeash);

    if (q.state === 'withdraw') { goTo(slot.x, slot.y, U.speed * 1.3); continue; }

    // pick a soldier to fight: the enemy nearest our place in the line
    s.retarget -= DT;
    let t = s.target > 0 ? so(s.target) : null;
    if (!t || !alive(t) || s.retarget <= 0) {
      s.retarget = 0.2 + rand(b) * 0.15;
      const radius = shoots ? rangeOf(s.side, s.unit) : meleeReach + leash + 0.5;
      let best: BSoldier | null = null, bs = Infinity;
      nearby(s.x, s.y, radius, e => {
        if (e.side === s.side || !alive(e)) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d > radius) return;
        let score = shoots ? d : Math.hypot(e.x - slot.x, e.y - slot.y);
        if (e.squad === q.target) score -= 0.5;
        if (U.strongVs.includes(e.unit)) score -= 0.4;
        if (shoots) {
          if (sq(e.squad).fleeing) score += 6;
          // don't shoot into a melee where our own men are fighting (if there's anything else)
          let friendClose = false;
          nearby(e.x, e.y, 1, f => { if (f.side === s.side && alive(f) && Math.hypot(f.x - e.x, f.y - e.y) < 0.9) friendClose = true; });
          if (friendClose) score += 5;
        }
        if (score < bs) { bs = score; best = e; }
      });
      t = best; s.target = t ? (t as BSoldier).id : -1;
    }

    if (t) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      const meleeNow = !shoots || d < 1.1;
      const reach = meleeNow ? meleeReach : rangeOf(s.side, s.unit);
      if (meleeNow && s.cd > U.cooldown) s.cd = U.cooldown * 0.5; // an archer waiting for the volley draws a sword
      if (d <= reach) {
        s.dir = Math.atan2(t.y - s.y, t.x - s.x);
        // spearmen brace: a charging horse runs onto a set spear (a free strike, whatever the timing)
        const brace = meleeNow && s.unit === 'spearmen' && s.charge && t.unit === 'cavalry' && t.charge && t.moved > 1;
        if ((s.cd <= 0 || brace) && s.stagger <= 0) {
          let dmg = damageOf(b, s, q, t, sq(t.squad), meleeNow);
          let charged = false, kb = 0;
          if (brace) { dmg *= C.braceBonus; s.charge = false; }
          else if (meleeNow && s.charge && s.moved > 1.5) { // charge impact (spearmen brace against horses)
            charged = true;
            if (isCav) { if (t.unit !== 'spearmen') { dmg *= (U.chargeBonus ?? 1) * (1 + (b.bonus[s.side].charge ?? 0)); kb = C.cavKnockback; } }
            else { dmg *= C.infantryBonus; kb = C.knockback; }
            s.charge = false;
          }
          dmg *= 0.85 + rand(b) * 0.3;
          if (meleeNow) {
            s.lunge = 0.18; s.lungeDir = s.dir;
            if (rand(b) < B.hitChance) hits.push({ t, dmg, by: s, charge: charged, flank: fromFlank(sq(t.squad), t, s.x, s.y), kb });
            else if (rand(b) < 0.3) b.fx.push({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 - 0.2, t: 0, kind: 'clash' }); // blocked: sparks
            s.cd = U.cooldown * (0.85 + rand(b) * 0.3);
          } else {
            const dur = d / B.arrowSpeed, spread = 0.15 + d * 0.04;
            const hit = rand(b) < B.arrowHitChance;
            const tx = hit ? t.x : t.x + (rand(b) - 0.5) * spread * 4, ty = hit ? t.y : t.y + (rand(b) - 0.5) * spread * 4;
            b.arrows.push({ x: s.x, y: s.y, sx: s.x, sy: s.y - 0.2, tx, ty, t: 0, dur, target: t.id, dmg, hit, side: s.side, squad: q.id });
            s.cd = 99; // wait for the next volley
          }
          q.lastFight = b.t;
          if (q.firstFight < 0) q.firstFight = b.t;
          if (b.firstContact < 0) b.firstContact = b.t;
        }
        s.moved = 0;
        if (!meleeNow) goTo(slot.x, slot.y, U.speed * 0.6); // archers keep their place while shooting
        else {
          // stay in the line, leaning toward the enemy
          const ox = s.x - slot.x, oy = s.y - slot.y, off = Math.hypot(ox, oy);
          if (off > leash) goTo(slot.x + ox / off * leash, slot.y + oy / off * leash, U.speed);
        }
      } else if (meleeNow) {
        // step toward the enemy, but only as far as our place in the line allows
        const a = Math.atan2(t.y - s.y, t.x - s.x);
        let tx = t.x - Math.cos(a) * reach * 0.85, ty = t.y - Math.sin(a) * reach * 0.85;
        const ox = tx - slot.x, oy = ty - slot.y, off = Math.hypot(ox, oy);
        if (off > leash) { tx = slot.x + ox / off * leash; ty = slot.y + oy / off * leash; }
        goTo(tx, ty, U.speed * (q.state === 'charge' ? 1.3 : 1.1));
      } else {
        goTo(slot.x, slot.y, U.speed * 1.2);
      }
    } else {
      goTo(slot.x, slot.y, U.speed * (q.state === 'charge' ? 1.35 : 1.25));
      if (!isCav && q.state === 'march') s.step = (q.cx * Math.cos(q.ang) + q.cy * Math.sin(q.ang)) * 30; // in step
    }
    if (b.t - q.lastFight > 3) s.charge = true; // a breather restores the charge
    if (isCav && q.state === 'charge' && s.moved > 1 && rand(b) < 0.15) b.fx.push({ x: s.x - Math.cos(s.dir) * 0.3, y: s.y + 0.05, t: 0, kind: 'dust' });
  }

  const land = (h: { t: BSoldier; dmg: number; by: BSoldier; charge: boolean; flank: boolean; kb: number }, arrow: boolean) => {
    const t = h.t, tq = sq(t.squad);
    t.hp -= h.dmg; t.flash = 0.12;
    tq.lastHit = b.t;
    if (h.by.side !== t.side) tq.hitBy[h.by.squad] = b.t;
    if (h.by.side !== t.side) loseMorale(tq, arrow ? M.arrowHitLoss : h.flank ? M.flankHitLoss : M.frontHitLoss);
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
    let px = 0, py = 0;
    nearby(s.x, s.y, 1, e => {
      if (e === s || !alive(e)) return;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy);
      // enemies shove each other harder than friends do: two fighting lines press against each other instead of mixing
      const foe = e.side !== s.side;
      const min = (e.unit === 'cavalry' || s.unit === 'cavalry' ? 0.42 : 0.3) + (foe ? 0.12 : 0);
      if (d > 0.001 && d < min) { const k = (min - d) * (foe ? 0.45 : 0.3); px += (dx / d) * k; py += (dy / d) * k; }
    });
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
      if (a.hit && alive(t)) land({ t, dmg: a.dmg, by: shooterS, charge: false, flank: false, kb: 0 }, true);
      else if (rand(b) < B.friendlyFire) {
        let near: BSoldier | null = null, nd = 0.22;
        nearby(a.tx, a.ty, 1, e => { if (!alive(e)) return; const d = Math.hypot(e.x - a.tx, e.y - a.ty); if (d < nd) { nd = d; near = e; } });
        if (near) land({ t: near, dmg: a.dmg, by: shooterS, charge: false, flank: false, kb: 0 }, true);
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
  const losersLeft = b.decidedAt >= 0 && b.winner !== -1 && b.squads.some(q => q.side !== b.winner && !q.gone && b.soldiers.some(s => s.squad === q.id && alive(s)));
  if ((b.decidedAt >= 0 && (b.t - b.decidedAt >= B.pursuitSeconds || !losersLeft)) || b.t >= B.maxSeconds) b.over = true;
}

/** Run a whole battle instantly (for the "run many battles" test). */
export function runBattle(setup: BattleSetup, seed: number, swapSides = false) {
  const b = createBattle(setup, seed, swapSides);
  while (!b.over) stepBattle(b);
  return b;
}
