// Battle health check. Run:  npm run battle:check            (everything)
//                            npm run battle:check -- quick    (fewer battles)
//                            npm run battle:check -- map      (ASCII pictures of one mixed battle every 10 s)
//                            npm run battle:check -- legacy   (no commanders: squads use their own orders, as before)
// By default both armies are led by the army commander (src/battle/commander.ts).
// Prints: who wins each matchup (unit counters, fairness between sides), battle length,
// how much squads stand idle, squads that never fought, share of hits from the flank, and speed.
import { createBattle, stepBattle, squadAlive, type BattleState, type SquadSetup, type Order } from '../src/battle/battle';

type Army = Record<string, number>;
const mk = (o: Army, order?: Order, rank = 1): SquadSetup[] => Object.entries(o).flatMap(([u, n]) => Array.from({ length: n }, () => ({ unit: u as SquadSetup['unit'], rank, ...(order ? { order } : {}) })));
const args = process.argv.slice(2), quick = args.includes('quick'), legacy = args.includes('legacy');
const commander: [boolean, boolean] | undefined = legacy ? undefined : [true, true];
const DELIBERATE = ['reserve', 'screen', 'disengage', 'support'];

/** ASCII picture: S/P/A/C = red swords/spears/archers/cavalry, lower case = blue; * fighting, ~ broken, w waiting in reserve. */
export function asciiMap(b: BattleState): string {
  const W = Math.ceil(b.W), H = Math.ceil(b.H);
  const g = Array.from({ length: H }, () => Array.from({ length: W * 2 }, () => ' '));
  for (const q of b.squads) {
    if (q.gone || !squadAlive(b, q)) continue;
    const x = Math.max(0, Math.min(W * 2 - 2, Math.round(q.mx * 2))), y = Math.max(0, Math.min(H - 1, Math.round(q.my)));
    const L = { swordsmen: 'S', spearmen: 'P', archers: 'A', cavalry: 'C' }[q.unit];
    g[y][x] = q.side === 0 ? L : L.toLowerCase();
    g[y][x + 1] = q.fleeing ? '!' : q.broken ? '~' : q.state === 'melee' ? '*' : q.waiting ? 'w' : q.state === 'formup' ? '=' : q.state === 'charge' ? '>' : q.state === 'withdraw' ? '<' : ' ';
  }
  return g.map(r => '|' + r.join('') + '|').join('\n');
}

function run(a: SquadSetup[], bb: SquadSetup[], seed: number, swap: boolean) {
  const b = createBattle({ sides: [a, bb], commander }, seed, swap);
  let idle = 0, wait = 0, ticks = 0, ms = 0, steps = 0;
  const prev = new Map<number, [number, number]>();
  while (!b.over) {
    const t0 = performance.now(); stepBattle(b); ms += performance.now() - t0; steps++;
    if (b.firstContact < 0 || b.decidedAt >= 0) continue;
    for (const q of b.squads) {
      if (q.gone || q.fleeing || q.broken || q.order === 'hold') continue;
      const p = prev.get(q.id), moved = p ? Math.hypot(q.cx - p[0], q.cy - p[1]) : 1;
      prev.set(q.id, [q.cx, q.cy]);
      ticks++;
      const shooting = q.unit === 'archers' && q.ammo > 0 && b.t - q.lastFight < 6;
      const still = q.state === 'march' && moved < 0.004 && !shooting;
      if (q.waiting || (still && q.mission && DELIBERATE.includes(q.mission.kind))) wait++; // waiting on purpose (reserve, screen...)
      else if (still) idle++;                                                               // standing about with no reason
    }
  }
  const never = b.squads.filter(q => q.firstFight < 0).length / b.squads.length;
  const hits = b.stats.hits[0] + b.stats.hits[1], flank = b.stats.flankHits[0] + b.stats.flankHits[1];
  const mins = Math.max(0.2, b.t / 60), cs = b.cmd.filter(Boolean) as NonNullable<typeof b.cmd[0]>[];
  const changes = cs.reduce((a, c) => a + c.changes, 0) / b.squads.length / mins, commits = cs.reduce((a, c) => a + c.commits, 0);
  return { b, changes, commits, idle: idle / Math.max(1, ticks), wait: wait / Math.max(1, ticks), never, flank: flank / Math.max(1, hits), ms: ms / steps };
}

if (args.includes('map')) {
  const A = { swordsmen: 4, spearmen: 4, archers: 2, cavalry: 4 };
  const b = createBattle({ sides: [mk(A), mk(A)], commander }, 9);
  for (let t = 0; !b.over; t += 10) {
    while (b.t < t && !b.over) stepBattle(b);
    console.log(`\n--- ${t}s ---\n` + asciiMap(b));
    if (b.cmd[0]?.plan) console.log(`red plan: ${b.cmd[0].plan.why}   | blue plan: ${b.cmd[1]?.plan?.why}`);
    if (b.cmd[0]) console.log('red tiredness: ' + b.squads.filter(q => q.side === 0 && !q.gone && !q.fleeing).map(q => `${q.unit.slice(0, 2)}${q.num} ${(q.fatigue * 100).toFixed(0)}${q.pushing ? ' PUSH' : q.bracing ? ' brace' : ''}`).join(', '));
    if (b.cmd[0]) console.log('red missions: ' + b.squads.filter(q => q.side === 0 && !q.gone && !q.fleeing).map(q => `${q.unit.slice(0, 2)}${q.num} ${q.mission?.kind ?? '-'}${q.mission?.target ? '>' + b.squads[q.mission.target - 1].unit.slice(0, 2) + b.squads[q.mission.target - 1].num : ''}`).join(', '));
  }
  if (b.cmd[0]) console.log('red reasons at the end: ' + [...new Set(b.squads.filter(q => q.side === 0 && q.mission).map(q => q.mission!.why))].join(' | '));
  console.log('winner', b.winner);
  process.exit(0);
}

const N = quick ? 6 : 20;
const tests: [string, Army, Army, number, string, number?, number?][] = [
  ['sergeants v recruits', { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, N / 2, 'red', 3, 0],
  ['mirror mixed 2/2/2/2', { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, N * 2, 'even'],
  ['mirror 6 swords', { swordsmen: 6 }, { swordsmen: 6 }, N, 'even'],
  ['spears v cavalry', { spearmen: 2 }, { cavalry: 4 }, N / 2, 'red'],
  ['cavalry v archers', { cavalry: 4 }, { archers: 2 }, N / 2, 'red'],
  ['archers v spears', { archers: 2 }, { spearmen: 2 }, N / 2, 'red'],
  ['swords v spears', { swordsmen: 2 }, { spearmen: 2 }, N / 2, 'red'],
  ['3 v 2 swords', { swordsmen: 3 }, { swordsmen: 2 }, N / 2, 'red'],
  ['wide v deep (8 v 8 inf)', { swordsmen: 8 }, { swordsmen: 4, spearmen: 4 }, N / 2, '-'],
  ['huge 400', { swordsmen: 6, spearmen: 6, archers: 4, cavalry: 8 }, { swordsmen: 6, spearmen: 6, archers: 4, cavalry: 8 }, quick ? 4 : 10, 'even'],
  ['epic 1000', { swordsmen: 15, spearmen: 15, archers: 10, cavalry: 20 }, { swordsmen: 15, spearmen: 15, archers: 10, cavalry: 20 }, quick ? 2 : 6, 'even'],
];
const pct = (x: number) => (x * 100).toFixed(0).padStart(3) + '%';
console.log((legacy ? 'NO COMMANDERS' : 'COMMANDERS ON BOTH SIDES') + '   (idle = standing with no reason; wait = waiting on purpose; chg = mission changes per squad per minute; commits = reserves committed per battle)');
console.log('matchup'.padEnd(26) + 'red blue | left | minutes | idle wait never-fought flank-hits | chg commits | ms/step | expect');
for (const [name, a, bb, n, expect, ra = 1, rb = 1] of tests) {
  let red = 0, blue = 0, left = 0, time = 0, idle = 0, wait = 0, never = 0, flank = 0, ms = 0, chg = 0, com = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1, r = run(mk(a, undefined, ra), mk(bb, undefined, rb), 100 + i * 17, swap);
    if (r.b.winner === 0) red++; else if (r.b.winner === 1) blue++;
    if (r.b.winner !== -1 && (r.b.winner === 0) !== swap) left++;
    time += r.b.t; idle += r.idle; wait += r.wait; never += r.never; flank += r.flank; ms += r.ms; chg += r.changes; com += r.commits;
  }
  const ok = expect === 'red' ? red >= n * 0.7 : expect === 'even' ? Math.abs(red - blue) <= Math.max(3, n * 0.45) : true;
  console.log(`${name.padEnd(26)}${String(red).padStart(3)} ${String(blue).padStart(4)} | ${String(left).padStart(2)}/${n} | ${(time / n / 60).toFixed(1).padStart(7)} | ${pct(idle / n)} ${pct(wait / n)} ${pct(never / n)} ${pct(flank / n)}          | ${(chg / n).toFixed(1)} ${(com / n).toFixed(1).padStart(5)}   | ${(ms / n).toFixed(2).padStart(7)} | ${expect} ${ok ? 'OK' : '<-- CHECK'}`);
}
