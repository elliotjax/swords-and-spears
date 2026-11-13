// The main part of the battle (first 75 s after the lines meet), commanders on both sides.
// Run: npx esbuild tools/battle-main.ts --bundle --platform=node --outfile=node_modules/.cache/bm.cjs --log-level=warning && node node_modules/.cache/bm.cjs
import { createBattle, stepBattle, type SquadSetup } from '../src/battle/battle';
const mk = (o: Record<string, number>): SquadSetup[] => Object.entries(o).flatMap(([u, n]) => Array.from({ length: n }, () => ({ unit: u as SquadSetup['unit'], rank: 1 })));
const A = { swordsmen: 4, spearmen: 4, archers: 2, cavalry: 4 }, N = 12, MAIN = 75;
const tgt: Record<string, number> = {}; let tot = 0, archHit = 0, firstArch = 0, fa = 0;
const ep: { dur: number; fwd: number; braced: number }[] = [];
let pushSoldiers = 0, pushTicks = 0;
let events = 0, evSize = 0, plugs = 0, regroups = 0, totalT = 0; const sizes: Record<number, number> = {};
for (let i = 0; i < N; i++) {
  const b = createBattle({ sides: [mk(A), mk(A)], commander: [true, true] }, 30 + i * 5, i % 2 === 1);
  const open = new Map<number, { t: number; x: number; br: number; n: number }>();
  let c0 = -1, hit = false;
  const last: (unknown)[] = [null, null]; const why = new Map<number, string>();
  while (!b.over) {
    stepBattle(b);
    for (const s of [0, 1]) { const p = b.cmd[s]?.push ?? null; if (p !== last[s] && last[s]) { const n = (last[s] as { ids: number[] }).ids.length; events++; evSize += n; sizes[n] = (sizes[n] ?? 0) + 1; } last[s] = p; }
    for (const q of b.squads) { const w = q.mission?.why ?? ''; if (w !== why.get(q.id)) { why.set(q.id, w); if (w.startsWith('plugging')) plugs++; if (w.startsWith('regrouping')) regroups++; } }
    if (b.over) totalT += b.t;
    if (b.firstContact < 0) continue;
    if (c0 < 0) c0 = b.t;
    const main = b.t - c0 < MAIN;
    let pushingNow = 0;
    for (const q of b.squads) {
      if (q.gone) continue;
      if (main && q.unit === 'cavalry' && !q.broken && q.state === 'melee' && q.target > 0) {
        const u = b.squads[q.target - 1].unit; tgt[u] = (tgt[u] ?? 0) + 1; tot++;
        if (u === 'archers' && !hit) { hit = true; archHit++; firstArch += b.t - c0; fa++; }
      }
      const o = open.get(q.id);
      if (q.pushing) { pushingNow += q.members.length; if (!o) open.set(q.id, { t: b.t, x: q.cx * q.fwd, br: 0, n: 0 }); else { o.n++; if (q.target > 0 && b.squads[q.target - 1].bracing) o.br++; } }
      else if (o) { if (main || o.t - c0 < MAIN) ep.push({ dur: b.t - o.t, fwd: q.cx * q.fwd - o.x, braced: o.br / Math.max(1, o.n) }); open.delete(q.id); }
    }
    if (main) { pushSoldiers += pushingNow; pushTicks++; }
  }
}
const avg = (f: (e: typeof ep[0]) => number, l = ep) => (l.reduce((a, e) => a + f(e), 0) / Math.max(1, l.length));
console.log(`MAIN PART (first ${MAIN} s after contact), ${N} mixed battles`);
console.log('cavalry fighting time by enemy: ' + Object.entries(tgt).sort((a, z) => z[1] - a[1]).map(([u, n]) => `${u} ${(n / tot * 100).toFixed(0)}%`).join(', '));
console.log(`battles where cavalry reached the archers in the main part: ${archHit}/${N}` + (fa ? `, on average ${(firstArch / fa).toFixed(0)} s after contact` : ''));
const long = ep.filter(e => e.dur >= 3);
console.log(`pushes (3 s or longer): ${(long.length / N).toFixed(1)} per battle, lasting ${avg(e => e.dur, long).toFixed(0)} s, moving the line ${avg(e => e.fwd, long).toFixed(1)} tiles forward on average (best ${Math.max(0, ...long.map(e => e.fwd)).toFixed(1)}); enemy braced ${(avg(e => e.braced, long) * 100).toFixed(0)}% of that time`);
console.log(`soldiers pushing at once, on average: ${(pushSoldiers / Math.max(1, pushTicks)).toFixed(0)}`);

console.log(`WHOLE BATTLE: big pushes per army ${(events / N / 2).toFixed(1)} (battle ${(totalT / N).toFixed(0)} s), squads in a push ${(evSize / Math.max(1, events)).toFixed(1)} (${Object.entries(sizes).map(([k, v]) => `${k}: ${v}`).join(', ')}); gap-plugging orders ${(plugs / N).toFixed(1)}, regroup orders ${(regroups / N).toFixed(1)} per battle`);
