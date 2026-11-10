// The shape of a battle, compared with how pre-modern battles actually went (see README "Battle research").
// Run: npx esbuild tools/battle-shape.ts --bundle --platform=node --outfile=node_modules/.cache/shape.cjs --log-level=warning && node node_modules/.cache/shape.cjs
//  - MIXING: share of fighting soldiers standing among more enemies than friends (lines should hold, not dissolve into a blob)
//  - FORMATION: how far soldiers stand from their place in the squad (tiles)
//  - LOSSES: winners' losses; share of the losers' losses that came after their army started to break (history: winners lose
//    about 5-10%, most of the losers' deaths come in the rout and pursuit)
//  - RHYTHM: melee intensity over time: how often the fighting surges and dies down (lulls), instead of one constant grind
import { createBattle, stepBattle, type BattleState, type SquadSetup } from '../src/battle/battle';
import { CONFIG } from "../src/config";
const EXP = process.argv[2];
if (EXP === "a") { CONFIG.battle.deadliness *= 0.5; const M = CONFIG.battle.morale as any; M.deathLoss *= 1.6; M.frontHitLoss *= 2; M.flankHitLoss *= 1.5; }

const mk = (o: Record<string, number>): SquadSetup[] => Object.entries(o).flatMap(([u, n]) => Array.from({ length: n }, () => ({ unit: u as SquadSetup['unit'], rank: 1 })));
const SETS: [string, Record<string, number>, number][] = [
  ['mixed 4/4/2/4', { swordsmen: 4, spearmen: 4, archers: 2, cavalry: 4 }, 8],
  ['infantry 6/6', { swordsmen: 6, spearmen: 6 }, 6],
  ['big 10/10/6/12', { swordsmen: 10, spearmen: 10, archers: 6, cavalry: 12 }, 3],
];
for (const [name, A, N] of SETS) {
  let mixS = 0, mixN = 0, offS = 0, offN = 0, winLoss = 0, lateShare = 0, lulls = 0, surges = 0, len = 0, cv = 0;
  for (let i = 0; i < N; i++) {
    const b = createBattle({ sides: [mk(A), mk(A)], commander: [true, true] }, 900 + i * 41, i % 2 === 1);
    const n0 = [0, 1].map(s => b.soldiers.filter(x => x.side === s).length);
    let breakAt = [-1, -1], deadAtBreak = [0, 0];
    const intensity: number[] = []; let hitsPrev = 0;
    while (!b.over) {
      stepBattle(b);
      for (const s of [0, 1]) if (breakAt[s] < 0) { const sq = b.squads.filter(q => q.side === s); if (sq.filter(q => q.broken || q.gone).length >= sq.length * 0.25) { breakAt[s] = b.t; deadAtBreak[s] = b.soldiers.filter(x => x.side === s && x.dead).length; } }
      if (Math.round(b.t * 20) % 20) continue;
      const hits = b.stats.hits[0] + b.stats.hits[1];
      if (b.firstContact >= 0 && b.decidedAt < 0) intensity.push(hits - hitsPrev);
      hitsPrev = hits;
      if (b.firstContact < 0 || b.decidedAt >= 0) continue;
      const m = mixing(b); mixS += m[0]; mixN += m[1];
      const o = offSlot(b); offS += o[0]; offN += o[1];
    }
    const w = b.winner === -1 ? 0 : b.winner, l = 1 - w;
    const dead = (s: number) => b.soldiers.filter(x => x.side === s && x.dead).length;
    winLoss += dead(w) / n0[w];
    lateShare += dead(l) ? (dead(l) - (breakAt[l] >= 0 ? deadAtBreak[l] : dead(l))) / dead(l) : 0;
    len += b.t;
    // rhythm: smooth to 3 s, count rises above 1.3x the mean (surges) and drops below 0.5x the mean (lulls)
    const sm = intensity.map((_, k) => { const a = intensity.slice(Math.max(0, k - 1), k + 2); return a.reduce((x, y) => x + y, 0) / a.length; });
    const mean = sm.reduce((x, y) => x + y, 0) / Math.max(1, sm.length);
    let up = false, down = false;
    for (const v of sm) { if (!up && v > mean * 1.3) { surges++; up = true; } if (v < mean * 1.1) up = false; if (!down && v < mean * 0.5) { lulls++; down = true; } if (v > mean * 0.8) down = false; }
    const sd = Math.sqrt(sm.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, sm.length));
    cv += sd / Math.max(1e-9, mean);
  }
  console.log(`\n=== ${name}, ${N} battles, ${(len / N / 60).toFixed(1)} min ===`);
  console.log(`MIXING: ${(mixS / Math.max(1, mixN) * 100).toFixed(0)}% of soldiers in a fight stand among more enemies than friends`);
  console.log(`FORMATION: soldiers stand ${(offS / Math.max(1, offN)).toFixed(2)} tiles from their place in the squad on average (spacing is 0.34)`);
  console.log(`LOSSES: winners lose ${(winLoss / N * 100).toFixed(0)}% of their men; ${(lateShare / N * 100).toFixed(0)}% of the losers' deaths come after a quarter of their squads broke`);
  console.log(`RHYTHM: ${(surges / N).toFixed(1)} surges and ${(lulls / N).toFixed(1)} lulls per battle; ups and downs ${(cv / N).toFixed(2)} (0 = one constant grind)`);
}

/** Soldiers within 1.2 tiles of an enemy: how many have more enemies than friends within 1.2 tiles. */
function mixing(b: BattleState): [number, number] {
  const live = b.soldiers.filter(s => !s.dead && !s.fled);
  const grid = new Map<number, typeof live>();
  for (const s of live) { const k = Math.floor(s.x) * 1000 + Math.floor(s.y); (grid.get(k) ?? grid.set(k, []).get(k)!).push(s); }
  let mixed = 0, n = 0;
  for (const s of live) {
    let fr = 0, en = 0;
    for (let gx = Math.floor(s.x) - 1; gx <= Math.floor(s.x) + 1; gx++) for (let gy = Math.floor(s.y) - 1; gy <= Math.floor(s.y) + 1; gy++)
      for (const o of grid.get(gx * 1000 + gy) ?? []) { if (o === s || Math.hypot(o.x - s.x, o.y - s.y) > 1.2) continue; if (o.side === s.side) fr++; else en++; }
    if (!en) continue;
    n++; if (en > fr) mixed++;
  }
  return [mixed, n];
}

/** Distance of each infantry soldier from the middle of its squad's block, minus what the block's own size explains. */
function offSlot(b: BattleState): [number, number] {
  let s = 0, n = 0;
  for (const q of b.squads) {
    if (q.gone || q.broken || q.unit === 'cavalry' || q.unit === 'archers' || q.unit === 'boss') continue;
    const m = q.members.map(id => b.soldiers[id - 1]).filter(x => !x.dead && !x.fled);
    if (m.length < 2) continue;
    const cx = m.reduce((a, x) => a + x.x, 0) / m.length, cy = m.reduce((a, x) => a + x.y, 0) / m.length;
    for (const x of m) { s += Math.max(0, Math.hypot(x.x - cx, x.y - cy) - 0.75); n++; } // 0.75 = roughly the half-size of a tidy 5x2 block
  }
  return [s, n];
}
