import { CONFIG } from '../config';
import { active, detach, halfFront, shooter, squadAlive, wavering, type BattleState, type BSquad, type Side } from './battle';
import type { Commander, Mission } from './commander';

// =====================================================================
//  The push operation: one big, managed charge through a corridor.
//
//  A push has a START point, a DIRECTION and a corridor (7.5 tiles
//  either side of the line from the start along the direction, so
//  15 tiles wide).
//   - Every infantry squad within the radius (20 tiles) of the start
//     that isn't fighting is recruited and CHARGES at once, straight
//     up the corridor in its own lane (nobody walks to the start point
//     first, nobody waits behind a friend): they press in behind the
//     squads already fighting there, bodies stack, the pressure builds.
//   - Squads already fighting in the corridor PUSH; squads fighting
//     just beside it push too (the line leans in) and hold the corners.
//   - Once the corridor is clear of enemies (BROKE THROUGH), the
//     chargers WRAP: they turn along the back of the enemy line both
//     ways, hitting the next enemy squads from behind; enemies standing
//     further back are met by infantry; the corner squads send half
//     their men round.
//
//  It has its own manager that thinks several times a second.
//  Started by the army commander (a few times per battle) or by the
//  player (Battle Lab: Push, then drag from the start in the direction).
//  While a squad is in the push its mission has `op: true` and the army
//  commander leaves it alone.
// =====================================================================

export type OpRole = 'front' | 'assault' | 'corner' | 'line';
export interface PushOp {
  side: Side; by: 'commander' | 'player';
  ax: number; ay: number;   // the start (the centre of the circle troops are recruited from)
  ux: number; uy: number;   // the direction of the push (unit vector)
  half: number;             // half the corridor's width
  since: number; next: number;
  phase: 'assault' | 'wrap';
  wrapAt: number;           // when the corridor was cleared (-1 = not yet)
  lead: number;             // how far up the corridor our foremost squad is (tiles from the start)
  ids: number[]; role: Record<number, OpRole>;
  sides: (-1 | 1)[];        // which ways the push is wrapping (-1 / +1 across the corridor)
  cornersSent: boolean;
  note: string;             // what it is doing, in plain words (shown in the Lab)
  rolled: number;           // enemy squads broken since the breakthrough
}

const NAME: Record<string, string> = { swordsmen: 'swordsmen', heavy: 'heavy swordsmen', boss: 'warlord', spearmen: 'spearmen', archers: 'archers', cavalry: 'cavalry' };
const isFoot = (q: BSquad) => q.unit !== 'cavalry' && !shooter(q);
const ok = (q: BSquad | undefined) => !!q && active(q) && !q.broken;

/** Start a push from (ax, ay) in direction (dx, dy). Returns null if there's nobody to do it with. */
export function startPushOp(b: BattleState, c: Commander, ax: number, ay: number, dx: number, dy: number, by: 'commander' | 'player', everyone = false): PushOp | null {
  const K = CONFIG.battle.commander.op, CK = CONFIG.battle.commander, side = c.side;
  const dl = Math.hypot(dx, dy);
  const mine0 = b.squads.find(q => q.side === side && active(q));
  if (!mine0) return null;
  const ux = dl > 0.01 ? dx / dl : mine0.fwd, uy = dl > 0.01 ? dy / dl : 0;
  const op: PushOp = {
    side, by, ax, ay, ux, uy, half: K.corridor / 2, since: b.t, next: b.t, phase: 'assault', wrapAt: -1, lead: 0,
    ids: [], role: {}, sides: [], cornersSent: false, note: '', rolled: 0,
  };
  const along = (q: BSquad) => (q.mx - ax) * ux + (q.my - ay) * uy, across = (q: BSquad) => -(q.mx - ax) * uy + (q.my - ay) * ux;
  const pool: BSquad[] = [];
  let fronts = 0;
  for (const q of b.squads) {
    if (q.side !== side || !ok(q) || !isFoot(q) || q.unit === 'boss' || wavering(q) || q.mission?.op) continue; // (not squads in a manoeuvre)
    const a = along(q), r = Math.abs(across(q)), d = Math.hypot(q.mx - ax, q.my - ay);
    let role: OpRole | null = null;
    if (q.state === 'melee') {
      // already fighting: in the corridor = push; just beside it = corner; a bit further along the line = lean in
      if (a > -K.behind && d <= K.radius + K.corridor) role = r <= op.half ? 'front' : r <= op.half + K.cornerReach ? 'corner' : r <= op.half + K.lineReach ? 'line' : null;
    } else if (d <= K.radius && q.fatigue < CK.tiredAt && q.mission?.kind !== 'intercept' && q.mission?.postY === undefined) { pool.push(q); continue; }
    if (!role) continue;
    op.ids.push(q.id); op.role[q.id] = role; fronts++;
  }
  // everyone free in the circle charges (the commander's own pushes take the nearest up to a share of the army)
  pool.sort((p, z) => Math.hypot(p.mx - ax, p.my - ay) - Math.hypot(z.mx - ax, z.my - ay));
  const cap = by === 'player' || everyone ? pool.length : Math.max(K.minCap, Math.round(b.squads.filter(q => q.side === side && ok(q) && isFoot(q)).length * K.capShare));
  const chargers = pool.slice(0, cap);
  for (const q of chargers) { op.ids.push(q.id); op.role[q.id] = 'assault'; }
  if (chargers.length < K.minFree && by === 'commander') return null;
  if (!op.ids.length) return null;
  for (const id of op.ids) {
    const q = b.squads[id - 1], r = op.role[id];
    const m: Mission = q.mission ?? { kind: 'advance', target: 0, wing: 0, why: '', since: b.t, until: Infinity };
    if (r === 'assault') q.mission = { kind: 'advance', target: 0, wing: 0, why: 'the push: charging', since: b.t, until: Infinity, op: true, rush: true, push: true };
    else q.mission = { ...m, op: true, until: Infinity, via: undefined, viaDone: undefined, push: true, why: r === 'front' ? 'the push: driving into their line' : r === 'corner' ? 'the push: pushing on the corner' : 'the push: the whole line leans in' };
    q.lull = false; q.inLine = false; q.waiting = false;
    if (q.state === 'withdraw') q.withdrawUntil = b.t;
  }
  op.note = `PUSH: ${chargers.length} squads charging, ${fronts} pushing`;
  pushOpTick(b, c, op); // (orders go out in the same instant: nobody stands about)
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
  const CK = CONFIG.battle.commander, r = ((b.t * 7919) % 1000) / 1000;
  c.op = null; c.opNote = why; c.opNoteUntil = b.t + 6;
  c.nextPush = b.t + CK.pushEvery[0] + (CK.pushEvery[1] - CK.pushEvery[0]) * 0.5;
  c.nextOp = b.t + CK.op.aiEvery[0] + r * (CK.op.aiEvery[1] - CK.op.aiEvery[0]);
  if (c.plan) c.plan.why = why;
}

/** The push manager's think (several times a second). */
export function pushOpTick(b: BattleState, c: Commander, opIn?: PushOp) {
  const op = opIn ?? c.op; if (!op || b.t < op.next) return;
  const K = CONFIG.battle.commander.op, CK = CONFIG.battle.commander, side = op.side;
  op.next = b.t + K.tick;
  const { ax, ay, ux, uy } = op;
  const along = (q: { mx: number; my: number }) => (q.mx - ax) * ux + (q.my - ay) * uy;
  const across = (q: { mx: number; my: number }) => -(q.mx - ax) * uy + (q.my - ay) * ux;
  // who is still with us
  op.ids = op.ids.filter(id => { const q = b.squads[id - 1]; if (ok(q) && q.mission?.op) return true; if (q?.mission) q.mission.op = false; return false; });
  const squads = op.ids.map(id => b.squads[id - 1]);
  const free = squads.filter(q => op.role[q.id] === 'assault');
  const fronts = squads.filter(q => op.role[q.id] !== 'assault');
  const end = (why: string) => { if (c.op === op) endPushOp(b, c, why); };
  if (!squads.length) { end('the push is spent'); return; }
  if (b.t - op.since > K.maxSeconds) { if (op.phase !== 'wrap') c.opsHeld++; end(op.phase === 'wrap' ? `the push broke through and rolled up ${op.rolled} of their squads` : 'the push was held: back to the line'); return; }

  const foes = b.squads.filter(e => e.side !== side && active(e) && !e.fleeing);
  const sent = (id: number, except?: BSquad) => squads.reduce((n, q) => n + (q !== except && q.mission?.target === id && op.role[q.id] === 'assault' ? 1 : 0), 0);
  const order = (q: BSquad, kind: Mission['kind'], target: BSquad, why: string, via?: { x: number; y: number }) => {
    const m = q.mission!;
    if (m.kind === kind && m.target === target.id) { m.why = why; return; }
    q.mission = { kind, target: target.id, wing: 0, why, since: b.t, until: Infinity, op: true, rush: true, push: true, via, viaDone: !via };
    q.retarget = 0; q.lull = false; q.inLine = false; q.waiting = false;
    if (q.state === 'withdraw') q.withdrawUntil = b.t;
  };
  // everyone in the push pushes while they have the legs
  // (the squads beside the corridor only lean in for the first moments: enough to pin the enemy, not enough to wear themselves out)
  for (const q of squads) q.mission!.push = q.fatigue < CK.pushStop && (op.role[q.id] === 'front' || op.role[q.id] === 'assault' || b.t - op.since < K.leanSeconds);
  op.lead = Math.max(0, ...squads.map(along));

  // enemies in the corridor, ahead of the start
  const inCorridor = foes.filter(e => !e.broken && Math.abs(across(e)) <= op.half + 0.5 && along(e) > -K.behind && along(e) < op.lead + K.ahead);
  if (op.phase === 'assault') {
    if (b.t - op.since > K.minAssault && inCorridor.length === 0) {
      op.phase = 'wrap'; op.wrapAt = b.t; c.opsBroke++; op.note = 'the push broke through';
    } else if (b.t - op.since > K.assaultSeconds) {
      c.opsHeld++; end('the push was held: back to the line'); return;
    } else {
      // every charger goes for the first enemy in its own lane of the corridor (a broad charge, not a queue at one point)
      for (const q of free) {
        const cur = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null;
        if (cur && ok(cur) && inCorridor.includes(cur) && (q.state === 'melee' || b.t - q.mission!.since < K.retarget)) continue;
        const qa = along(q), qr = across(q);
        let best: BSquad | null = null, bs = Infinity;
        for (const e of inCorridor) {
          if (e.unit === 'cavalry' && Math.hypot(e.mx - q.mx, e.my - q.my) > 4) continue; // (no chasing horses)
          const s = Math.max(0, along(e) - qa) + Math.abs(across(e) - qr) * K.laneWeight + sent(e.id, q) * K.spread;
          if (s < bs) { bs = s; best = e; }
        }
        if (best) order(q, 'attack', best, `the push: charging their ${NAME[best.unit]}`);
      }
      op.note = `PUSH: ${free.length} squads charging, ${fronts.length} pushing`;
    }
  }
  if (op.phase === 'wrap') {
    // ---- through: turn along the back of their line both ways, and meet anything standing behind it ----
    const lineFoes = foes.filter(e => !e.broken && isFoot(e) && Math.abs(across(e)) > op.half && Math.abs(across(e)) <= op.half + K.wrapReach && along(e) > -K.behind && along(e) < op.lead + 3);
    const row = (dir: -1 | 1) => lineFoes.filter(e => across(e) * dir > 0).sort((p, z) => Math.abs(across(p)) - Math.abs(across(z)));
    const rows = { '-1': row(-1), '1': row(1) } as Record<string, BSquad[]>;
    op.sides = ([-1, 1] as const).filter(d => rows[d].length > 0);
    const behind = foes.filter(e => !e.broken && !lineFoes.includes(e) && along(e) > 0 && along(e) <= op.lead + K.behindDepth && Math.abs(across(e)) <= op.half + K.wrapReach)
      .sort((p, z) => Math.hypot(p.mx - ax, p.my - ay) - Math.hypot(z.mx - ax, z.my - ay));
    const busy = new Set<BSquad>();
    for (const q of free) { const t = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null; if (t && ok(t) && q.state === 'melee' && q.target === t.id) busy.add(q); }
    // 1) dangers behind their line (close, cavalry, or attacking us): one squad each, spearmen for horse
    let guards = 0;
    for (const e of behind) {
      if (guards >= Math.ceil(free.length * K.guardShare)) break;
      const near = Math.min(...free.map(q => Math.hypot(q.mx - e.mx, q.my - e.my)), 99);
      const danger = near < K.dangerRange || e.unit === 'cavalry' || (e.target > 0 && squads.includes(b.squads[e.target - 1]));
      if (sent(e.id) >= 1) { guards++; continue; }
      if (!danger) continue;
      const pick = free.filter(q => !busy.has(q)).sort((p, z) => Math.hypot(p.mx - e.mx, p.my - e.my) - (p.unit === 'spearmen' && e.unit === 'cavalry' ? 4 : 0) - Math.hypot(z.mx - e.mx, z.my - e.my) + (z.unit === 'spearmen' && e.unit === 'cavalry' ? 4 : 0))[0];
      if (!pick) break;
      order(pick, 'attack', e, `the push: meeting their ${NAME[e.unit]} behind their line`); busy.add(pick); guards++;
    }
    // 2) the rest wrap: each onto the next enemy squad along their line (from behind), on the side with fewer of ours so far
    const idx = { '-1': 0, '1': 0 } as Record<string, number>, count = { '-1': 0, '1': 0 } as Record<string, number>;
    for (const q of free) { const m = q.mission!; if (m.kind === 'flank' && m.target > 0 && ok(b.squads[m.target - 1])) count[across(b.squads[m.target - 1]) >= 0 ? 1 : -1]++; }
    for (const q of free.filter(x => !busy.has(x))) {
      if (!op.sides.length) break;
      const cur = q.mission!.target > 0 ? b.squads[q.mission!.target - 1] : null;
      if (cur && ok(cur) && q.mission!.kind === 'flank' && lineFoes.includes(cur)) continue;
      const own = (across(q) >= 0 ? 1 : -1) as -1 | 1;
      const d2: -1 | 1 = op.sides.length === 1 ? op.sides[0] : count[1] === count[-1] ? own : count[1] < count[-1] ? 1 : -1;
      count[d2]++;
      const r = rows[d2];
      while (idx[d2] < r.length && sent(r[idx[d2]].id) >= K.perTarget) idx[d2]++;
      const e = r[Math.min(idx[d2], r.length - 1)];
      if (!e) continue;
      // to a point behind that squad (further up the corridor's direction), on the corridor side of it; then onto it
      const nx = -uy, ny = ux;
      const via = { x: e.mx + ux * K.wrapDepth - nx * d2 * (halfFront(e.unit) + 0.6), y: e.my + uy * K.wrapDepth - ny * d2 * (halfFront(e.unit) + 0.6) };
      order(q, 'flank', e, `the push: through their line, wrapping behind their ${NAME[e.unit]}`, via);
    }
    // 3) the corners: each corner squad sends half its men round the back of the enemy it is fighting, and holds with the rest
    if (!op.cornersSent && b.t - op.wrapAt > K.cornerDelay) {
      op.cornersSent = true;
      for (const q of squads.filter(s => op.role[s.id] === 'corner')) {
        const e = q.target > 0 ? b.squads[q.target - 1] : null;
        if (!e || !ok(e) || q.detached || squadAlive(b, q) < K.cornerMin || q.cohesion < K.cornerCohesion || wavering(q)) continue;
        const dir = across(q) > 0 ? 1 : -1;
        const d = detach(b, q, Math.floor(squadAlive(b, q) * K.cornerShare));
        if (!d) continue;
        c.detachments++;
        const nx = -uy, ny = ux;
        const via = { x: e.mx + ux * K.wrapDepth - nx * dir * (halfFront(e.unit) + 0.6), y: e.my + uy * K.wrapDepth - ny * dir * (halfFront(e.unit) + 0.6) };
        d.mission = { kind: 'flank', target: e.id, wing: 0, why: `the push: half of our ${NAME[q.unit]} round the corner, the rest hold it`, since: b.t, until: Infinity, op: true, rush: true, push: true, via, viaDone: false };
        op.ids.push(d.id); op.role[d.id] = 'assault';
        q.mission!.why = 'holding the corner of the push (half sent round)';
      }
    }
    op.rolled = b.squads.filter(e => e.side !== side && e.broken && e.brokenAt >= op.wrapAt && Math.abs(across(e)) <= op.half + K.wrapReach).length;
    op.note = op.sides.length ? `broke through: wrapping ${op.sides.length === 2 ? 'both ways' : 'one way'} behind their line${guards ? `, ${guards} meeting enemies behind it` : ''}` : 'broke through: nothing left of their line here';
    if (!op.sides.length && !behind.some(e => sent(e.id) > 0) && b.t - op.wrapAt > 3) { end(`the push broke through and rolled up ${op.rolled} of their squads`); return; }
  }
  if (c.plan && c.op === op) c.plan.why = op.note;
}
