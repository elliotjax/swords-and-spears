import { CONFIG, type UnitKind } from '../config';

// =====================================================================
//  Battle simulation. Left side (0) = you, right side (1) = enemy.
//  Every soldier has their own HP. Squads move as rotating formations:
//  the army advances together, squads pick targets (spreading out and
//  going for flanks instead of piling up), charge, and then melt into
//  a brawl where every soldier fights. Knows nothing about drawing.
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
  dead: boolean; fled: boolean; charge: boolean; moved: number;
}
export type SquadState = 'march' | 'charge' | 'melee';
export interface BSquad {
  id: number; side: Side; unit: UnitKind; rank: number; num: number;
  members: number[];
  cx: number; cy: number;     // formation anchor (front-centre of the block)
  ang: number;                // facing angle (radians)
  mx: number; my: number;     // mass centre of living soldiers
  state: SquadState;
  target: number; retarget: number; flankSide: number;
  broken: boolean; brokenAt: number; fleeing: boolean; gone: boolean;
  lastFight: number;          // last time any member struck
  firstFight: number;         // when the squad first fought (-1 = not yet)
}
export interface Arrow { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; target: number; dmg: number; hit: boolean; side: Side }

export interface BattleState {
  t: number; rng: number; W: number; H: number;
  soldiers: BSoldier[]; squads: BSquad[]; arrows: Arrow[];
  over: boolean; winner: Side | -1;
  firstContact: number;       // when the first blow of the battle landed (-1 = not yet)
  home: [number, number];     // x of each side's own edge (where they flee to)
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
function slotLocal(u: UnitKind, i: number): { f: number; r: number } {
  const S = CONFIG.battle.spacing;
  if (u === 'cavalry') return { f: -Math.floor(i / 5) * S * 1.6, r: ((i % 5) - 2) * S * 1.5 };
  const file = i % 5, rank = Math.floor(i / 5);
  return { f: -rank * S, r: (file - 2) * S };
}
function slotWorld(q: BSquad, i: number) {
  const o = slotLocal(q.unit, i), c = Math.cos(q.ang), s = Math.sin(q.ang);
  const r = Math.cos(q.ang) < 0 ? -o.r : o.r; // squads facing left are a true mirror image
  return { x: q.cx + c * o.f - s * r, y: q.cy + s * o.f + c * r };
}
/** Half the width of a squad's front (tiles). */
const halfFront = (u: UnitKind) => CONFIG.battle.spacing * (u === 'cavalry' ? 3.2 : 2.2);

// ---------- setup ----------

export function createBattle(setup: BattleSetup, seed = 1, swapSides = false): BattleState {
  const B = CONFIG.battle;
  const b: BattleState = { t: 0, rng: seed, W: B.fieldW, H: B.fieldH, soldiers: [], squads: [], arrows: [], over: false, winner: -1, firstContact: -1, home: [-3, B.fieldW + 3] };
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
        cx: fx, cy: y, ang: face, mx: fx, my: y, state: 'march', target: -1, retarget: 0, flankSide: 0,
        broken: false, brokenAt: 0, fleeing: false, gone: false, lastFight: -99, firstFight: -1,
      };
      for (let i = 0; i < unitSize(q.unit); i++) {
        const p = slotWorld(sq, i);
        const s: BSoldier = {
          id: sid++, side, squad: sq.id, unit: q.unit, slot: i,
          x: p.x + (rand(b) - 0.5) * 0.06 * (onLeft ? 1 : -1), y: p.y + (rand(b) - 0.5) * 0.06, px: 0, py: 0,
          hp: B.soldierHp, cd: rand(b) * 1.5, target: -1, retarget: rand(b) * 0.3,
          dir: face, step: 0, flash: 0, lunge: 0, lungeDir: 0, dead: false, fled: false, charge: true, moved: 0,
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

function damageOf(att: BSoldier, attSq: BSquad, def: BSoldier, defSq: BSquad, melee: boolean): number {
  const B = CONFIG.battle, A = stats(att.unit), D = stats(def.unit);
  let dmg = att.unit === 'archers' && melee ? A.meleeDamage ?? A.damage : A.damage;
  dmg *= 1 + B.rankDamage * attSq.rank;
  if (A.strongVs.includes(def.unit)) dmg *= B.counterBonus;
  dmg *= 1 - Math.min(0.6, D.defense + B.rankDefense * defSq.rank);
  // hitting a squad from the side or behind hurts more (it can't face everyone)
  const facing = Math.cos(angDiff(defSq.ang, Math.atan2(att.y - def.y, att.x - def.x)));
  if (melee && facing < -0.2) dmg *= B.flankBonus;
  return dmg;
}

// ---------- the tick ----------

export function stepBattle(b: BattleState) {
  if (b.over) return;
  const B = CONFIG.battle;
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

  // ---- squads: health, breaking, mass centre ----
  for (const q of b.squads) {
    if (q.gone) continue;
    let sx = 0, sy = 0, n = 0;
    for (const id of q.members) { const s = so(id); if (alive(s)) { sx += s.x; sy += s.y; n++; } }
    if (!n) { q.gone = true; continue; }
    q.mx = sx / n; q.my = sy / n;
    if (!q.broken && squadHp(b, q) <= B.breakAt) { q.broken = true; q.brokenAt = b.t; }
    if (q.broken && !q.fleeing && b.t - q.brokenAt >= B.fightAfterBreakSeconds) q.fleeing = true;
  }

  // how many of our squads are already going for each enemy squad (to spread out)
  const attackers = new Map<number, number>();
  for (const q of b.squads) if (active(q) && q.target > 0 && q.unit !== 'archers') attackers.set(q.target, (attackers.get(q.target) ?? 0) + 1);

  // the army advances together: infantry march at the slowest infantry pace until close to the enemy
  const marchPace = [Infinity, Infinity];
  for (const q of b.squads) if (active(q) && q.unit !== 'cavalry') marchPace[q.side] = Math.min(marchPace[q.side], stats(q.unit).speed);

  // ---- squads: choose a target and move the formation (order flips each step: fair to both sides) ----
  const order = Math.round(b.t * BATTLE_TPS) % 2 ? b.squads : [...b.squads].reverse();
  for (const q of order) {
    if (!active(q)) continue;
    const U = stats(q.unit);
    const fighting = b.t - q.lastFight < 1.5;

    q.retarget -= DT;
    let tq = q.target > 0 ? sq(q.target) : null;
    if (!tq || !active(tq) || (q.retarget <= 0 && !fighting)) {
      q.retarget = 1 + rand(b) * 0.5;
      // (decisions use the snapshot from the start of this step, so both sides choose 'at the same time')
      let best: BSquad | null = null, bd = Infinity;
      for (const e of b.squads) {
        if (e.side === q.side || !active(e)) continue;
        let d = Math.hypot(e.mx - q.mx, e.my - q.my);
        if (U.strongVs.includes(e.unit)) d -= 4;             // go for what we beat
        if (stats(e.unit).strongVs.includes(q.unit)) d += 3; // avoid what beats us
        if (q.unit === 'cavalry' && e.unit === 'archers') d -= 3;
        if (q.unit !== 'archers') d += ((attackers.get(e.id) ?? 0) - (q.target === e.id ? 1 : 0)) * 3.5; // spread out
        if (e.broken) d += 2;
        if (d < bd) { bd = d; best = e; }
      }
      tq = best; q.target = tq ? tq.id : -1;
      if (tq) {
        // if another of our squads is already on them, swing round to whichever flank is closer
        const others = (attackers.get(tq.id) ?? 0) - (q.target === tq.id ? 1 : 0);
        q.flankSide = others > 0 && q.unit !== 'archers' ? (angDiff(tq.ang, Math.atan2(q.my - tq.my, q.mx - tq.mx)) > 0 ? 1 : -1) : 0;
      }
    }
    if (!tq) continue;

    // where to stand
    const toE = Math.atan2(tq.my - q.my, tq.mx - q.mx);
    const dE = Math.hypot(tq.mx - q.mx, tq.my - q.my);
    let gx: number, gy: number, speed: number;
    if (q.unit === 'archers') {
      // archers: walk up until the enemy is well within range, then stand and shoot
      let nd = Infinity, nx = tq.mx, ny = tq.my;
      for (const e of b.squads) if (e.side !== q.side && active(e)) { const d = Math.hypot(e.mx - q.mx, e.my - q.my); if (d < nd) { nd = d; nx = e.mx; ny = e.my; } }
      const want = (U.range ?? 7) * 0.6;
      const a = Math.atan2(ny - q.my, nx - q.mx);
      gx = nd > want ? nx - Math.cos(a) * want : q.cx; gy = nd > want ? ny - Math.sin(a) * want : q.cy;
      speed = U.speed;
      q.state = nd < 1.5 ? 'melee' : 'march';
      q.ang += Math.max(-1.5 * DT, Math.min(1.5 * DT, angDiff(q.ang, a)));
    } else {
      // approach point: in front of the target, or on its flank if a friend is already there
      let ax = tq.mx, ay = tq.my;
      if (q.flankSide) {
        const side = tq.ang + q.flankSide * Math.PI / 2;
        ax += Math.cos(side) * (halfFront(tq.unit) + 0.8); ay += Math.sin(side) * (halfFront(tq.unit) + 0.8);
      }
      if (q.unit === 'cavalry' && tq.unit === 'archers' && dE > 4) {
        // cavalry ride wide round the side, then turn in
        ay += (tq.my > b.H / 2 ? 1 : -1) * 2; // swing round the outer edge of the field
      }
      gx = ax; gy = ay;
      const close = dE < 5;
      q.state = fighting ? 'melee' : close ? 'charge' : 'march';
      speed = q.state === 'march' && q.unit !== 'cavalry' ? marchPace[q.side] : U.speed * (q.state === 'charge' ? 1.2 : 1);
      if (q.state === 'melee') {
        // in the brawl: the formation anchor follows the mass of the squad
        gx = q.mx + Math.cos(toE) * 0.4; gy = q.my + Math.sin(toE) * 0.4; speed = U.speed * 0.6;
      }
      const turn = (q.state === 'melee' ? 2.5 : 1.6) * DT;
      // face where we're going; once there (or fighting), face the enemy
      const faceTo = Math.hypot(gx - q.cx, gy - q.cy) > 0.6 && q.state !== 'melee' ? Math.atan2(gy - q.cy, gx - q.cx) : toE;
      q.ang += Math.max(-turn, Math.min(turn, angDiff(q.ang, faceTo)));
    }
    // steer around our own squads
    let rx = 0, ry = 0;
    for (const o of b.squads) {
      if (o === q || o.side !== q.side || !active(o)) continue;
      const dx = q.cx - o.cx, dy = q.cy - o.cy, d = Math.hypot(dx, dy), min = halfFront(q.unit) + halfFront(o.unit) + 0.2;
      if (d > 0.01 && d < min) { rx += (dx / d) * (min - d); ry += (dy / d) * (min - d); }
    }
    const dx = gx - q.cx + rx * 0.8, dy = gy - q.cy + ry * 0.8, d = Math.hypot(dx, dy);
    if (d > 0.05) {
      const m = Math.min(d, speed * DT);
      q.cx += (dx / d) * m; q.cy += (dy / d) * m;
    }
    q.cx = Math.max(0.4, Math.min(b.W - 0.4, q.cx)); q.cy = Math.max(0.4, Math.min(b.H - 0.4, q.cy));
  }

  // living members' order in each squad (front rank fills first, so the back steps up into gaps)
  const aliveIdx = new Map<number, number>();
  for (const q of b.squads) { let n = 0; for (const id of q.members) if (alive(so(id))) aliveIdx.set(id, n++); }

  // ---- soldiers (hits are collected and applied together, so neither side strikes first) ----
  const hits: { t: BSoldier; dmg: number }[] = [];
  const N = b.soldiers.length, start = Math.floor(rand(b) * N);
  for (let k = 0; k < N; k++) {
    const s = b.soldiers[(start + k) % N];
    if (!alive(s)) continue;
    s.px = s.x; s.py = s.y;
    if (s.flash > 0) s.flash -= DT;
    if (s.lunge > 0) s.lunge -= DT;
    s.cd -= DT;
    const q = sq(s.squad), U = stats(s.unit);
    const isArcher = s.unit === 'archers', isCav = s.unit === 'cavalry';
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
    const backRank = !isCav && idx >= 5;
    const meleeReach = U.reach + (s.unit === 'spearmen' && backRank ? B.spacing * 1.2 : 0);

    // pick a soldier to fight
    s.retarget -= DT;
    let t = s.target > 0 ? so(s.target) : null;
    if (!t || !alive(t) || s.retarget <= 0) {
      s.retarget = 0.2 + rand(b) * 0.15;
      const brawl = q.state === 'melee' || q.state === 'charge';
      const radius = isArcher ? U.range ?? 7 : isCav ? (brawl ? 5 : 2.5) : brawl ? 4 : B.aggroRange;
      let best: BSoldier | null = null, bs = Infinity;
      nearby(s.x, s.y, radius, e => {
        if (e.side === s.side || !alive(e)) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d > radius) return;
        let score = d;
        if (e.squad === q.target) score -= 0.7;
        if (U.strongVs.includes(e.unit)) score -= 0.6;
        if (score < bs) { bs = score; best = e; }
      });
      t = best; s.target = t ? (t as BSoldier).id : -1;
    }

    const awayFromMass = Math.hypot(s.x - q.mx, s.y - q.my);
    if (t) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      const meleeNow = !isArcher || d < 1.1;
      const reach = meleeNow ? meleeReach : U.range ?? 7;
      if (d <= reach) {
        s.dir = Math.atan2(t.y - s.y, t.x - s.x);
        if (s.cd <= 0) {
          let dmg = damageOf(s, q, t, sq(t.squad), meleeNow);
          if (isCav && s.charge && s.moved > 2) { // charge! (spearmen brace: no bonus against them)
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
          q.lastFight = b.t;
          if (q.firstFight < 0) q.firstFight = b.t;
          if (b.firstContact < 0) b.firstContact = b.t;
        }
        s.moved = 0;
        if (isArcher && !meleeNow) goTo(slot.x, slot.y, U.speed * 0.6); // archers keep up while shooting
      } else if (meleeNow && awayFromMass < 3.2) {
        // close in on the enemy (back ranks push forward into the fight)
        const a = Math.atan2(t.y - s.y, t.x - s.x);
        goTo(t.x - Math.cos(a) * reach * 0.85, t.y - Math.sin(a) * reach * 0.85, U.speed * 1.1);
      } else {
        goTo(slot.x, slot.y, U.speed * 1.2);
      }
    } else {
      goTo(slot.x, slot.y, U.speed * 1.25);
      if (!isCav && q.state === 'march') s.step = (q.cx * Math.cos(q.ang) + q.cy * Math.sin(q.ang)) * 30; // in step
    }
    if (isCav && b.t - q.lastFight > 3) s.charge = true; // a breather restores the charge
  }

  for (const h of hits) {
    if (h.t.dead) continue;
    h.t.hp -= h.dmg; h.t.flash = 0.12;
    if (h.t.hp <= 0) { h.t.dead = true; h.t.hp = 0; }
  }

  // keep soldiers from standing on top of each other (all pushes worked out first, then applied)
  const push: [BSoldier, number, number][] = [];
  for (const s of b.soldiers) {
    if (!alive(s)) continue;
    let px = 0, py = 0;
    nearby(s.x, s.y, 1, e => {
      if (e === s || !alive(e)) return;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy);
      const min = e.unit === 'cavalry' || s.unit === 'cavalry' ? 0.42 : 0.3;
      if (d > 0.001 && d < min) { const k = (min - d) * 0.3; px += (dx / d) * k; py += (dy / d) * k; }
    });
    if (px || py) push.push([s, px, py]);
  }
  for (const [s, px, py] of push) { s.x += px; s.y = Math.max(0.3, Math.min(b.H - 0.3, s.y + py)); }

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
  b.arrows = b.arrows.filter(a => a.t < a.dur + 0.6);

  // end: a side with no squads left on the field (gone or fleeing) loses
  const still = [0, 1].map(sd => b.squads.some(q => q.side === sd && active(q)));
  if (!still[0] || !still[1] || b.t >= B.maxSeconds) {
    b.over = true;
    b.winner = still[0] && !still[1] ? 0 : still[1] && !still[0] ? 1 : -1;
  }
}

/** Run a whole battle instantly (for the "run many battles" test). */
export function runBattle(setup: BattleSetup, seed: number, swapSides = false) {
  const b = createBattle(setup, seed, swapSides);
  while (!b.over) stepBattle(b);
  return b;
}
