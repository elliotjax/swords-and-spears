import { CONFIG } from '../config';
import { active, halfFront, shooter, squadHp, wavering, type BattleState, type BSquad, type Side } from './battle';

// =====================================================================
//  The army commander (one per side, same rules for both).
//
//  Three levels of intelligence:
//   - COMMANDER (this file): WHAT and WHY. Keeps a plan, re-thinks every
//     few seconds, and gives every squad a mission with a reason.
//   - SQUAD (battle.ts, squad step): HOW and WHEN. Carries out its mission
//     (route, position, target), with short emergency exceptions
//     (turn on a flank attacker, brace against a charge), then goes back.
//   - SOLDIER (battle.ts, soldier step): the fight in front of them.
//
//  The commander never leaves a squad without a mission. Waiting is always
//  deliberate and says why (reserve, screen, protect).
// =====================================================================

export type MissionKind =
  | 'advance'    // march with the army, then fight the enemy opposite (the squad picks who)
  | 'attack'     // go for one enemy squad
  | 'flank'      // go for one enemy squad from its side or rear
  | 'reinforce'  // help a friend: attack the enemy it is fighting
  | 'intercept'  // stop an enemy squad that threatens our flank or rear
  | 'reserve'    // wait behind the line until the commander commits us
  | 'screen'     // cavalry: stay on a wing and stop anything coming round it
  | 'raid'       // cavalry: ride round and hit their archers
  | 'shock'      // cavalry: charge a busy enemy from behind, pull back, charge again
  | 'pursue'     // run down routing enemies
  | 'disengage'  // pull out of a bad fight and rally
  | 'support';   // archers: shoot (and stay behind our infantry)

export interface Mission {
  kind: MissionKind;
  target: number;     // enemy squad id (0 = none)
  wing: -1 | 0 | 1;   // which wing a screen / reserve belongs to (-1 = low y, 1 = high y)
  why: string;        // the commander's reason, in plain words (shown in the Battle Lab)
  since: number;      // battle time it was given
  until: number;      // the commander won't change it before this time (unless it becomes impossible)
  push?: boolean;     // advance only: drive forward into the enemy in front (the squad pushes while it has the strength)
  postY?: number;     // reserve only: stand at this point along the line instead of our own spot (guarding a wing)
}

export interface Commander {
  side: Side;
  nextThink: number;
  contactAt: number;  // when our infantry first got close to theirs (-1 = not yet)
  changes: number;    // missions changed so far (for tools/battle-check)
  commits: number;    // reserves committed so far
  seen: Map<number, { x: number; y: number }>; // where each enemy squad was at the last think (to tell who is closing in)
  plan: Plan | null;  // the battle plan (chosen when the armies are close, reviewed now and then)
  nextCommit: number; // when the next waiting reserve may be sent in (they go one at a time)
  planChanges: number;
  pushes: number;     // push orders given so far
  breach: { target: number; y: number; fed: boolean } | null; // the weak spot in their line we're breaking through right now
  through: { y: number; until: number } | null;                 // we broke through here: the squads there roll up their line
  nextBreach: number; breaches: number;
  push: { ids: number[]; y: number; since: number; size: number } | null; // the push under way: a group of squads driving forward together
  nextPush: number;   // when the next push may start (-1 = not set yet)
  rallied: Set<number>; // cavalry squads already pulled out once for being badly hurt (they aren't pulled out again)
  temper: Temper | null; // this commander's character for this battle (by chance, from the battle seed)
  idleSince: Map<number, number>; // when each of our infantry squads last stopped fighting
  burst: number;      // reserves still to send at once (a feint's switch, a counter-attack)
  exploits: number;   // squads sent through gaps / round the end of their line so far
  nextShore?: number; shores?: number; // shoring up a losing part of our line with a reserve
}
/** A commander's character for one battle (0..1 each): how fast it commits, how bold its cavalry are, how long it waits. */
export interface Temper { aggr: number; cav: number; patience: number }

export const newCommander = (side: Side): Commander => ({ side, nextThink: 0, contactAt: -1, changes: 0, commits: 0, seen: new Map(), plan: null, nextCommit: Infinity, planChanges: 0, pushes: 0, push: null, nextPush: -1, breach: null, through: null, nextBreach: 0, breaches: 0, rallied: new Set(), temper: null, idleSince: new Map(), burst: 0, exploits: 0 });

/** Kinds of battle plan (doctrines). */
export type PlanKind = 'envelop' | 'double' | 'centre' | 'defend' | 'feint' | 'hook' | 'refuse';
export const PLAN_NAME: Record<PlanKind, string> = { envelop: 'Envelop a wing', double: 'Double envelopment', centre: 'Hammer the centre', defend: 'Hold, then counter', feint: 'Feint, then switch', hook: 'Cavalry hook', refuse: 'Refuse a flank' };
/**
 * The commander's battle plan: where to strike (-1 = the low-y wing, 1 = the high-y wing, 0 = the centre, 2 = both wings) or to defend first.
 * kind: the doctrine; tempo: timing of reserves and pushes (below 1 = faster); keep: reserves held back for a crisis;
 * alt / switchAt / switched: a feint's real wing and when it switches (seconds after the lines meet).
 */
export interface Plan {
  kind: PlanKind; strike: -1 | 0 | 1 | 2; defend: boolean; why: string; since: number; reviewAt: number;
  tempo: number; keep: number; alt: -1 | 1; switchAt: number; switched: boolean;
}
/** A repeatable 0..1 number (so the same battle seed gives the same plans). */
const hash01 = (a: number, b: number) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** What a commander can see of the enemy. (Everything, for now: fog of war would go here.) */
export const observe = (b: BattleState, side: Side): BSquad[] => b.squads.filter(q => q.side !== side && active(q));

const isInf = (q: BSquad) => q.unit !== 'cavalry' && !shooter(q);
const dist = (a: BSquad, z: BSquad) => Math.hypot(a.mx - z.mx, a.my - z.my);
const valid = (b: BattleState, id: number) => { const e = b.squads[id - 1]; return !!e && active(e); };
const NAME: Record<string, string> = { swordsmen: 'swordsmen', heavy: 'heavy swordsmen', boss: 'warlord', spearmen: 'spearmen', archers: 'archers', cavalry: 'cavalry' };

/** Missions that mean "stay at a post until something comes" (deliberate waiting). */
export const POSTED: MissionKind[] = ['reserve', 'screen'];

export function commanderThink(b: BattleState, c: Commander) {
  const K = CONFIG.battle.commander, side = c.side;
  if (b.t < c.nextThink) return;
  c.nextThink = b.t + K.thinkSeconds;
  const mine = b.squads.filter(q => q.side === side && active(q) && !q.broken);
  const foes = observe(b, side);
  if (!mine.length) return;
  const L = b.line[side], fwd = mine[0].fwd;
  const give = (q: BSquad, kind: MissionKind, why: string, target = 0, wing: -1 | 0 | 1 = 0, hold = K.commitSeconds) => {
    const m = q.mission;
    if (m && m.kind === kind && m.target === target && m.wing === wing) { m.why = why; return; }
    if (m) { c.changes++; if (m.kind === 'reserve' && kind !== 'reserve') c.commits++; }
    q.mission = { kind, target, wing, why, since: b.t, until: b.t + hold };
    q.retarget = 0;
  };
  /** May the commander change this squad's mission now? */
  const open = (q: BSquad) => {
    const m = q.mission;
    if (!m) return true;
    if (m.target && !valid(b, m.target)) return true;            // the target is gone or running: mission over
    if (m.target && b.squads[m.target - 1].broken && m.kind !== 'pursue') return b.t >= m.since + 2;
    return b.t >= m.until && !(q.state === 'withdraw');
  };
  const wingOf = (q: BSquad): -1 | 1 => (q.homeY < b.H / 2 ? -1 : 1);
  /** How many of our squads are already sent against this enemy squad. */
  const sentAt = (id: number, except?: BSquad) => mine.reduce((a, q) => a + (q !== except && q.mission?.target === id && !POSTED.includes(q.mission.kind) ? 1 : 0), 0);

  // ---- the picture ----
  const foeInf = foes.filter(e => isInf(e) && !e.broken), foeCav = foes.filter(e => e.unit === 'cavalry' && !e.broken);
  const foeArch = foes.filter(e => shooter(e) && !e.broken);
  const myInf = mine.filter(isInf);
  let gap = Infinity; // how close the two infantry bodies are
  for (const q of myInf) for (const e of foeInf) gap = Math.min(gap, dist(q, e));
  if (!myInf.length || !foeInf.length) gap = 0; // no infantry line on one side: nothing to wait for
  if (c.contactAt < 0 && gap < K.contactDist) c.contactAt = b.t;
  const engaged = c.contactAt >= 0, sinceContact = engaged ? b.t - c.contactAt : 0;
  const haveLine = isFinite(L.front);
  // threats: enemy fighters behind our line, or coming round the end of it
  const threats = !haveLine ? [] : foes.filter(e => {
    if (shooter(e) || e.broken) return false;
    // already being fought head-on by one of ours? then it's not a flank threat
    if (myInf.some(q => q.target === e.id && q.state === 'melee' && q.mission?.kind === 'advance')) return false;
    // behind our line: further back than the friendly infantry nearest to it
    let near: BSquad | null = null, nd = Infinity;
    for (const q of myInf) { const d = Math.abs(q.my - e.my) + Math.abs(q.mx - e.mx) * 0.3; if (d < nd) { nd = d; near = q; } }
    if (near && e.mx * fwd < near.mx * fwd - K.behindBy) return true;
    // coming round the end of our line: outside it, close, and actually closing in or attacking (not just standing guard over there)
    if (!((e.my < L.lo - K.wrapMargin || e.my > L.hi + K.wrapMargin) && e.mx * fwd - L.front < K.wrapDepth)) return false;
    const was = c.seen.get(e.id), cy = (L.lo + L.hi) / 2;
    const closing = !!was && (Math.hypot(was.x * fwd - L.front, was.y - cy) - Math.hypot(e.mx * fwd - L.front, e.my - cy)) > K.closingBy;
    return closing || e.state === 'charge' || e.state === 'melee';
  });
  for (const e of foes) c.seen.set(e.id, { x: e.mx, y: e.my });

  // ---- the plan: where to strike ----
  // sectors of the field across our line: -1 low-y wing, 0 centre, 1 high-y wing
  const span = Math.max(1, L.hi - L.lo), sector = (y: number): -1 | 0 | 1 => (y < L.lo + span / 3 ? -1 : y > L.hi - span / 3 ? 1 : 0);
  const power = (q: BSquad) => (CONFIG.battle.units[q.unit].worth ?? 1) * squadHp(b, q) * (0.5 + q.morale / 200) * (1 - 0.4 * q.fatigue) * (q.unit === 'cavalry' ? 0.6 : q.unit === 'archers' ? 0.5 : 1);
  const balance = { '-1': 0, '0': 0, '1': 0 } as Record<string, number>; // ours minus theirs in each sector
  let ourPower = 0, theirPower = 0;
  if (haveLine) {
    for (const q of mine) { const p = power(q); balance[sector(q.my)] += p; ourPower += p; }
    for (const e of foes) if (!e.broken) { const p = power(e); balance[sector(e.my)] -= p; theirPower += p; }
  }
  const wingName = (w: number) => (w * fwd < 0 ? 'left' : 'right'); // as seen from behind our own army
  // this commander's character for the battle (the same seed gives the same characters)
  const T = c.temper ??= { aggr: hash01(b.rng + side * 31337, 11), cav: hash01(b.rng + side * 31337, 12), patience: hash01(b.rng + side * 31337, 13) };
  const D = K.doctrine;
  const choosePlan = (first: boolean): Plan => {
    const ratio = ourPower / Math.max(0.1, theirPower), jit = (k: number) => (first ? hash01(b.rng + side * 7919, k) * K.planJitter : 0);
    const lo = balance['-1'] + jit(1), hi = balance['1'] + jit(2), mid = balance['0'] + jit(3);
    const tempo = D.tempo[1] - (D.tempo[1] - D.tempo[0]) * T.aggr;
    const keep = T.aggr > 0.8 ? 0 : T.patience > 0.7 ? 2 : 1;
    const mk = (kind: PlanKind, strike: Plan['strike'], why: string, alt: -1 | 1 = 1, switchAt = 0): Plan =>
      ({ kind, strike, defend: kind === 'defend', why, since: b.t, reviewAt: b.t + K.replanSeconds, tempo: tempo * (kind === 'centre' || kind === 'double' ? 0.85 : 1), keep, alt, switchAt, switched: false });
    let w: -1 | 1 = lo >= hi ? -1 : 1; // their weaker wing (where we're relatively strongest)
    if (!first) {
      if (mid > lo + K.centreEdge && mid > hi + K.centreEdge) return mk('centre', 0, 'shifting the attack to their centre');
      return mk('envelop', w, `shifting the attack to the ${wingName(w)}`);
    }
    // first plan: a weighted pick that fits the armies, shaped by this commander's character
    const r = (k: number) => hash01(b.rng + side * 104723, k);
    if (r(1) < D.surprise) w = -w as -1 | 1; // now and then strike where they don't expect it
    const ourCav = mine.filter(q => q.unit === 'cavalry').length, theirCav = foeCav.length;
    const wt: Record<PlanKind, number> = {
      envelop: D.envelop * (ourCav > theirCav ? 1.4 : 1) * (0.6 + T.aggr * 0.8),
      double: D.double * (ratio > K.envelopAbove ? 3 : ratio > 1 ? 1 : 0.25) * (0.5 + T.aggr) * (myInf.length >= 4 ? 1 : 0.2),
      centre: D.centre * (mid > Math.max(lo, hi) + K.centreEdge ? 2.5 : 1) * (myInf.length >= 6 ? 1.3 : 1) * (0.6 + T.aggr * 0.8),
      defend: D.defend * (ratio < K.defendBelow ? 5 : ratio < 1 ? 1.5 : 0.6) * (0.4 + T.patience * 1.2),
      feint: D.feint * (myInf.length >= 4 ? 1 : 0.2) * (0.6 + T.patience * 0.8),
      refuse: D.refuse * (myInf.length >= 4 ? 1 : 0) * (0.5 + T.patience) * (Math.abs(lo - hi) > K.centreEdge * 0.5 ? 1.6 : 1),
      hook: D.hook * (ourCav >= 2 ? Math.max(0.3, 1 + (ourCav - theirCav) * 0.25) : 0) * (0.4 + T.cav * 1.2),
    };
    const total = Object.values(wt).reduce((a, x) => a + x, 0);
    let pickAt = r(2) * total, kind: PlanKind = 'envelop';
    for (const k of Object.keys(wt) as PlanKind[]) { pickAt -= wt[k]; if (pickAt <= 0) { kind = k; break; } }
    switch (kind) {
      case 'double': return mk(kind, 2, 'plan: going round both of their flanks');
      case 'centre': return mk(kind, 0, 'plan: hammer their centre');
      case 'defend': return mk(kind, w, `plan: hold and wear them down, then counter on the ${wingName(w)}`);
      case 'feint': {
        const after = D.feintAfter[0] + r(3) * (D.feintAfter[1] - D.feintAfter[0]); // (seconds after the lines meet)
        return mk(kind, -w as -1 | 1, `plan: a feint on the ${wingName(-w)}, then the real blow on the ${wingName(w)}`, w, after);
      }
      case 'hook': return mk(kind, w, `plan: cavalry hook round their ${wingName(w)}`);
      case 'refuse': return mk(kind, w, `plan: strike hard on the ${wingName(w)}, our ${wingName(-w)} hangs back`);
      default: return mk('envelop', w, `plan: envelop their ${wingName(w)}, hold the ${wingName(-w)}`);
    }
  };
  if (haveLine && foeInf.length) {
    if (!c.plan && gap < K.planWhenGap) {
      c.plan = choosePlan(true); c.nextCommit = Infinity;
      // the plan decides how big a reserve to keep: the rest of the rear rows follow the front as a second line
      const share = D.reserveShare[c.plan.kind] * (0.8 + T.patience * 0.4);
      const res = myInf.filter(q => q.mission?.kind === 'reserve').sort((a, z) => a.lineDepth - z.lineDepth);
      const extra = res.length - Math.round(myInf.length * share);
      for (const q of res.slice(0, Math.max(0, extra))) give(q, 'advance', 'second line: following the front, ready to go where it is needed', 0, 0, 0);
    }
    else if (c.plan && engaged && b.t >= c.plan.reviewAt) {
      // review: keep the plan unless the strike is failing and somewhere else looks clearly better
      const p = c.plan, cur = p.strike === 2 ? Math.min(balance['-1'], balance['1']) : balance[p.strike];
      const next = choosePlan(false);
      const alt = next.strike === 2 ? Math.min(balance['-1'], balance['1']) : balance[next.strike];
      // (a defender goes over to the attack once it has held long enough)
      if (p.defend && sinceContact > K.counterAfter * (0.6 + T.patience * 0.8) && ourPower >= theirPower * K.defendBelow) {
        // the counter-attack: every waiting reserve at once, and a push straight away
        c.plan = { ...p, defend: false, why: `counter-attacking on the ${wingName(p.strike)}: everyone in`, since: b.t, reviewAt: b.t + K.replanSeconds }; c.planChanges++;
        c.burst = 99; c.nextCommit = b.t; c.nextPush = Math.min(c.nextPush, b.t);
      }
      else if (p.kind === 'feint' && !p.switched) p.reviewAt = b.t + K.replanSeconds;
      else if (!p.defend && !next.defend && next.strike !== p.strike && cur < -K.failingBalance && alt > cur + K.replanEdge) { c.plan = { ...next, tempo: p.tempo, keep: p.keep }; c.planChanges++; }
      else p.reviewAt = b.t + K.replanSeconds;
    }
  }
  // holding, but they won't come: go to them after a while (two defenders would otherwise stare at each other all day)
  if (c.plan?.defend && !engaged && b.t - c.plan.since > K.defendWait) {
    c.plan.defend = false; c.plan.why = `they won't come to us: advancing, striking on the ${wingName(c.plan.strike)}`; c.planChanges++;
  }
  // a feint switches wings: the real blow lands on the other side, with several reserves at once and a push
  if (c.plan?.kind === 'feint' && !c.plan.switched && engaged && sinceContact >= c.plan.switchAt) {
    const p = c.plan; p.switched = true; p.strike = p.alt; c.planChanges++;
    p.why = `the ${wingName(-p.alt)} was a feint: the real blow falls on the ${wingName(p.alt)}`;
    c.burst = 3; c.nextCommit = b.t; c.nextPush = Math.min(c.nextPush, b.t);
  }
  const plan = c.plan, tempo = plan?.tempo ?? 1;
  if (engaged && c.nextCommit === Infinity) c.nextCommit = c.contactAt + K.firstCommit * tempo;
  const striking = (y: number) => !!plan && !plan.defend && (plan.strike === 2 ? sector(y) !== 0 : sector(y) === plan.strike);

  // ---- archers: shoot ----
  // (they pick a focus: the enemy where we're pushing or breaking through, else whoever is beating our weakest squad)
  const range = CONFIG.battle.units.archers.range ?? 7;
  for (const q of mine) if (q.unit === 'archers' && (open(q) || (q.mission?.kind === 'support' && b.t >= q.mission.since + K.archerRefocus))) {
    if (!shooter(q)) { give(q, 'advance', 'out of arrows: fighting on foot'); continue; }
    let focus: BSquad | null = null, why = '', best = -Infinity;
    for (const e of foes) {
      if (e.broken || shooter(e)) continue;
      const d = dist(q, e);
      if (d > range * K.archerReach) continue;
      const pushedBy = mine.find(f => f.target === e.id && f.state === 'melee' && (f.mission?.push || (c.breach && c.breach.target === e.id)));
      const beating = mine.find(f => f.target === e.id && f.state === 'melee' && (wavering(f) || squadHp(b, f) < K.relieveHp));
      const sc = (pushedBy ? 3 : 0) + (beating ? 2.5 : 0) + (e.state === 'melee' ? 0.5 : 0) - d / range;
      if ((pushedBy || beating) && sc > best) { best = sc; focus = e; why = pushedBy ? `shooting their ${NAME[e.unit]} where we are pushing` : `covering our ${NAME[beating!.unit]}: shooting their ${NAME[e.unit]}`; }
    }
    if (focus) give(q, 'support', why, focus.id, 0, K.archerRefocus);
    else give(q, 'support', 'shooting from behind our line', 0, 0, K.archerRefocus);
  }

  // ---- infantry ----
  // threats first: the nearest free reserve (spearmen first against cavalry) goes to stop each one
  // (at most a share of the reserve chases flank threats: the rest stays to relieve the line)
  const reserves = myInf.filter(q => q.mission?.kind === 'reserve').length;
  let chasing = myInf.filter(q => q.mission?.kind === 'intercept').length;
  const chaseCap = Math.ceil((reserves + chasing) * K.reserveChaseShare);
  for (const t of threats) {
    if (sentAt(t.id) > 0 || chasing >= chaseCap) continue;
    let best: BSquad | null = null, bs = Infinity;
    for (const q of myInf) {
      if (q.mission?.kind !== 'reserve' || q.state === 'melee') continue;
      const s = dist(q, t) - (t.unit === 'cavalry' && q.unit === 'spearmen' ? 4 : 0);
      if (s < bs && s < K.answerRange) { bs = s; best = q; }
    }
    if (best) chasing++;
    if (best) give(best, 'intercept', `stopping enemy ${NAME[t.unit]} ${t.my < L.lo - K.wrapMargin || t.my > L.hi + K.wrapMargin ? 'coming round our flank' : 'behind our line'}`, t.id);
  }
  // reserves relieve friends who are losing
  for (const f of myInf) {
    if (f.state !== 'melee' || !(wavering(f) || squadHp(b, f) < K.relieveHp) || f.target <= 0 || !valid(b, f.target)) continue;
    if (sentAt(f.target, f) > 0) continue;
    let best: BSquad | null = null, bd = K.answerRange;
    for (const q of myInf) if (q.mission?.kind === 'reserve' && q.state !== 'melee') { const d = dist(q, f); if (d < bd) { bd = d; best = q; } }
    if (best) give(best, 'reinforce', `relieving our ${NAME[f.unit]} who are in trouble`, f.target);
  }
  // the weaker end of the enemy line (where late reserves go)
  const endSquad = (w: -1 | 1) => foeInf.slice().sort((a, z) => (a.my - z.my) * w)[foeInf.length - 1];
  const strength = (e?: BSquad) => (e ? squadHp(b, e) * (0.5 + e.morale / 200) : 9);
  // tired front squads are relieved while there's a reserve to take over (they pull back to rest and become the reserve)
  for (const f of myInf) {
    if (f.mission?.kind !== 'advance' || f.state !== 'melee' || f.fatigue < K.tiredAt || f.target <= 0 || !valid(b, f.target)) continue;
    let best: BSquad | null = null, bd = K.answerRange;
    for (const q of myInf) if (q.mission?.kind === 'reserve' && q.state !== 'melee' && q.fatigue < K.restedAt) { const d = dist(q, f); if (d < bd) { bd = d; best = q; } }
    if (!best) continue;
    give(best, 'reinforce', `taking over from our tired ${NAME[f.unit]}`, f.target);
    give(f, 'disengage', 'exhausted: pulling back to rest', 0, wingOf(f), K.rallySeconds);
  }
  const waiting = myInf.filter(q => q.mission?.kind === 'reserve' && q.fatigue < K.restedAt && q.mission.postY === undefined);
  // ---- reading the enemy: their horse massing on one wing -> a reserve (spearmen first) moves behind that wing ----
  if (haveLine && foeCav.length >= 2) {
    const span4 = Math.max(2, (L.hi - L.lo) / 4);
    for (const w of [-1, 1] as const) {
      const there = foeCav.filter(e => (w < 0 ? e.my < L.lo + span4 : e.my > L.hi - span4)).length;
      const guard = myInf.find(q => q.mission?.kind === 'reserve' && q.mission.postY !== undefined && q.mission.wing === w);
      if (there >= 2 && there >= foeCav.length * K.massShare) {
        if (guard) continue;
        const pick = waiting.slice().sort((a, z) => (a.unit === 'spearmen' ? 0 : 3) - (z.unit === 'spearmen' ? 0 : 3) + Math.abs(a.my - (w < 0 ? L.lo : L.hi)) / 4 - Math.abs(z.my - (w < 0 ? L.lo : L.hi)) / 4)[0];
        if (!pick) continue;
        give(pick, 'reserve', `their horse are massing on our ${wingName(w)}: guarding that wing`, 0, w, 0);
        pick.mission!.postY = w < 0 ? L.lo + 0.5 : L.hi - 0.5;
        waiting.splice(waiting.indexOf(pick), 1);
      } else if (guard && there === 0) guard.mission!.postY = undefined; // the danger has gone: back into the reserve
    }
  }
  // ---- shoring up: a part of our line that is clearly losing (not where we strike) gets a waiting reserve, whatever the plan ----
  if (engaged && haveLine && sinceContact > K.shoreAfter && b.t >= (c.nextShore ?? 0)) {
    for (const sct of [-1, 0, 1] as const) {
      if (balance[sct] > -K.shoreBelow || striking(sct === 0 ? (L.lo + L.hi) / 2 : sct < 0 ? L.lo : L.hi)) continue;
      const foesThere = foeInf.filter(e => sector(e.my) === sct && e.state === 'melee');
      const t = foesThere.sort((a, z) => (sentAt(a.id) - sentAt(z.id)) || strength(z) - strength(a))[0];
      if (!t || sentAt(t.id) >= K.maxPerTarget) continue;
      const pick = waiting.slice().sort((a, z) => dist(a, t) - dist(z, t))[0];
      if (!pick) break;
      give(pick, 'reinforce', `shoring up our ${sct === 0 ? 'centre' : wingName(sct)}: we are losing there`, t.id);
      waiting.splice(waiting.indexOf(pick), 1);
      c.nextShore = b.t + K.shoreEvery; c.shores = (c.shores ?? 0) + 1;
      break;
    }
  }
  // ---- breakthrough: find a weak spot in their line, drive through it, then roll the line up from there ----
  if (c.breach) {
    const t = b.squads[c.breach.target - 1];
    if (!valid(b, c.breach.target) || t.broken) { // through!
      c.through = { y: c.breach.y, until: b.t + K.rollUpSeconds }; c.breach = null;
      if (plan) plan.why = 'broke through their line: rolling it up';
    } else c.breach.y = t.my;
  }
  if (c.through && b.t > c.through.until) c.through = null;
  if (!c.breach && engaged && plan && !(plan.defend) && sinceContact > K.breachAfter && b.t >= c.nextBreach) {
    let best: BSquad | null = null, bs = K.breachScore;
    for (const e of foeInf) {
      if (e.state !== 'melee') continue;
      const backed = foeInf.some(x => x !== e && Math.abs(x.my - e.my) < 2.2 && (x.mx - e.mx) * fwd > 0.8 && (x.mx - e.mx) * fwd < 5); // someone standing behind it
      const sc = (1 - power(e)) + (backed ? 0 : 0.25) + (wavering(e) ? 0.3 : 0) + (e.support === 0 ? 0.15 : 0);
      if (sc > bs && myInf.some(q => q.target === e.id && q.state === 'melee')) { bs = sc; best = e; }
    }
    if (best) {
      c.breach = { target: best.id, y: best.my, fed: false }; c.breaches++; c.nextBreach = b.t + K.breachEvery;
      plan.why = `breaking through a weak spot (their ${NAME[best.unit]})`;
    }
  }
  const atBreach = (y: number) => !!c.breach && Math.abs(y - c.breach.y) < K.breachWidth;
  if (c.breach && !c.breach.fed && waiting.length) { // one fresh reserve goes straight in at the weak spot
    const y = c.breach.y, pick = waiting.slice().sort((a, z) => Math.abs(a.my - y) - Math.abs(z.my - y))[0];
    give(pick, 'attack', 'sent in at the weak spot', c.breach.target); waiting.splice(waiting.indexOf(pick), 1); c.breach.fed = true;
  }
  // ---- the push: one big coordinated effort at a time (a few per battle), 2 to 5 squads side by side starting together ----
  const rnd = (k: number) => hash01(b.rng + side * 104729, k + Math.round(b.t * 20));
  const fighting = (q: BSquad) => q.state === 'melee' && q.target > 0 && valid(b, q.target);
  if (engaged && c.nextPush < 0) c.nextPush = c.contactAt + (K.pushFirst[0] + rnd(1) * (K.pushFirst[1] - K.pushFirst[0])) * tempo;
  if (c.push) { // over when the group is spent (too tired, broken, or nobody left to push)
    const live = c.push.ids.map(id => b.squads[id - 1]).filter(q => active(q) && !q.broken && q.mission?.push && q.fatigue < K.pushStop && fighting(q));
    if (!live.length && b.t - c.push.since > 2) { c.push = null; c.nextPush = b.t + (K.pushEvery[0] + rnd(2) * (K.pushEvery[1] - K.pushEvery[0])) * tempo; }
  }
  if (!c.push && engaged && plan && !(plan.defend) && (b.t >= c.nextPush || (c.breach && b.t >= c.nextPush - K.pushEvery[0] * 0.5))) {
    // where: the weak spot if we've found one, otherwise on the wing the plan strikes at; who: the freshest squad there and its neighbours
    const pool = myInf.filter(q => fighting(q) && b.squads[q.target - 1].unit !== 'cavalry' && q.fatigue < K.pushStart && !wavering(q) && ['advance', 'reinforce', 'attack', 'flank'].includes(q.mission?.kind ?? ''));
    const near = (q: BSquad) => pool.filter(o => Math.abs(o.my - q.my) < K.pushSpan).length;
    const worth = (q: BSquad) => Math.min(near(q), K.pushSquads[1]) + (c.breach ? -Math.abs(q.my - c.breach.y) * 0.5 : striking(q.my) ? 1.5 : 0) - q.fatigue * 2;
    const at = pool.slice().sort((a, z) => worth(z) - worth(a))[0];
    if (at) {
      const size = Math.min(K.pushSquads[1], K.pushSquads[0] + Math.floor(rnd(3) * (K.pushSquads[1] - K.pushSquads[0] + 1)) + (plan.kind === 'centre' ? 1 : 0));
      const group = pool.filter(q => Math.abs(q.my - at.my) < K.pushSpan).sort((a, z) => Math.abs(a.my - at.my) - Math.abs(z.my - at.my)).slice(0, size);
      if (group.length >= 2 || (group.length && b.t > c.nextPush + K.pushWait)) { // a push wants company: wait a little for a second squad
        c.push = { ids: group.map(q => q.id), y: at.my, since: b.t, size }; c.pushes++;
        for (const q of group) q.mission!.push = true; // all together, now
        plan.why = `${c.breach ? 'breaking through a weak spot' : 'pushing'} with ${group.length} squads on the ${sector(at.my) === 0 ? 'centre' : wingName(sector(at.my))}`;
      }
    }
  }
  if (c.push && c.push.ids.length < c.push.size && b.t - c.push.since < K.pushJoin) { // neighbours who arrive in the first moments join in
    for (const q of myInf) {
      if (c.push.ids.length >= c.push.size) break;
      if (!c.push.ids.includes(q.id) && fighting(q) && b.squads[q.target - 1].unit !== 'cavalry' && q.fatigue < K.pushStart && !wavering(q) && Math.abs(q.my - c.push.y) < K.pushSpan) c.push.ids.push(q.id);
    }
  }
  const inPush = (q: BSquad) => !!c.push && c.push.ids.includes(q.id);
  // ---- being pushed: plug the gap (the nearest reserve, or a free squad close by, goes at the pushers) ----
  for (const e of foeInf) {
    if (!e.pushing || e.target <= 0 || sentAt(e.id) > 0) continue;
    const victim = b.squads[e.target - 1];
    if (!victim || victim.side !== side) continue;
    let best: BSquad | null = null, bd = K.answerRange;
    for (const q of myInf) {
      if (q === victim || q.state === 'melee' || !(q.mission?.kind === 'reserve' || q.mission?.kind === 'advance') || q.fatigue >= K.tiredAt) continue;
      const d = dist(q, victim) + (q.mission.kind === 'reserve' ? 0 : 3);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) { give(best, 'reinforce', `plugging the gap: they are pushing our ${NAME[victim.unit]}`, e.id); const i = waiting.indexOf(best); if (i >= 0) waiting.splice(i, 1); }
  }
  // ---- initiative: squads with nothing to do go through gaps in their line or round its ends ----
  // (busy = at least a quarter of its men actually have someone to fight within reach; a squad "in melee" with only a few men chasing stragglers is idle)
  const busy = (q: BSquad) => {
    if (q.lull) return true; // catching its breath between bouts: about to go back in
    let n = 0, f = 0;
    for (const id of q.members) {
      const so = b.soldiers[id - 1];
      if (so.dead || so.fled) continue;
      n++;
      if (so.target > 0) { const t = b.soldiers[so.target - 1]; if (!t.dead && !t.fled && Math.hypot(t.x - so.x, t.y - so.y) < K.busyReach) f++; }
    }
    return f >= n * 0.25;
  };
  for (const q of myInf) { if (!engaged || busy(q)) c.idleSince.delete(q.id); else if (!c.idleSince.has(q.id)) c.idleSince.set(q.id, b.t); }
  if (engaged && foeInf.length) {
    const idle = myInf.filter(q => {
      const since = c.idleSince.get(q.id), k = q.mission?.kind;
      return since !== undefined && b.t - since >= K.idleSeconds && q.fatigue < K.tiredAt && !wavering(q) && !q.mission?.push &&
        (k === 'advance' || k === 'reinforce' || k === 'attack' || (k === 'flank' && b.t - since >= K.idleSeconds * 2.5));
    });
    if (idle.length) {
      // the openings: each end of their line, and every hole between two neighbouring squads (along the line)
      const line = foeInf.slice().sort((a, z) => a.my - z.my);
      type Opening = { e: BSquad; x: number; y: number; gap: boolean };
      const ops: Opening[] = [];
      const lo = line[0], hi = line[line.length - 1];
      ops.push({ e: lo, x: lo.mx, y: lo.my - halfFront(lo.unit) - 1.2, gap: false });
      if (hi !== lo) ops.push({ e: hi, x: hi.mx, y: hi.my + halfFront(hi.unit) + 1.2, gap: false });
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], z = line[i + 1];
        const open = z.my - a.my - halfFront(a.unit) - halfFront(z.unit);
        if (open < K.gapMin || Math.abs(a.mx - z.mx) > 5) continue;
        // go for the weaker of the two squads beside the hole, from the side
        ops.push({ e: strength(a) <= strength(z) ? a : z, x: (a.mx + z.mx) / 2, y: (a.my + z.my) / 2, gap: true });
      }
      // nearest openings first; up to exploitGroup squads per opening (counting those already sent at that enemy)
      const pairs: { q: BSquad; o: Opening; d: number }[] = [];
      for (const q of idle) for (const o of ops) { const d = Math.hypot(q.mx - o.x, q.my - o.y); if (d < K.exploitRange) pairs.push({ q, o, d: d - (o.gap ? 1.5 : 0) }); }
      pairs.sort((a, z) => a.d - z.d);
      const used = new Set<BSquad>();
      for (const { q, o } of pairs) {
        if (used.has(q) || sentAt(o.e.id) >= K.exploitGroup || !valid(b, o.e.id)) continue;
        used.add(q); c.exploits++;
        give(q, 'flank', o.gap ? `through a gap in their line: hitting their ${NAME[o.e.unit]} from the side` : `round the end of their line: hitting their ${NAME[o.e.unit]} from the side`, o.e.id);
        c.idleSince.delete(q.id);
        // a free horse squad close by joins in: infantry and cavalry together
        const horse = mine.filter(h => h.unit === 'cavalry' && h.state !== 'melee' && !h.broken && h.fatigue < K.tiredAt && ['raid', 'attack', 'reserve', 'shock'].includes(h.mission?.kind ?? 'reserve') && !(h.mission?.target && valid(b, h.mission.target) && b.squads[h.mission.target - 1].unit === 'archers' && dist(h, b.squads[h.mission.target - 1]) < 6))
          .sort((a, z) => dist(a, o.e) - dist(z, o.e))[0];
        if (horse && dist(horse, o.e) < K.cavJoin && sentAt(o.e.id, horse) < K.exploitGroup + 1) give(horse, 'shock', `joining our ${NAME[q.unit]} through the ${o.gap ? 'gap' : 'flank'}: charging their ${NAME[o.e.unit]}`, o.e.id, wingOf(horse));
      }
    }
  }
  for (const q of myInf) {
    const m = q.mission;
    if (!m) { // opening orders: front rows advance, rows behind are the reserve
      if (q.lineDepth > K.reserveDepth) give(q, 'reserve', 'in reserve behind the line', 0, wingOf(q), 0);
      else give(q, 'advance', 'advancing with the line', 0, 0, 0);
      continue;
    }
    if (m.kind === 'reserve') {
      if (engaged && !foeInf.length && foes.length) { give(q, 'advance', 'committed: finishing them off'); continue; }
      if (q.fatigue >= K.restedAt) { m.why = 'resting behind the line'; continue; }
      // reserves go in one at a time, round the flank the plan strikes at; the last one is kept back for a crisis until late
      const keep = c.burst > 0 ? 0 : sinceContact < K.lastReserveAfter * tempo ? (plan?.keep ?? K.keepReserve) : 0;
      if (!engaged || b.t < c.nextCommit || !foeInf.length || waiting.length <= keep || !plan || plan.defend) continue;
      if (plan.strike === 0) { // hammer the centre: reserves go straight into the middle of their line
        const mid = foeInf.filter(e => sector(e.my) === 0 && sentAt(e.id) < K.maxPerTarget).sort((a, z) => strength(a) - strength(z) + (dist(q, a) - dist(q, z)) / 10)[0];
        const pick = mid && waiting.slice().sort((a, z) => dist(a, mid) - dist(z, mid))[0];
        if (!mid || pick !== q) continue;
        give(q, 'flank', `sent into their centre: hitting their ${NAME[mid.unit]}`, mid.id);
      } else {
        const w: -1 | 1 = plan.strike === 2 ? (wingOf(q) as -1 | 1) : plan.strike;
        // the waiting reserve nearest that wing goes
        const pick = waiting.slice().sort((a, z) => (a.my - z.my) * -w)[0];
        if (pick !== q) continue;
        let t = endSquad(w);
        if (sentAt(t.id) >= K.maxPerTarget) t = foeInf.slice().sort((a, z) => dist(q, a) - dist(q, z)).find(e => sentAt(e.id) < K.maxPerTarget) ?? t;
        give(q, 'flank', `sent round their ${wingName(w) === 'left' ? 'right' : 'left'} flank`, t.id);
      }
      waiting.splice(waiting.indexOf(q), 1);
      if (c.burst > 1) c.burst--; // a burst: the next one goes straight away
      else { c.burst = 0; c.nextCommit = b.t + K.commitEvery * tempo; }
      continue;
    }
    if (m.kind === 'advance' || m.kind === 'reinforce' || m.kind === 'attack' || m.kind === 'flank') {
      // push orders: squads in the commander's push group keep driving while they have the strength; anyone may push
      // to finish off an enemy that's about to break.
      const e = fighting(q) ? b.squads[q.target - 1] : null;
      const here = inPush(q), finish = !!e && wavering(e) && q.fatigue < K.pushStart;
      const was = !!m.push;
      m.push = !!e && ((here && q.fatigue < K.pushStop) || (finish && !(e.pushing && e.target === q.id)));
      const edge = finish && !here;
      if (m.kind !== 'advance') continue;
      void was;
      if (m.push) m.why = here && c.breach ? 'pushing: breaking through their line' : edge ? 'pushing: they are giving way in front of us' : 'pushing: this is where we strike';
      // we broke through here: turn up and down their line straight away
      if (c.through && Math.abs(q.my - c.through.y) < K.breachWidth && q.state !== 'melee' && foeInf.length) {
        const t = foeInf.filter(x => sentAt(x.id) < K.maxPerTarget).sort((a, z) => dist(q, a) - dist(q, z))[0];
        if (t) { give(q, 'flank', 'through their line: rolling it up', t.id); continue; }
      }
      else if (m.why.startsWith('pushing')) m.why = 'holding the line';
      // on our own with nobody to fight: rejoin the nearest friends who are fighting (fight together, not scattered)
      if (engaged && q.state !== 'melee' && open(q) && !myInf.some(o => o !== q && dist(o, q) < K.isolatedDist)) {
        const f = myInf.filter(o => o !== q && fighting(o) && sentAt(o.target, o) < K.maxPerTarget).sort((a, z) => dist(q, a) - dist(q, z))[0];
        if (f) { give(q, 'reinforce', `regrouping: joining our ${NAME[f.unit]}`, f.target); continue; }
      }
      // nobody left in front of us: turn and roll up their line
      if (engaged && sinceContact > K.rollAfter && q.state !== 'melee' && foeInf.length && open(q) && !foeInf.some(x => Math.abs(x.my - q.my) < K.rollLateral && Math.abs(x.mx - q.mx) < K.rollDepth)) {
        const t = foeInf.filter(x => sentAt(x.id) < K.maxPerTarget).sort((a, z) => dist(q, a) - dist(q, z))[0];
        if (t) give(q, 'flank', 'nobody left in front: rolling up their line', t.id);
      }
      continue;
    }
    if (!open(q)) continue;
    if (m.kind === 'disengage' && q.fatigue >= K.restedAt && waiting.length + 1 <= myInf.length / 2) { give(q, 'reserve', 'resting behind the line', 0, wingOf(q), 0); continue; }
    give(q, 'advance', 'back to the line: fighting the enemy in front');
  }

  // ---- cavalry ----
  const cav = mine.filter(q => q.unit === 'cavalry');
  // one screen per wing while the enemy still has cavalry (the squad nearest that wing)
  const screens = new Set<BSquad>();
  const hook = plan?.kind === 'hook' && !plan.defend;
  if (foeCav.length && cav.length >= 4) {
    for (const w of [-1, 1] as const) {
      if (hook && w === plan!.strike) continue; // a hook sends everything on its wing round: the screen stays on the other wing only
      const pool = cav.filter(q => wingOf(q) === w).sort((a, z) => (a.my - z.my) * -w); if (pool.length) screens.add(pool[0]); }
  } else if (foeCav.length && cav.length >= 2) {
    // few cavalry: one screen, on the wing most of their cavalry is on
    const w = foeCav.reduce((a, e) => a + (e.my < b.H / 2 ? -1 : 1), 0) <= 0 ? -1 : 1;
    screens.add(cav.slice().sort((a, z) => (a.my - z.my) * -w)[0]);
  } else if (foeCav.length >= 2 && cav.length === 1) screens.add(cav[0]);

  for (const q of cav) {
    const m = q.mission, w = wingOf(q);
    // pull out of a bad fight: stuck on spearmen who aren't breaking, or badly hurt
    if (q.state === 'melee' && m?.kind !== 'disengage' && q.target > 0 && valid(b, q.target)) {
      const e = b.squads[q.target - 1], hp = squadHp(b, q);
      const hurt = hp < K.disengageHp && !c.rallied.has(q.id);
      if (!wavering(e) && !e.broken && ((e.unit === 'spearmen' && q.meleeSince >= 0 && b.t - q.meleeSince > K.badFightSeconds) || hurt)) {
        if (hurt) c.rallied.add(q.id);
        give(q, 'disengage', hurt ? 'badly hurt: pulling back to rally' : 'pulling out of a fight with spearmen', 0, w, K.rallySeconds);
        continue;
      }
    }
    if (!open(q)) continue;
    // options, best score wins
    let kind: MissionKind = 'reserve', why = engaged ? 'in reserve: nothing worth charging yet' : 'in reserve until the lines meet', target = 0, score = engaged || !myInf.length ? 0.2 : 1; // once the fight is on, almost anything beats waiting
    const consider = (s: number, k: MissionKind, y: string, t = 0) => { if (s > score) { score = s; kind = k; why = y; target = t; } };
    for (const t of threats) {
      if (t.unit === 'spearmen' && t.state !== 'melee') continue; // not head-on into fresh spears
      const d = dist(q, t);
      // one chaser per threat (never the whole team after one squad): the wing's screen first; a striker only if it's right there
      const raider = t.unit === 'cavalry'; // enemy cavalry behind our line: every nearby horse answers it (up to cavAnswerers at once)
      if (sentAt(t.id, q) >= (raider ? K.cavAnswerers : 1)) continue;
      if (screens.has(q) ? d < K.answerRange * 1.5 : d < (raider ? K.cavAnswerRange : K.strikerAnswer)) consider((screens.has(q) ? 9 : raider ? 9.5 : 4) - d / (raider ? 3 : 4), 'intercept', `stopping enemy ${NAME[t.unit]} ${t.unit === 'cavalry' ? 'raiding' : 'coming'} round our flank`, t.id);
    }
    if (screens.has(q)) consider(6, 'screen', 'guarding our flank against their cavalry');
    // (a hook rides out before the lines meet; bold cavalry raid more, cautious cavalry less)
    const raidGate = hook ? K.planWhenGap + 4 : K.raidWhenGap, bold = (T.cav - 0.5) * 2;
    const hookBonus = (y: number) => (hook && sector(y) === plan!.strike ? 2.5 : striking(y) ? 0.8 : 0);
    if (gap < raidGate) {
      for (const a of foeArch) if (sentAt(a.id, q) < K.maxPerTarget) consider((sentAt(a.id, q) ? 3 : K.raidScore + bold) + hookBonus(a.my) - dist(q, a) / 8, 'raid', 'riding round to hit their archers', a.id);
      if (hook && !engaged) for (const e of foeInf) if (sector(e.my) === plan!.strike && sentAt(e.id, q) < K.maxPerTarget)
        consider(7 + bold - dist(q, e) / 10 - (e.unit === 'spearmen' ? 1.5 : 0), 'shock', `the hook: riding round to hit their ${NAME[e.unit]} from behind`, e.id);
      for (const e of foeInf) if (e.state === 'melee' && sentAt(e.id, q) < K.maxPerTarget)
        consider(4.5 + bold * 0.5 + (wavering(e) ? 1.5 : 0) + hookBonus(e.my) + e.fatigue - (e.unit === 'spearmen' ? 0.8 : 0) - dist(q, e) / 8 - sentAt(e.id, q), 'shock', `charging their ${NAME[e.unit]} from behind`, e.id);
      if (c.breach && valid(b, c.breach.target) && sentAt(c.breach.target, q) < 2) consider(6.2 - dist(q, b.squads[c.breach.target - 1]) / 10, 'shock', 'charging the weak spot in their line', c.breach.target);
      if (!screens.has(q)) for (const e of foeCav) consider(2 - dist(q, e) / 8 - sentAt(e.id, q), 'attack', 'taking on their cavalry', e.id);
    }
    // nothing better and the fight is on: charge the nearest enemy that isn't fresh spearmen (any enemy if that's all there is)
    if (gap < K.raidWhenGap && (!myInf.length || sinceContact > K.commitEvery)) for (const e of foes) if (!e.broken)
      consider(1.8 - dist(q, e) / 12 - (e.unit === 'spearmen' ? 0.6 : 0) - sentAt(e.id, q) * 0.3, 'attack', `charging their ${NAME[e.unit]}`, e.id);
    for (const e of foes) if (e.broken && sentAt(e.id, q) < 1) consider(2 - dist(q, e) / 10, 'pursue', `running down broken ${NAME[e.unit]}`, e.id);
    if (!foes.some(e => !e.broken) && foes.length) consider(2.5, 'pursue', 'running them down', foes[0].id);
    give(q, kind, why, target, w);
  }
}

/** Where a posted squad (reserve / screen) or a rallying one stands, from its side's line. */
export function postOf(b: BattleState, q: BSquad): { x: number; y: number } {
  const K = CONFIG.battle.commander, L = b.line[q.side], m = q.mission!;
  if (!isFinite(L.front)) return { x: q.cx, y: q.cy };
  const clampY = (y: number) => Math.max(1, Math.min(b.H - 1, y));
  const out = halfFront(q.unit) + K.screenOut;
  if (q.unit === 'cavalry') {
    const y = clampY(m.wing < 0 ? L.lo - out : L.hi + out);
    const back = m.kind === 'screen' ? K.screenBack : m.kind === 'disengage' ? K.rallyBack : 2;
    return { x: (L.front - back) * q.fwd, y };
  }
  return { x: (L.front - Math.max(K.reserveBack, Math.min(q.lineDepth, 4))) * q.fwd, y: clampY(m.postY ?? q.homeY) };
}
