import { CONFIG } from '../config';
import { active, halfFront, shooter, squadAlive, squadHp, wavering, type BattleState, type BSquad } from './battle';
import type { Commander, Mission } from './commander';
import { startPushOp } from './pushop';

// =====================================================================
//  Manoeuvres: the army commander's bigger decisions once the fight is on.
//
//  The infantry is looked at as three battle groups along the line (left
//  wing, centre, right wing). They are not separate armies: they share one
//  line; a group is just "the squads on that part of it". Every few seconds
//  (when no manoeuvre or push is under way) the commander judges each group
//  (our strength there against theirs, how thin our whole line has become)
//  and may order ONE manoeuvre, which it then sees through:
//
//   - CONTRACT: the army has shrunk and its line is long and thin: everyone
//     falls back a few tiles and re-forms a shorter line, two squads deep.
//   - REFUSE: a wing is losing while the centre holds: that wing pulls back
//     and re-forms bent behind the centre, so the enemy has to come round.
//   - MASS: gather every free squad behind one wing (the strong one, or the
//     one the plan strikes at), then launch a push from there.
//   - SHIFT: move the free squads of a quiet group behind a group that is
//     losing.
//
//  Squads in a manoeuvre have mission `reform` (go to a post and stand in
//  line there; pull out of a fight to do it) with `op: true`, so the rest of
//  the commander's logic leaves them alone until the manoeuvre is over.
//  Which manoeuvre is chosen is a weighted pick shaped by the commander's
//  character, so battles differ. Numbers: CONFIG.battle.commander.man.
// =====================================================================

export type ManKind = 'contract' | 'refuse' | 'mass' | 'shift';
export interface Maneuver {
  kind: ManKind; since: number; until: number; note: string;
  ids: number[];                       // squads carrying it out
  wing: -1 | 0 | 1;
  pairs: Record<number, number>;       // contract: back-row squad id -> the front squad it stands behind
  pushAt?: { x: number; y: number };   // mass: where the push starts once gathered
}

const NAME: Record<string, string> = { swordsmen: 'swordsmen', heavy: 'heavy swordsmen', boss: 'warlord', spearmen: 'spearmen', archers: 'archers', cavalry: 'cavalry' };
const isFoot = (q: BSquad) => q.unit !== 'cavalry' && !shooter(q) && q.unit !== 'boss';
const hash01 = (a: number, b: number) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function maneuverThink(b: BattleState, c: Commander) {
  const K = CONFIG.battle.commander.man, CK = CONFIG.battle.commander, side = c.side;
  if (c.contactAt < 0) return;
  const all = b.squads.filter(q => q.side === side && active(q) && !q.broken && isFoot(q));
  const foes = b.squads.filter(e => e.side !== side && active(e) && !e.broken && isFoot(e));
  if (!c.inf0) c.inf0 = all.length;
  if (!all.length) return;
  const fwd = all[0].fwd, gapW = halfFront('swordsmen') * 2 + 0.6;
  const wingName = (w: number) => (w === 0 ? 'centre' : w * fwd < 0 ? 'left' : 'right');
  const reform = (q: BSquad, x: number, y: number, why: string, until: number) => {
    q.mission = { kind: 'reform', target: 0, wing: 0, why, since: b.t, until, op: true, post: { x: Math.max(1, Math.min(b.W - 1, x)), y: Math.max(1, Math.min(b.H - 1, y)) }, viaDone: false };
    q.lull = false; q.inLine = false; q.pushing = false;
  };
  const release = (q: BSquad, m: Partial<Mission> & { kind: Mission['kind']; why: string }) => {
    q.mission = { target: 0, wing: 0, since: b.t, until: b.t + 3, ...m };
  };

  // ---- a manoeuvre under way: see it through ----
  const man = c.man;
  if (man) {
    const ids = man.ids.filter(id => { const q = b.squads[id - 1]; return q && active(q) && !q.broken && q.mission?.kind === 'reform' && q.mission.op; });
    const squads = ids.map(id => b.squads[id - 1]);
    const there = squads.filter(q => q.mission!.viaDone).length;
    const done = b.t >= man.until || !squads.length || there >= squads.length * K.arrived;
    if (!done) { if (c.plan) c.plan.why = man.note; return; }
    if (man.kind === 'contract') {
      for (const q of squads) {
        const f = man.pairs[q.id];
        if (f && b.squads[f - 1] && active(b.squads[f - 1]) && !b.squads[f - 1].broken) release(q, { kind: 'second', friend: f, why: `re-formed: second line behind our ${NAME[b.squads[f - 1].unit]}` });
        else release(q, { kind: 'advance', why: 're-formed: back into the fight' });
      }
      man.note = 're-formed a shorter, deeper line: back into the fight';
    } else if (man.kind === 'refuse') {
      for (const q of squads) release(q, { kind: 'advance', why: `our ${wingName(man.wing)} has re-formed: holding there` });
      man.note = `our ${wingName(man.wing)} has re-formed behind the centre`;
    } else if (man.kind === 'mass') {
      for (const q of squads) release(q, { kind: 'reserve', wing: man.wing, why: `massed on the ${wingName(man.wing)}: ready` });
      man.note = `massed on the ${wingName(man.wing)}: now the push`;
      if (man.pushAt && !c.op) { c.op = startPushOp(b, c, man.pushAt.x, man.pushAt.y, fwd, 0, 'commander', true); if (c.op) c.ops++; }
    }
    if (c.plan) c.plan.why = man.note;
    c.man = null; c.nextMan = b.t + K.every[0] + hash01(b.rng + side * 911, Math.round(b.t)) * (K.every[1] - K.every[0]);
    return;
  }
  if (c.op || !foes.length) return;
  if (c.nextMan < 0) c.nextMan = c.contactAt + K.first[0] + hash01(b.rng + side * 911, 3) * (K.first[1] - K.first[0]);
  if (b.t < c.nextMan) return;
  c.nextMan = b.t + K.look; // (look again soon if nothing is ordered now)

  // ---- judge the battle: three groups along our line ----
  const mine = all.filter(q => !q.mission?.op);
  if (mine.length < K.minSquads) return;
  let lo = Infinity, hi = -Infinity;
  for (const q of mine) { lo = Math.min(lo, q.my); hi = Math.max(hi, q.my); }
  const span = Math.max(1, hi - lo), groupOf = (y: number): -1 | 0 | 1 => (y < lo + span / 3 ? -1 : y > hi - span / 3 ? 1 : 0);
  const str = (q: BSquad) => squadAlive(b, q) / 10 * (0.5 + q.morale / 200) * (1 - 0.4 * q.fatigue);
  const G = { '-1': { ours: 0, theirs: 0, n: 0, free: [] as BSquad[], list: [] as BSquad[] }, '0': { ours: 0, theirs: 0, n: 0, free: [] as BSquad[], list: [] as BSquad[] }, '1': { ours: 0, theirs: 0, n: 0, free: [] as BSquad[], list: [] as BSquad[] } } as Record<string, { ours: number; theirs: number; n: number; free: BSquad[]; list: BSquad[] }>;
  const freeNow = (q: BSquad) => q.state !== 'melee' && !q.lull && !q.mission?.rush && q.fatigue < CK.tiredAt && !wavering(q) && q.mission?.kind !== 'intercept' && q.mission?.kind !== 'flank';
  for (const q of mine) { const g = G[groupOf(q.my)]; g.ours += str(q); g.n++; g.list.push(q); if (freeNow(q)) g.free.push(q); }
  for (const e of foes) { const y = Math.max(lo, Math.min(hi, e.my)); G[groupOf(y)].theirs += str(e); }
  const ratio = (w: number) => G[w].ours / Math.max(0.3, G[w].theirs);
  const fighting = mine.filter(q => q.state === 'melee');
  let flo = Infinity, fhi = -Infinity; for (const q of fighting) { flo = Math.min(flo, q.my); fhi = Math.max(fhi, q.my); }
  const lineLen = fighting.length ? fhi - flo + gapW : 0;
  const T = c.temper ?? { aggr: 0.5, cav: 0.5, patience: 0.5 };
  const front = Math.max(...mine.map(q => q.mx * fwd)), medianF = mine.map(q => q.mx * fwd).sort((a, z) => a - z)[Math.floor(mine.length / 2)];

  // ---- which manoeuvre? (weights from the situation and the commander's character) ----
  const w: Record<ManKind, number> = { contract: 0, refuse: 0, mass: 0, shift: 0 };
  let refuseWing: -1 | 1 = -1, massWing: -1 | 1 = 1, shiftTo: -1 | 0 | 1 = 0, shiftFrom: -1 | 0 | 1 = 0;
  // contract: we've lost a good part of the army and what's left is strung out in a thin line
  const thin = lineLen / Math.max(1, mine.length * gapW); // 1 = everyone side by side in one rank; 0.5 = two deep
  if (mine.length <= c.inf0 * K.contractBelow && mine.length >= K.minSquads && thin > K.thin && (c.mans.contract ?? 0) < K.contractMax) w.contract = K.weight.contract * (0.6 + T.patience * 0.8) * (thin / K.thin);
  // refuse: a wing clearly losing while the centre holds
  for (const g of [-1, 1] as const) if (G[g].n >= 3 && ratio(g) < K.losing && ratio(0) >= K.holding && ratio(g) < ratio(refuseWing === g ? -g : refuseWing) + 9) {
    if (w.refuse === 0 || ratio(g) < ratio(refuseWing)) { refuseWing = g; w.refuse = K.weight.refuse * (0.5 + T.patience) * (1 + (K.losing - ratio(g))); }
  }
  // mass: free squads to gather, and a wing worth striking with them (the stronger one; the plan's wing if it has one)
  const freeAll = mine.filter(freeNow);
  if (freeAll.length >= K.massMin) {
    massWing = c.plan && (c.plan.strike === -1 || c.plan.strike === 1) && !c.plan.defend ? c.plan.strike : ratio(1) >= ratio(-1) ? 1 : -1;
    if (hash01(b.rng + side * 77, Math.round(b.t)) < K.massOther) massWing = -massWing as -1 | 1;
    w.mass = K.weight.mass * (0.5 + T.aggr) * Math.min(2, freeAll.length / K.massMin);
  }
  // shift: one group losing, another with free squads to spare
  for (const g of [-1, 0, 1] as const) if (G[g].n && ratio(g) < K.losing + 0.1) for (const d of [-1, 0, 1] as const) {
    if (d === g || G[d].free.length < 2 || ratio(d) < 1) continue;
    if (w.shift === 0 || ratio(g) < ratio(shiftTo)) { shiftTo = g; shiftFrom = d; w.shift = K.weight.shift * (1 + (1 - ratio(g))); }
  }
  const total = w.contract + w.refuse + w.mass + w.shift;
  if (total <= 0) return;
  if (hash01(b.rng + side * 4099, Math.round(b.t * 3)) > Math.min(1, total / K.sure)) return; // not every look leads to a manoeuvre
  let pick = hash01(b.rng + side * 5003, Math.round(b.t * 7)) * total, kind: ManKind = 'shift';
  for (const k of Object.keys(w) as ManKind[]) { pick -= w[k]; if (pick <= 0) { kind = k; break; } }
  c.mans[kind] = (c.mans[kind] ?? 0) + 1;

  if (kind === 'contract') {
    // everyone falls back a few tiles and re-forms: a line half as long, two squads deep, centred on where the army is
    const y0 = mine.reduce((a, q) => a + q.my, 0) / mine.length, LF = medianF - K.fallBack;
    const order = mine.slice().sort((a, z) => a.my - z.my), n = Math.ceil(order.length / 2), until = b.t + K.reformSeconds;
    const pairs: Record<number, number> = {};
    for (let i = 0; i < n; i++) {
      const a = order[i * 2], z = order[i * 2 + 1];
      // the fitter of each pair in front
      const [f, k] = !z || squadHp(b, a) * (1 - a.fatigue) >= squadHp(b, z) * (1 - z.fatigue) ? [a, z] : [z, a];
      const y = y0 + (i - (n - 1) / 2) * gapW;
      reform(f, LF * fwd, y, 'falling back to re-form a shorter, deeper line', until);
      if (k) { reform(k, (LF - K.rowGap) * fwd, y, 'falling back to re-form: second row', until); pairs[k.id] = f.id; }
    }
    c.man = { kind, since: b.t, until, ids: mine.map(q => q.id), wing: 0, pairs, note: `our line is too thin (${mine.length} squads over ${Math.round(lineLen)} tiles): falling back to re-form a shorter, deeper line` };
  } else if (kind === 'refuse') {
    // the losing wing pulls back and re-forms on a line bent behind the end of the centre
    const g = refuseWing, wingSq = G[g].list.slice().sort((a, z) => (a.my - z.my) * g);
    const pivot = G[0].list.slice().sort((a, z) => (z.my - a.my) * g)[0] ?? wingSq[0];
    const until = b.t + K.refuseSeconds;
    wingSq.forEach((q, k) => reform(q, (pivot.mx * fwd - K.refuseBack - k * K.refuseStep) * fwd, pivot.my + g * (k + 1) * gapW * 0.8, `pulling back: re-forming behind the centre`, until));
    c.man = { kind, since: b.t, until, ids: wingSq.map(q => q.id), wing: g, pairs: {}, note: `we are losing on the ${wingName(g)}: pulling that wing back to re-form behind the centre` };
  } else if (kind === 'mass') {
    // every free squad gathers behind one wing, in rows; then the push goes in from there
    const g = massWing, take = freeAll.slice().sort((a, z) => (z.my - a.my) * g).slice(0, Math.max(K.massMin, Math.round(mine.length * K.massShare)));
    const wingFront = G[g].list.filter(q => q.state === 'melee');
    const wy = wingFront.length ? wingFront.reduce((a, q) => a + q.my, 0) / wingFront.length : g < 0 ? lo + span / 6 : hi - span / 6;
    const wf = wingFront.length ? Math.min(...wingFront.map(q => q.mx * fwd)) : front;
    const perRow = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(take.length)))), until = b.t + K.massSeconds;
    take.forEach((q, i) => { const row = Math.floor(i / perRow), col = i % perRow; reform(q, (wf - K.massBack - row * K.rowGap) * fwd, wy + (col - (perRow - 1) / 2) * gapW, `massing on the ${wingName(g)} for the push`, until); });
    c.man = { kind, since: b.t, until, ids: take.map(q => q.id), wing: g, pairs: {}, pushAt: { x: (wf - K.massBack) * fwd, y: wy }, note: `massing ${take.length} squads behind our ${wingName(g)}: the push goes in from there` };
  } else {
    // shift: the quiet group's free squads go and stand behind the squads of the group that is losing
    const needy = G[shiftTo].list.filter(q => q.state === 'melee').sort((a, z) => squadHp(b, a) - squadHp(b, z));
    const movers = G[shiftFrom].free.slice(0, K.shiftMax);
    let moved = 0;
    movers.forEach((q, i) => { const f = needy[i % Math.max(1, needy.length)]; if (!f) return; release(q, { kind: 'second', friend: f.id, why: `shifted from the ${wingName(shiftFrom)}: backing our ${NAME[f.unit]} on the ${wingName(shiftTo)}`, until: b.t + 8 }); moved++; });
    if (c.plan && moved) c.plan.why = `shifting ${moved} squads from the ${wingName(shiftFrom)} to the ${wingName(shiftTo)}: we are losing there`;
    c.nextMan = b.t + K.every[0] * 0.5;
    return;
  }
  if (c.plan) c.plan.why = c.man!.note;
}
