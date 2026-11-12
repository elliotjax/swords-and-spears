import { CONFIG } from '../config';
import { active, detach, halfFront, shooter, squadAlive, squadHp, wavering, type BattleState, type BSquad, type Side } from './battle';
import type { Commander, Mission } from './commander';

// =====================================================================
//  The push operation: one big, managed attack on a stretch of the
//  battle line (about 10 tiles wide).
//
//  It has its own little manager that thinks several times a second
//  (the army commander thinks every 1.5 s, too slow for this):
//   1. ASSAULT: the squads fighting on that stretch push; every reserve
//      and free infantry squad within the radius charges in there, at
//      the thinnest part of the enemy line.
//   2. WRAP (once their line is broken there): the squads pour through
//      and turn left and/or right behind the enemy line, hitting the
//      next enemy squads along it from behind. Enemies standing behind
//      the line (reserves, wanderers) are met by infantry. The squads
//      holding the corners of the push send half their men round too,
//      and hold the corner with the rest.
//
//  Started by the army commander when it orders a push, or by the
//  player (Battle Lab: Push, then tap or draw on the line).
//  While a squad is in the push its mission has `op: true` and the army
//  commander leaves it alone.
// =====================================================================

export type OpRole = 'front' | 'assault' | 'corner';
export interface PushOp {
  side: Side; by: 'commander' | 'player';
  x: number; y: number; half: number;   // the point on the battle line, and half the width of the stretch
  since: number; next: number;
  phase: 'assault' | 'wrap';
  wrapAt: number;                        // when the line broke (-1 = not yet)
  breachY: number;                       // where they broke through
  ids: number[]; role: Record<number, OpRole>;
  sides: (-1 | 1)[];                     // which ways the push is wrapping
  cornersSent: boolean;
  note: string;                          // what it is doing, in plain words (shown in the Lab)
  // what it measured of the battle line (for the Lab and the tools)
  lineLo: number; lineHi: number; density: number;
  rolled: number;                        // enemy line squads broken while wrapping
}

const NAME: Record<string, string> = { swordsmen: 'swordsmen', heavy: 'heavy swordsmen', boss: 'warlord', spearmen: 'spearmen', archers: 'archers', cavalry: 'cavalry' };
const isFoot = (q: BSquad) => q.unit !== 'cavalry' && !shooter(q);
const ok = (q: BSquad | undefined) => !!q && active(q) && !q.broken;

/** The battle line as the push sees it: tile-wide slices along the line, with how many enemy soldiers are fighting in each and where their front is. */
function measure(b: BattleState, side: Side) {
  const fwd = side === 0 ? 1 : -1; // (side 0 may be on either half: take it from a squad below)
  const mine = b.squads.find(q => q.side === side && active(q));
  const f = mine ? mine.fwd : fwd;
  const n = Math.ceil(b.H) + 1;
  const dens = new Float32Array(n), front = new Float32Array(n).fill(Infinity), ours = new Float32Array(n).fill(-Infinity);
  for (const s of b.soldiers) {
    if (s.dead || s.fled || s.unit === 'cavalry') continue;
    const k = Math.max(0, Math.min(n - 1, Math.floor(s.y)));
    if (s.side === side) { if (s.inMelee) ours[k] = Math.max(ours[k], s.x * f); continue; }
    if (s.routing) continue;
    const q = b.squads[s.squad - 1];
    if (!(s.inMelee || q.state === 'melee')) continue; // the fighting line only
    dens[k]++; front[k] = Math.min(front[k], s.x * f);
  }
  let lo = -1, hi = -1;
  for (let k = 0; k < n; k++) if (dens[k] > 0) { if (lo < 0) lo = k; hi = k; }
  return { f, n, dens, front, ours, lo, hi };
}

/** Start a push on the battle line near (x, y), `width` tiles wide. Returns null if there's nobody to do it with. */
export function startPushOp(b: BattleState, c: Commander, x: number, y: number, width: number, by: 'commander' | 'player'): PushOp | null {
  const K = CONFIG.battle.commander.op, side = c.side;
  const M = measure(b, side);
  if (M.lo < 0) return null;
  // snap to the fighting line: the nearest slice with fighting in it, and the front there
  let k0 = Math.max(M.lo, Math.min(M.hi, Math.round(y)));
  for (let d = 0; d < M.n; d++) { if (M.dens[k0 - d] > 0) { k0 -= d; break; } if (M.dens[k0 + d] > 0) { k0 += d; break; } }
  const half = Math.max(K.minWidth, Math.min(K.maxWidth, width)) / 2;
  const fx = isFinite(M.front[k0]) ? M.front[k0] * M.f : x;
  const op: PushOp = {
    side, by, x: fx, y: k0 + 0.5, half, since: b.t, next: b.t, phase: 'assault', wrapAt: -1, breachY: k0 + 0.5,
    ids: [], role: {}, sides: [], cornersSent: false, note: '', lineLo: M.lo, lineHi: M.hi + 1, density: 0, rolled: 0,
  };
  const CK = CONFIG.battle.commander;
  let free = 0, fronts = 0;
  for (const q of b.squads) {
    if (q.side !== side || !ok(q) || !isFoot(q) || q.unit === 'boss' || wavering(q)) continue;
    const dy = Math.abs(q.my - op.y), d = Math.hypot(q.mx - op.x, q.my - op.y);
    let role: OpRole | null = null;
    if (q.state === 'melee' && !q.mission?.rush) role = dy <= half ? 'front' : dy <= half + K.cornerReach ? 'corner' : null;
    else if (d <= K.radius && q.fatigue < CK.tiredAt && q.mission?.kind !== 'intercept' && q.mission?.postY === undefined) {
      // (the second line only joins where it stands behind the stretch being pushed: elsewhere it keeps backing its own front squad)
      const fr = q.mission?.kind === 'second' && q.mission.friend ? b.squads[q.mission.friend - 1] : null;
      if (!fr || Math.abs(fr.my - op.y) <= half + 2) role = 'assault';
    }
    if (!role) continue;
    op.ids.push(q.id); op.role[q.id] = role;
    if (role === 'assault') free++; else if (role === 'front') fronts++;
  }
  // a push takes the nearest free squads up to a cap (a big army doesn't throw its whole reserve into one push)
  const cap = Math.max(K.minCap, Math.round(b.squads.filter(q => q.side === side && ok(q) && isFoot(q)).length * K.capShare));
  const assault = op.ids.filter(id => op.role[id] === 'assault').sort((a, z) => Math.hypot(b.squads[a - 1].mx - op.x, b.squads[a - 1].my - op.y) - Math.hypot(b.squads[z - 1].mx - op.x, b.squads[z - 1].my - op.y));
  for (const id of assault.slice(cap)) { op.ids.splice(op.ids.indexOf(id), 1); delete op.role[id]; free--; }
  if (free < K.minFree && by === 'commander') return null; // nobody to pour in: the commander's ordinary push will do
  if (free + fronts === 0) return null;
  for (const id of op.ids) {
    const q = b.squads[id - 1], r = op.role[id];
    const m: Mission = q.mission ?? { kind: 'advance', target: 0, wing: 0, why: '', since: b.t, until: Infinity };
    q.mission = { ...m, op: true, until: Infinity, since: r === 'assault' ? b.t : m.since, via: undefined, viaDone: undefined };
    if (r === 'front') { q.mission.push = true; q.mission.why = 'the push: driving into their line'; }
    if (r === 'corner') { q.mission.push = false; q.mission.why = 'holding the corner of the push'; }
    q.lull = false; if (q.state === 'withdraw' && r !== 'assault') q.withdrawUntil = b.t;
  }
  op.note = `push on a ${Math.round(half * 2)}-tile front: ${free} squads charging in, ${fronts} pushing`;
  return op;
}

/** Let every squad go back to the army commander. */
export function endPushOp(b: BattleState, c: Commander, why: string) {
  const op = c.op; if (!op) return;
  for (const id of op.ids) {
    const q = b.squads[id - 1], m = q?.mission;
    if (!m) continue;
    m.op = false; m.until = b.t; m.push = false; m.rush = false;
    // everyone goes back to the line (the army commander sorts out front, second line and reserve again)
    if (q.state !== 'melee' || op.role[id] !== 'assault') { m.kind = 'advance'; m.target = 0; m.why = 'back to the line after the push'; m.via = undefined; }
  }
  c.op = null; c.opNote = `${why}`; c.opNoteUntil = b.t + 6;
  c.nextPush = b.t + CONFIG.battle.commander.pushEvery[0] + (CONFIG.battle.commander.pushEvery[1] - CONFIG.battle.commander.pushEvery[0]) * 0.5;
  if (c.plan) c.plan.why = why;
}

/** The push manager's think (several times a second). */
export function pushOpTick(b: BattleState, c: Commander) {
  const op = c.op; if (!op || b.t < op.next) return;
  const K = CONFIG.battle.commander.op, CK = CONFIG.battle.commander, side = op.side;
  op.next = b.t + K.tick;
  const M = measure(b, side), f = M.f;
  op.lineLo = M.lo; op.lineHi = M.hi + 1;
  // who is still with us
  op.ids = op.ids.filter(id => { const q = b.squads[id - 1]; if (ok(q) && q.mission?.op) return true; if (q?.mission) q.mission.op = false; return false; });
  const squads = op.ids.map(id => b.squads[id - 1]);
  const free = squads.filter(q => op.role[q.id] === 'assault');
  const fronts = squads.filter(q => op.role[q.id] === 'front');
  if (!free.length && !fronts.length) { endPushOp(b, c, 'the push is spent'); return; }
  if (b.t - op.since > K.maxSeconds) { endPushOp(b, c, op.phase === 'wrap' ? `the push broke through and rolled up ${op.rolled} of their squads` : 'the push was held: back to the line'); c.opsHeld += op.phase === 'wrap' ? 0 : 1; return; }

  const k0 = Math.max(0, Math.floor(op.y - op.half)), k1 = Math.min(M.n - 1, Math.ceil(op.y + op.half) - 1);
  let total = 0; for (let k = k0; k <= k1; k++) total += M.dens[k];
  op.density = total / Math.max(1, k1 - k0 + 1);
  const foes = b.squads.filter(e => e.side !== side && ok(e));
  // their front (forward distance, our way) near a point along the line
  const frontAt = (y: number) => { let best = Infinity; for (let k = Math.max(0, Math.floor(y) - 2); k <= Math.min(M.n - 1, Math.floor(y) + 2); k++) best = Math.min(best, M.front[k]); return isFinite(best) ? best : op.x * f; };
  const inLine = (e: BSquad) => isFoot(e) && (e.state === 'melee' || e.mx * f - frontAt(e.my) < K.lineDepth);
  const sent = (id: number, except?: BSquad) => squads.reduce((a, q) => a + (q !== except && q.mission?.target === id && op.role[q.id] === 'assault' ? 1 : 0), 0);
  const order = (q: BSquad, kind: Mission['kind'], target: BSquad, why: string, via?: { x: number; y: number }) => {
    const m = q.mission!;
    if (m.kind === kind && m.target === target.id) { m.why = why; return; }
    q.mission = { kind, target: target.id, wing: 0, why, since: b.t, until: Infinity, op: true, rush: true, via, viaDone: !via };
    q.retarget = 0; q.lull = false; if (q.state === 'withdraw') q.withdrawUntil = b.t;
  };
  // squads pushing on the stretch keep pushing while they have the legs
  for (const q of fronts) { const m = q.mission!; m.push = q.fatigue < CK.pushStop && q.state === 'melee'; }

  if (op.phase === 'assault') {
    // ---- break in: everyone free goes at the thinnest part of their line on this stretch ----
    const targets = foes.filter(e => inLine(e) && Math.abs(e.my - op.y) <= op.half + 1);
    // has their line gone here? (no enemy squads left on the stretch, or a hole 3+ tiles wide with our men at it)
    let hole = -1, run = 0, bestRun = 0;
    for (let k = k0; k <= k1; k++) { if (M.dens[k] === 0) { run++; if (run > bestRun) { bestRun = run; hole = k - (run - 1) / 2 + 0.5; } } else run = 0; }
    const broke = b.t - op.since > K.minAssault && (targets.length === 0 || bestRun >= K.breachWidth);
    if (broke) {
      op.phase = 'wrap'; op.wrapAt = b.t; op.breachY = targets.length === 0 ? op.y : hole; c.opsBroke++;
      op.note = 'the push broke through';
    } else if (b.t - op.since > K.assaultSeconds) {
      endPushOp(b, c, 'the push was held: back to the line'); c.opsHeld++; return;
    } else {
      // density of each target's stretch: thin and weak first
      const thin = (e: BSquad) => { let d = 0; for (let k = Math.max(0, Math.floor(e.my) - 1); k <= Math.min(M.n - 1, Math.floor(e.my) + 1); k++) d += M.dens[k]; return d; };
      for (const q of free) {
        const cur = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null;
        if (cur && ok(cur) && targets.includes(cur) && (q.state === 'melee' || b.t - q.mission!.since < 6)) continue; // committed
        let best: BSquad | null = null, bs = Infinity;
        for (const e of targets) {
          const s = Math.hypot(e.mx - q.mx, e.my - q.my) + thin(e) * K.densityWeight + squadHp(b, e) * 3 + sent(e.id, q) * K.spread;
          if (s < bs) { bs = s; best = e; }
        }
        if (best) order(q, 'attack', best, `the push: breaking their line (their ${NAME[best.unit]})`);
      }
      op.note = `push on a ${Math.round(op.half * 2)}-tile front: ${free.length} squads charging in, ${fronts.length} pushing`;
    }
  }
  if (op.phase === 'wrap') {
    // ---- through: turn along the back of their line, and meet anything standing behind it ----
    const bf = frontAt(op.breachY); // their front at the breach
    const lineFoes = foes.filter(inLine);
    const side1 = (dir: -1 | 1) => lineFoes.filter(e => (e.my - op.breachY) * dir > 0.5 && Math.abs(e.my - op.breachY) <= K.wrapReach).sort((a, z) => Math.abs(a.my - op.breachY) - Math.abs(z.my - op.breachY));
    const rows = { '-1': side1(-1), '1': side1(1) } as Record<string, BSquad[]>;
    op.sides = ([-1, 1] as const).filter(d => rows[d].length > 0);
    // enemies behind their line (reserves, archers, wanderers), up to behindDepth tiles back: judged and met with infantry
    const behind = foes.filter(e => !inLine(e) && !e.fleeing && e.mx * f - bf > 0.5 && e.mx * f - bf <= K.behindDepth && Math.abs(e.my - op.breachY) <= op.half + K.wrapReach)
      .sort((a, z) => Math.hypot(a.mx - op.x, a.my - op.breachY) - Math.hypot(z.mx - op.x, z.my - op.breachY));
    const busy = new Set<BSquad>();
    const keep = (q: BSquad) => { const t = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null; return !!t && ok(t) && q.state === 'melee' && q.target === t.id; };
    for (const q of free) if (keep(q)) busy.add(q);
    // 1) the ones behind the line that are a danger (close to the breach, or coming): one squad each, spearmen for horse
    let guards = 0;
    for (const e of behind) {
      if (guards >= Math.ceil(free.length * K.guardShare)) break;
      const near = Math.hypot(e.mx * f - bf, e.my - op.breachY);
      const danger = near < K.dangerRange || e.unit === 'cavalry' || (e.target > 0 && squads.includes(b.squads[e.target - 1]));
      if (!danger || sent(e.id) >= 1) { if (sent(e.id) >= 1) guards++; continue; }
      const pick = free.filter(q => !busy.has(q)).sort((a, z) => Math.hypot(a.mx - e.mx, a.my - e.my) - (a.unit === 'spearmen' && e.unit === 'cavalry' ? 4 : 0) - Math.hypot(z.mx - e.mx, z.my - e.my) + (z.unit === 'spearmen' && e.unit === 'cavalry' ? 4 : 0))[0];
      if (!pick) break;
      order(pick, 'attack', e, `the push: meeting their ${NAME[e.unit]} behind their line`); busy.add(pick); guards++;
    }
    // 2) the rest wrap: alternately left and right, each onto the next enemy squad along the line, from behind
    const idx = { '-1': 0, '1': 0 } as Record<string, number>;
    const count = { '-1': 0, '1': 0 } as Record<string, number>;
    for (const q of free) { const m = q.mission!; if (m.kind === 'flank' && m.target > 0 && ok(b.squads[m.target - 1])) count[(b.squads[m.target - 1].my - op.breachY) >= 0 ? 1 : -1]++; }
    let turn = 0;
    const rest = free.filter(q => !busy.has(q)).sort((a, z) => Math.abs(a.my - op.breachY) - Math.abs(z.my - op.breachY));
    for (const q of rest) {
      if (!op.sides.length) break;
      // keep a wrap order that is still good
      const cur = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null;
      if (cur && ok(cur) && q.mission!.kind === 'flank' && lineFoes.includes(cur)) continue;
      // (the side with fewer squads so far; a tie goes to the side the squad is already on)
      const own = (q.my - op.breachY >= 0 ? 1 : -1) as -1 | 1;
      const d2: -1 | 1 = op.sides.length === 1 ? op.sides[0] : count[1] === count[-1] ? own : count[1] < count[-1] ? 1 : -1;
      count[d2]++; turn++;
      const row = rows[d2];
      while (idx[d2] < row.length && sent(row[idx[d2]].id) >= K.perTarget) idx[d2]++;
      const e = row[Math.min(idx[d2], row.length - 1)];
      if (!e) continue;
      // through the breach, then to a point behind that squad on the breach side of it
      const via = { x: (Math.max(bf, e.mx * f) + K.wrapDepth) * f, y: e.my - d2 * (halfFront(e.unit) + 0.6) };
      order(q, 'flank', e, `the push: through their line, wrapping ${d2 * f < 0 ? 'left' : 'right'} behind their ${NAME[e.unit]}`, via);
    }
    // 3) the corners: each squad holding a corner sends half its men round the back of the enemy it is fighting, and holds with the rest
    if (!op.cornersSent && b.t - op.wrapAt > K.cornerDelay) {
      op.cornersSent = true;
      for (const q of squads.filter(s => op.role[s.id] === 'corner')) {
        const e = q.target > 0 ? b.squads[q.target - 1] : null;
        const n = Math.floor(squadAlive(b, q) * K.cornerShare);
        if (!e || !ok(e) || q.detached || squadAlive(b, q) < K.cornerMin || q.cohesion < K.cornerCohesion || wavering(q)) continue;
        const dir = (q.my - op.breachY) > 0 ? 1 : -1;
        if (!op.sides.includes(dir as -1 | 1)) continue;
        const d = detach(b, q, n);
        if (!d) continue;
        c.detachments++;
        const via = { x: (Math.max(bf, e.mx * f) + K.wrapDepth) * f, y: e.my - dir * (halfFront(e.unit) + 0.6) };
        d.mission = { kind: 'flank', target: e.id, wing: 0, why: `the push: half of our ${NAME[q.unit]} round the corner, the rest hold it`, since: b.t, until: Infinity, op: true, rush: true, via, viaDone: false };
        op.ids.push(d.id); op.role[d.id] = 'assault';
        q.mission!.why = 'holding the corner of the push (half sent round)';
      }
    }
    op.rolled = b.squads.filter(e => e.side !== side && e.brokenAt >= op.wrapAt && e.broken && isFoot(e) && Math.abs(e.my - op.breachY) <= K.wrapReach + op.half).length;
    op.note = op.sides.length ? `broke through: wrapping ${op.sides.length === 2 ? 'both ways' : op.sides[0] * f < 0 ? 'left' : 'right'} behind their line${guards ? `, ${guards} meeting enemies behind it` : ''}` : 'broke through: nothing left of their line here';
    if (!op.sides.length && !behind.some(e => sent(e.id) > 0) && b.t - op.wrapAt > 3) { endPushOp(b, c, `the push broke through and rolled up ${op.rolled} of their squads`); return; }
  }
  if (c.plan) c.plan.why = op.note;
}
