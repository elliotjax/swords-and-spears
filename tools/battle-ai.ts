// How the commanders use their army, and how different the battles are from each other.
// Run: npx esbuild tools/battle-ai.ts --bundle --platform=node --outfile=node_modules/.cache/ai.cjs --log-level=warning && node node_modules/.cache/ai.cjs [quick]
//  - IDLE: share of soldier-time (after the lines meet, until the battle is decided) where a soldier has nobody to fight
//    (melee: no enemy within reach; archers: nothing to shoot), by unit and by the squad's mission.
//  - VARIETY: the same two armies fought with different seeds: which plans the commanders chose, where the first squad broke,
//    how long it took, who won and by how much. No two battles should play out the same.
import { createBattle, stepBattle, type BattleState, type SquadSetup } from '../src/battle/battle';
import { CONFIG } from '../src/config';

const quick = process.argv.includes('quick');
const mk = (o: Record<string, number>): SquadSetup[] => Object.entries(o).flatMap(([u, n]) => Array.from({ length: n }, () => ({ unit: u as SquadSetup['unit'], rank: 1 })));
const ARMIES: [string, Record<string, number>, number][] = [
  ['mixed 4/4/2/4', { swordsmen: 4, spearmen: 4, archers: 2, cavalry: 4 }, quick ? 10 : 24],
  ['big 10/10/6/12', { swordsmen: 10, spearmen: 10, archers: 6, cavalry: 12 }, quick ? 4 : 10],
];

for (const [name, A, N] of ARMIES) {
  const idleU: Record<string, [number, number]> = {}, idleM: Record<string, [number, number]> = {};
  const rows: { plans: string; sector: string; t: number; win: number; margin: number; pushes: number; breaches: number; flank: number; exploits: number; shores: number; changes: number; gaps: number; det: number; ops: number; broke: number; held: number }[] = [];
  for (let i = 0; i < N; i++) {
    const b = createBattle({ sides: [mk(A), mk(A)], commander: [true, true] }, 500 + i * 37, i % 2 === 1);
    let firstBreak = '';
    const plans = ['', ''];
    while (!b.over) {
      stepBattle(b);
      for (const s of [0, 1]) { const p = b.cmd[s]?.plan; if (p && !plans[s]) plans[s] = (p as { kind?: string }).kind ?? p.why.split(':')[0]; }
      if (!firstBreak) { const q = b.squads.find(x => x.broken && x.unit !== 'cavalry' && x.unit !== 'archers'); if (q) { const L = b.line[q.side]; const sp = Math.max(1, L.hi - L.lo); firstBreak = q.my < L.lo + sp / 3 ? 'wing' : q.my > L.hi - sp / 3 ? 'wing' : 'centre'; } }
      if (b.firstContact < 0 || b.decidedAt >= 0 || Math.round(b.t * 20) % 10) continue;
      sample(b, idleU, idleM);
    }
    const alive = (s: number) => b.soldiers.filter(x => x.side === s && !x.dead && !x.fled).length;
    rows.push({ plans: plans.join(' | '), sector: firstBreak || '-', t: b.t, win: b.winner, margin: Math.abs(alive(0) - alive(1)), pushes: (b.cmd[0]?.pushes ?? 0) + (b.cmd[1]?.pushes ?? 0), breaches: (b.cmd[0]?.breaches ?? 0) + (b.cmd[1]?.breaches ?? 0), flank: b.stats.flankHits[0] + b.stats.flankHits[1], exploits: (b.cmd[0]?.exploits ?? 0) + (b.cmd[1]?.exploits ?? 0), shores: (b.cmd[0]?.shores ?? 0) + (b.cmd[1]?.shores ?? 0), changes: (b.cmd[0]?.planChanges ?? 0) + (b.cmd[1]?.planChanges ?? 0), gaps: (b.cmd[0]?.gapCharges ?? 0) + (b.cmd[1]?.gapCharges ?? 0), det: (b.cmd[0]?.detachments ?? 0) + (b.cmd[1]?.detachments ?? 0), ops: (b.cmd[0]?.ops ?? 0) + (b.cmd[1]?.ops ?? 0), broke: (b.cmd[0]?.opsBroke ?? 0) + (b.cmd[1]?.opsBroke ?? 0), held: (b.cmd[0]?.opsHeld ?? 0) + (b.cmd[1]?.opsHeld ?? 0) });
  }
  const pct = (a: [number, number]) => `${(a[0] / Math.max(1, a[1]) * 100).toFixed(0)}%`;
  console.log(`\n=== ${name}, ${N} battles ===`);
  console.log('IDLE soldier-time by unit:   ' + Object.entries(idleU).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
  console.log('IDLE soldier-time by mission: ' + Object.entries(idleM).sort((a, z) => z[1][1] - a[1][1]).map(([k, v]) => `${k} ${pct(v)} (of ${(v[1] / Object.values(idleM).reduce((a, x) => a + x[1], 0) * 100).toFixed(0)}% of time)`).join(', '));
  const all = Object.values(idleU).reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
  console.log(`IDLE overall: ${pct(all as [number, number])}`);
  const count = (f: (r: typeof rows[0]) => string) => { const m: Record<string, number> = {}; for (const r of rows) m[f(r)] = (m[f(r)] ?? 0) + 1; return Object.entries(m).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${k} x${v}`).join(', '); };
  const plansEach: Record<string, number> = {}; for (const r of rows) for (const p of r.plans.split(' | ')) plansEach[p] = (plansEach[p] ?? 0) + 1;
  console.log('plans chosen: ' + Object.entries(plansEach).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${k} x${v}`).join(', '));
  console.log('different plan pairs: ' + new Set(rows.map(r => r.plans)).size + '/' + N + '; first infantry squad broke on the: ' + count(r => r.sector));
  const sd = (f: (r: typeof rows[0]) => number) => { const m = rows.reduce((a, r) => a + f(r), 0) / rows.length; return [m, Math.sqrt(rows.reduce((a, r) => a + (f(r) - m) ** 2, 0) / rows.length)]; };
  const [tm, ts] = sd(r => r.t), [mm, ms] = sd(r => r.margin), [pm, ps] = sd(r => r.pushes), [fm, fs] = sd(r => r.flank);
  const [em, es] = sd(r => r.exploits), [hm] = sd(r => r.shores), [cm] = sd(r => r.changes), [bm] = sd(r => r.breaches);
  console.log(`per battle (both sides): squads sent through gaps / round the ends ${em.toFixed(1)} ± ${es.toFixed(1)}, line shored up ${hm.toFixed(1)}, plan changes ${cm.toFixed(1)}, breakthrough attempts ${bm.toFixed(1)}`);
  { const [gm, gs] = sd(r => r.gaps), [dm] = sd(r => r.det); console.log(`breakthrough charges through holes in the line ${gm.toFixed(1)} ± ${gs.toFixed(1)} per battle, detachments split off ${dm.toFixed(1)}`); }
  { const [om] = sd(r => r.ops), [bk] = sd(r => r.broke), [hd] = sd(r => r.held); console.log(`push operations ${om.toFixed(1)} per battle: broke through ${bk.toFixed(1)}, held ${hd.toFixed(1)}`); }
  console.log(`length ${(tm / 60).toFixed(1)} min ± ${(ts / 60).toFixed(1)}; winner's margin ${mm.toFixed(0)} ± ${ms.toFixed(0)} soldiers; pushes ${pm.toFixed(1)} ± ${ps.toFixed(1)}; flank hits ${fm.toFixed(0)} ± ${fs.toFixed(0)}; red wins ${rows.filter(r => r.win === 0).length}/${N}`);
}

function sample(b: BattleState, idleU: Record<string, [number, number]>, idleM: Record<string, [number, number]>) {
  for (const s of b.soldiers) {
    if (s.dead || s.fled) continue;
    const q = b.squads[s.squad - 1];
    if (q.broken || q.fleeing) continue;
    let busy = false;
    if (s.target > 0) {
      const t = b.soldiers[s.target - 1];
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      busy = !t.dead && !t.fled && (q.unit === 'archers' && q.ammo > 0 ? d <= (CONFIG.battle.units.archers.range ?? 7) * 1.05 : d < 1.6 + (q.unit === 'boss' ? 0.8 : 0));
    }
    const u = idleU[q.unit] ??= [0, 0]; u[1]++; if (!busy) u[0]++;
    const k = (q.unit === 'cavalry' ? 'cav:' : q.unit === 'archers' ? 'arch:' : '') + (q.mission?.kind ?? '-');
    const m = idleM[k] ??= [0, 0]; m[1]++; if (!busy) m[0]++;
  }
}
