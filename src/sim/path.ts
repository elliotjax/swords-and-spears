import { CONFIG } from '../config';
import { FOREST, STONE, type GameState } from './types';

// A* pathfinding on the tile grid (8 directions, no corner cutting).
// Slightly prefers worn tiles so foot traffic reinforces itself into roads.

let g = new Float32Array(0);
let came = new Int32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let gen = 1;
let heap: number[] = [];
let heapF: number[] = [];

function push(i: number, f: number) {
  heap.push(i); heapF.push(f);
  let k = heap.length - 1;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= heapF[k]) break;
    [heap[p], heap[k]] = [heap[k], heap[p]];
    [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
    k = p;
  }
}
function pop(): number {
  const top = heap[0];
  const li = heap.pop()!, lf = heapF.pop()!;
  if (heap.length) {
    heap[0] = li; heapF[0] = lf;
    let k = 0;
    const n = heap.length;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < n && heapF[l] < heapF[m]) m = l;
      if (r < n && heapF[r] < heapF[m]) m = r;
      if (m === k) break;
      [heap[m], heap[k]] = [heap[k], heap[m]];
      [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
      k = m;
    }
  }
  return top;
}

export function walkable(s: GameState, i: number): boolean {
  return s.occ[i] === -1;
}

export function tileCost(s: GameState, i: number): number {
  const P = CONFIG.paths;
  const t = s.tiles[i];
  const base = t === FOREST ? CONFIG.villagers.forestWalkCost : t === STONE ? CONFIG.map.stoneWalkCost : 1;
  return base * (1 - P.preferWorn * s.wear[i]);
}

/** Path to one exact tile. */
export function findPathToTile(s: GameState, sx: number, sy: number, goal: number): number[] | null {
  return findPathToRect(s, sx, sy, goal % s.w, Math.floor(goal / s.w), 1, 1, goal);
}

/**
 * Find a path from (sx,sy) to any walkable tile touching the target rectangle.
 * Returns tile indices (excluding the start), or null if unreachable.
 */
export function findPathToRect(
  s: GameState, sx: number, sy: number,
  rx: number, ry: number, rw: number, rh: number,
  exact = -1, // if set, only this tile counts as arriving
): number[] | null {
  const W = s.w, H = s.h, N = W * H;
  if (g.length !== N) {
    g = new Float32Array(N); came = new Int32Array(N);
    seen = new Uint32Array(N); closed = new Uint32Array(N);
  }
  gen++;
  heap = []; heapF = [];
  const minCost = 1 - CONFIG.paths.preferWorn;
  const isGoal = (x: number, y: number) => exact >= 0 ? y * W + x === exact :
    x >= rx - 1 && x <= rx + rw && y >= ry - 1 && y <= ry + rh &&
    !(x >= rx && x < rx + rw && y >= ry && y < ry + rh);
  const hfun = (x: number, y: number) => {
    const pad = exact >= 0 ? 0 : 1;
    const dx = Math.max(rx - pad - x, 0, x - (rx + rw - 1 + pad));
    const dy = Math.max(ry - pad - y, 0, y - (ry + rh - 1 + pad));
    return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * minCost;
  };
  const start = sy * W + sx;
  g[start] = 0; seen[start] = gen; came[start] = -1;
  push(start, hfun(sx, sy));
  let found = -1;
  let guard = 0;
  while (heap.length && guard++ < 20000) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % W, cy = (cur / W) | 0;
    if (isGoal(cx, cy) && (walkable(s, cur) || cur === start)) { found = cur; break; }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!walkable(s, ni) || closed[ni] === gen) continue;
        if (dx && dy && (!walkable(s, cy * W + nx) || !walkable(s, ny * W + cx))) continue;
        const step = tileCost(s, ni) * (dx && dy ? 1.414 : 1);
        const ng = g[cur] + step;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; came[ni] = cur;
          push(ni, ng + hfun(nx, ny));
        }
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  for (let c = found; c !== start && c !== -1; c = came[c]) out.push(c);
  out.reverse();
  return out;
}
