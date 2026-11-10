import { CONFIG, type BuildingKind } from '../config';
import { DOORS } from '../sim/doors';
import { hash } from '../sim/rng';
import { FOREST, STONE, type GameState, type Villager } from '../sim/types';

// =====================================================================
//  Roofless pixel art. The world is painted into small canvases at
//  R art-pixels per tile, then scaled up crisply (no smoothing).
// =====================================================================

export const R = 16; // art pixels per tile

type G = CanvasRenderingContext2D;

// Earthy, muted palette
export const PX = {
  grass: ['#6f8a4a', '#7d985a', '#62803f', '#86a062', '#5a7638'],
  forestFloor: ['#55703a', '#4c6634', '#5e7a40'],
  rock: ['#8d877b', '#9d978a', '#7b766b', '#a8a294', '#6e695f'], // stone deposit ground
  boulder: '#9a958a', boulderHi: '#b8b3a6', boulderDark: '#6f6a60',
  plank: '#b48a58', plankDark: '#8e6a40',
  flowers: ['#e8d870', '#e8a0b0', '#f0f0e0', '#c8b0e8'],
  dirt: '#a58c62', dirtDark: '#8f7650', dirtLight: '#b8a074',
  gravel: ['#bdb6a4', '#a9a290', '#cfc9b8', '#9a9382'],
  stone: '#5f564c', stoneHi: '#766b5e', stoneDark: '#4a433b',
  woodWall: '#6b4a30', woodWallHi: '#7e5a3b',
  floor: '#9a7650', floorLine: '#87663f', floorDark: '#7d5c3a',
  tile: ['#b9a378', '#a89266'],
  bedFrame: '#5e4029', pillow: '#ebe3d2', blankets: ['#a33a3a', '#3a5a9a', '#4a7a3a', '#9a6a2a', '#6a4a8a'],
  table: '#6b4a30', tableHi: '#82603f', gold: '#e8b84a', red: '#b8382f', redDark: '#8e2a23', cream: '#e8dcc0',
  soil: '#6b4a2e', furrow: '#5a3e26', crops: ['#8fbf4a', '#a7cf5a', '#7aa83e'],
  leaf: ['#2f5a2a', '#3d6e33', '#4f8240', '#6a9a50'], trunkShadow: 'rgba(20,30,15,.35)',
  steel: '#a4acba', steelDark: '#6b7383', horse: '#7a4d31', horseDark: '#5a3824',
  skin: ['#f0c8a0', '#d9a27a', '#a8714c'],
  hair: ['#3b2a20', '#6b4426', '#c99a52', '#2a2a2e', '#9a4b2a'],
  tunics: ['#4f7fc4', '#b3323a', '#d9a441', '#5a8f5a', '#8a5aa8'],
};

// ---------- pixel helpers ----------
export function rect(g: G, x: number, y: number, w: number, h: number, col: string) {
  g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
const dot = (g: G, x: number, y: number, col: string) => rect(g, x, y, 1, 1, col);
function disc(g: G, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y) + 0.35);
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}
function ring(g: G, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let a = 0; a < 64; a++) { const t = (a / 64) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1); }
}

// ---------- ground ----------
export function paintGround(s: GameState): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = s.w * R; cv.height = s.h * R;
  const g = cv.getContext('2d')!;
  rect(g, 0, 0, cv.width, cv.height, PX.grass[0]);
  for (let ty = 0; ty < s.h; ty++) for (let tx = 0; tx < s.w; tx++) {
    const forest = s.tiles[ty * s.w + tx] === FOREST;
    const x0 = tx * R, y0 = ty * R;
    if (s.tiles[ty * s.w + tx] === STONE) { // rocky ground: grey grit with cracks
      rect(g, x0, y0, R, R, PX.rock[0]);
      for (let i = 0; i < 30; i++) dot(g, x0 + hash(tx * 31 + i, ty * 17, s.seed + 5) * R, y0 + hash(tx, ty * 13 + i, s.seed + 6) * R, PX.rock[1 + Math.floor(hash(tx + i, ty, s.seed + 7) * 4)]);
      continue;
    }
    if (forest) rect(g, x0, y0, R, R, PX.forestFloor[0]);
    // speckles
    const n = forest ? 26 : 22;
    for (let i = 0; i < n; i++) {
      const h1 = hash(tx * 31 + i, ty * 17, s.seed), h2 = hash(tx, ty * 13 + i, s.seed + 1), h3 = hash(tx + i, ty, s.seed + 2);
      const pal = forest ? PX.forestFloor : PX.grass;
      dot(g, x0 + h1 * R, y0 + h2 * R, pal[1 + Math.floor(h3 * (pal.length - 1))]);
    }
    if (!forest && hash(tx, ty, s.seed + 9) < 0.18) {
      const fx = x0 + 2 + hash(tx, ty, s.seed + 10) * (R - 4), fy = y0 + 2 + hash(tx, ty, s.seed + 11) * (R - 4);
      const col = PX.flowers[Math.floor(hash(tx, ty, s.seed + 12) * PX.flowers.length)];
      dot(g, fx, fy, col); dot(g, fx + 2, fy + 1, col); dot(g, fx + 1, fy + 2, '#4f7a36');
    }
  }
  return cv;
}

// ---------- roads (pixel gravel) ----------
export function paintRoads(s: GameState, cv: HTMLCanvasElement) {
  if (cv.width !== s.w * R) { cv.width = s.w * R; cv.height = s.h * R; }
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  const W = s.w, N = s.w * s.h, DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]];
  const adj: ({ x: number; y: number; L: number }[] | undefined)[] = new Array(N);
  for (let i = 0; i < N; i++) for (let d = 0; d < 4; d++) {
    const L = s.edgeLevel[i * 4 + d];
    if (!L) continue;
    const ax = i % W, ay = Math.floor(i / W), bx = ax + DIRS[d][0], by = ay + DIRS[d][1];
    if (bx < 0 || by < 0 || bx >= W || by >= s.h) continue;
    (adj[i] ??= []).push({ x: bx, y: by, L });
    (adj[by * W + bx] ??= []).push({ x: ax, y: ay, L });
  }
  // brush along smooth curves between link midpoints (through tile centres)
  const brush = (x: number, y: number, w: number, level: number, seed: number) => {
    const half = w / 2;
    for (let yy = Math.round(y - half); yy < Math.round(y + half); yy++)
      for (let xx = Math.round(x - half); xx < Math.round(x + half); xx++) {
        const h = hash(xx, yy, 77);
        let col: string;
        if (level === 1) { if (h < 0.55) continue; col = h < 0.8 ? PX.dirtLight : PX.dirt; }
        else col = PX.gravel[Math.floor(h * PX.gravel.length)];
        if (level >= 2 && (xx === Math.round(x - half) || xx === Math.round(x + half) - 1 || yy === Math.round(y - half) || yy === Math.round(y + half) - 1) && h < 0.5) col = PX.dirtDark;
        void seed;
        g.fillStyle = col; g.fillRect(xx, yy, 1, 1);
      }
  };
  const widths = [0, 2, 3, 5];
  for (const pass of [1, 2, 3]) {
    for (let i = 0; i < N; i++) {
      const list = adj[i];
      if (!list) continue;
      const cx = ((i % W) + 0.5) * R, cy = (Math.floor(i / W) + 0.5) * R;
      const mids = list.filter(n => n.L >= pass).map(n => ({ x: (cx + (n.x + 0.5) * R) / 2, y: (cy + (n.y + 0.5) * R) / 2, L: n.L }));
      const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        for (let t = 0; t <= 1; t += 0.06) {
          const u = 1 - t;
          brush(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y, widths[pass], pass, i);
        }
      };
      if (mids.length === 1) curve(mids[0], { x: cx, y: cy });
      for (let a = 0; a < mids.length; a++) for (let b = a + 1; b < mids.length; b++) curve(mids[a], mids[b]);
    }
  }
}

// ---------- buildings ----------
export interface PaintOpts { fill?: number; level?: number } // fill: 0..1 (granary)

/** Stone or wood walls around a room, with a doorway gap on the front side. */
function walls(g: G, x: number, y: number, w: number, h: number, doorX: number, col: string, hi: string, t = 2) {
  rect(g, x + 2, y + 2, w, h, 'rgba(0,0,0,.28)'); // shadow
  rect(g, x, y, w, h, col);
  rect(g, x, y, w, 1, hi); rect(g, x, y, 1, h, hi);
  rect(g, x + t, y + t, w - t * 2, h - t * 2, PX.floor);
  rect(g, doorX - 2, y + h - t, 4, t, PX.floorDark); // doorway
}
function planks(g: G, x: number, y: number, w: number, h: number, base: string, line: string) {
  rect(g, x, y, w, h, base);
  for (let yy = y + 2; yy < y + h; yy += 3) rect(g, x, yy, w, 1, line);
  for (let yy = y; yy < y + h; yy += 3) for (let xx = x + ((yy / 3) % 2 ? 3 : 7); xx < x + w; xx += 9) dot(g, xx, yy, line);
}
function tiles(g: G, x: number, y: number, w: number, h: number) {
  for (let yy = 0; yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) rect(g, x + xx, y + yy, 2, 2, PX.tile[((xx + yy) / 2) % 2]);
}
function bed(g: G, x: number, y: number, w: number, h: number, i: number) {
  rect(g, x, y, w, h, PX.bedFrame);
  rect(g, x, y + 2, w, h - 2, PX.blankets[i % PX.blankets.length]);
  rect(g, x, y, w, 2, PX.pillow);
}
function barrel(g: G, x: number, y: number) { disc(g, x, y, 2, '#7a5434'); dot(g, x - 1, y - 1, '#9a7048'); }
function crate(g: G, x: number, y: number) { rect(g, x, y, 4, 4, '#8a6440'); rect(g, x + 1, y + 1, 2, 2, '#a67c50'); }

/** Bed (sleeping spot) positions inside a building, in art pixels relative to its corner. */
export function bedSlots(kind: BuildingKind): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const grid = (x0: number, y0: number, cols: number, rows: number, px: number, py: number, bw: number) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * px + Math.floor(bw / 2), y: y0 + r * py + 3 });
  };
  if (kind === 'house') grid(3, 3, 5, 2, 5, 9, 4);
  else if (kind === 'longhouse') grid(3, 3, 9, 3, 5, 7, 4);
  else if (kind === 'manor') grid(4, 4, 10, 5, 4, 6, 3);
  else if (kind === 'barracks') grid(3, 3, 7, 3, 4, 7, 3);
  return out;
}

export function paintBuilding(g: G, kind: BuildingKind, ox: number, oy: number, o: PaintOpts = {}) {
  const d = CONFIG.buildings[kind];
  const W = d.w * R, H = d.h * R;
  const doorX = ox + DOORS[kind].x * R;
  switch (kind) {
    case 'townHall': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.stone, PX.stoneHi, 3);
      tiles(g, ox + 4, oy + 4, W - 8, H - 8);
      rect(g, doorX - 3, oy + 10, 6, H - 13, PX.red); rect(g, doorX - 2, oy + 10, 1, H - 13, PX.redDark); // carpet
      rect(g, ox + 8, oy + 18, W - 16, 4, PX.table); rect(g, ox + 8, oy + 18, W - 16, 1, PX.tableHi); // long table
      for (let i = 0; i < 9; i++) { dot(g, ox + 10 + i * 3, oy + 16, PX.floorDark); dot(g, ox + 10 + i * 3, oy + 23, PX.floorDark); }
      rect(g, doorX - 3, oy + 5, 6, 4, PX.gold); rect(g, doorX - 2, oy + 6, 4, 2, '#c99a30'); // throne
      for (const bx of [ox + 6, ox + W - 9]) { rect(g, bx, oy + 4, 3, 6, PX.red); dot(g, bx + 1, oy + 6, PX.gold); } // banners
      for (const [bx, by] of [[ox + 7, oy + H - 9], [ox + W - 8, oy + H - 9]]) barrel(g, bx, by);
      // stone pillars, side benches, potted plants and rugs
      for (const [px2, py2] of [[11, 11], [W - 13, 11], [11, 31], [W - 13, 31]]) { rect(g, ox + px2, oy + py2, 3, 3, PX.stoneDark); rect(g, ox + px2, oy + py2, 3, 1, PX.stoneHi); }
      for (let i = 0; i < 3; i++) { rect(g, ox + 5, oy + 27 + i * 4, 2, 3, PX.table); rect(g, ox + W - 7, oy + 27 + i * 4, 2, 3, PX.table); }
      for (const [px2, py2] of [[5, 12], [W - 7, 12]]) { rect(g, ox + px2, oy + py2, 2, 2, '#8a5c36'); dot(g, ox + px2, oy + py2 - 1, PX.crops[0]); dot(g, ox + px2 + 1, oy + py2 - 1, PX.crops[2]); }
      for (const rx of [ox + 14, ox + W - 21]) { rect(g, rx, oy + 26, 7, 5, '#3f5a8a'); rect(g, rx + 1, oy + 27, 5, 3, '#5a78aa'); }
      if ((o.level ?? 1) >= 3) for (const bx of [ox + 14, ox + W - 16]) rect(g, bx, oy + 4, 2, 2, PX.gold);
      return;
    }
    case 'house': case 'longhouse': case 'manor': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.woodWall, PX.woodWallHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, PX.floor, PX.floorLine);
      const slots = bedSlots(kind);
      const bw = kind === 'manor' ? 3 : 4, bh = kind === 'manor' ? 5 : 6;
      slots.forEach((p, i) => bed(g, ox + p.x - Math.floor(bw / 2), oy + p.y - 3, bw, bh, i + (kind.length)));
      // hearth and table near the door
      const hy = oy + H - 9;
      rect(g, ox + 4, hy, 5, 5, PX.stoneDark); rect(g, ox + 5, hy + 1, 3, 3, '#d9762a'); dot(g, ox + 6, hy + 2, '#f2c14e');
      rect(g, ox + W - 13, hy, 8, 4, PX.table); rect(g, ox + W - 13, hy, 8, 1, PX.tableHi);
      if (kind === 'manor') { rect(g, doorX - 4, oy + H - 16, 8, 12, '#7a3a5a'); rect(g, doorX - 3, oy + H - 15, 6, 10, '#9a4a72'); }
      return;
    }
    case 'barracks': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.stone, PX.stoneHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, PX.floorDark, '#6a4c30');
      bedSlots('barracks').forEach((p, i) => { bed(g, ox + p.x - 1, oy + p.y - 3, 3, 5, 0); if (i % 2) rect(g, ox + p.x - 1, oy + p.y - 1, 3, 1, PX.redDark); });
      for (let i = 0; i < 4; i++) rect(g, ox + W - 10 + i * 2, oy + H - 8, 1, 4, PX.steel); // weapon rack
      rect(g, ox + W - 11, oy + H - 5, 8, 1, PX.table);
      rect(g, ox + 4, oy + H - 8, 3, 4, PX.red); dot(g, ox + 5, oy + H - 7, PX.gold);
      return;
    }
    case 'tavern': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.woodWall, PX.woodWallHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, '#8a6440', '#76552f');
      rect(g, ox + 4, oy + 4, W - 8, 3, PX.table); rect(g, ox + 4, oy + 4, W - 8, 1, PX.tableHi); // bar counter
      for (let i = 0; i < 4; i++) barrel(g, ox + 6 + i * 6, oy + 9);
      for (const [tx, ty] of [[6, 15], [18, 15], [6, 22], [18, 22]]) {
        rect(g, ox + tx, oy + ty, 6, 4, '#5a3a22'); dot(g, ox + tx + 1, oy + ty + 1, PX.gold); dot(g, ox + tx + 4, oy + ty + 2, PX.gold);
        dot(g, ox + tx - 1, oy + ty + 1, PX.table); dot(g, ox + tx + 6, oy + ty + 2, PX.table);
      }
      return;
    }
    case 'chapel': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, '#8a8478', '#a59e90');
      rect(g, ox + 3, oy + 3, W - 6, H - 6, '#c8bfa8');
      rect(g, doorX - 2, oy + 9, 4, H - 12, '#b8a888'); // aisle
      for (let r = 0; r < 4; r++) { rect(g, ox + 5, oy + 11 + r * 4, 9, 2, PX.table); rect(g, ox + W - 14, oy + 11 + r * 4, 9, 2, PX.table); } // pews
      rect(g, doorX - 5, oy + 4, 10, 4, PX.cream); dot(g, doorX - 4, oy + 4, PX.gold); dot(g, doorX + 3, oy + 4, PX.gold); // altar + candles
      for (const [wx, wy, c] of [[ox + 1, oy + 10, '#4a7ac8'], [ox + 1, oy + 18, '#c84a4a'], [ox + W - 2, oy + 10, '#e8c84a'], [ox + W - 2, oy + 18, '#4a7ac8']] as [number, number, string][]) rect(g, wx, wy, 1, 3, c);
      return;
    }
    case 'granary': {
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.woodWall, PX.woodWallHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, '#a78a5a', '#957a4c');
      const n = Math.round((o.fill ?? 0.5) * 12);
      for (let i = 0; i < n; i++) { const sx = ox + 4 + (i % 2) * 4, sy = oy + 4 + Math.floor(i / 2) * 4; rect(g, sx, sy, 3, 3, '#d9c08a'); dot(g, sx + 1, sy, '#b89c62'); }
      return;
    }
    case 'farm': {
      rect(g, ox + 1, oy + 1, W - 2, H - 2, PX.soil);
      for (let r = 0; r < 11; r++) {
        const y = oy + 3 + r * 4;
        rect(g, ox + 2, y + 2, W - 4, 1, PX.furrow);
        for (let k = 0; k < 21; k++) if ((k + r) % 2 === 0) dot(g, ox + 3 + k * 2, y + 1, PX.crops[(k * 7 + r) % 3]);
      }
      // fence posts
      for (let i = 0; i < W; i += 4) { dot(g, ox + i, oy, '#7a5434'); dot(g, ox + i, oy + H - 1, '#7a5434'); }
      for (let i = 0; i < H; i += 4) { dot(g, ox, oy + i, '#7a5434'); dot(g, ox + W - 1, oy + i, '#7a5434'); }
      rect(g, doorX - 3, oy + H - 1, 6, 1, PX.soil); // gate
      // scarecrow
      rect(g, ox + W - 8, oy + 5, 5, 1, '#7a5434'); rect(g, ox + W - 6, oy + 4, 1, 4, '#7a5434'); dot(g, ox + W - 6, oy + 3, '#e8c96a');
      return;
    }
    case 'lumberCamp': {
      disc(g, ox + W / 2, oy + H / 2, W / 2 - 1, PX.dirt);
      for (let i = 0; i < 30; i++) dot(g, ox + 4 + hash(i, 1) * (W - 8), oy + 4 + hash(i, 2) * (H - 8), PX.dirtDark);
      for (const [sx, sy] of [[7, 7], [24, 9], [9, 23]]) { disc(g, ox + sx, oy + sy, 2, '#6b4a30'); dot(g, ox + sx, oy + sy, '#c8a070'); }
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4 - r; k++) { const lx = ox + 15 + k * 3 + r, ly = oy + 22 - r * 3; disc(g, lx, ly, 1, '#8a5c36'); dot(g, lx, ly, '#d9b48a'); }
      rect(g, ox + 12, oy + 12, 4, 3, '#6b4a30'); rect(g, ox + 15, oy + 11, 3, 1, PX.steel); // chopping block + axe
      return;
    }
    case 'hunter': {
      // a clearing with a small lodge, a hide-drying rack, a campfire and antlers over the door
      disc(g, ox + W / 2, oy + H / 2, W / 2 - 1, PX.dirt);
      for (let i = 0; i < 24; i++) dot(g, ox + 4 + hash(i, 11) * (W - 8), oy + 4 + hash(i, 12) * (H - 8), PX.dirtDark);
      walls(g, ox + 3, oy + 3, 14, 12, ox + 10, PX.woodWall, PX.woodWallHi);
      rect(g, ox + 6, oy + 6, 3, 5, PX.bedFrame); rect(g, ox + 6, oy + 7, 3, 4, '#8a6a4a'); // fur bed
      rect(g, ox + 11, oy + 6, 3, 2, PX.table);
      dot(g, ox + 8, oy + 2, '#d9cdb0'); dot(g, ox + 12, oy + 2, '#d9cdb0'); dot(g, ox + 9, oy + 1, '#d9cdb0'); dot(g, ox + 11, oy + 1, '#d9cdb0'); // antlers
      // drying rack with hides
      rect(g, ox + 20, oy + 6, 1, 9, '#6b4a30'); rect(g, ox + 28, oy + 6, 1, 9, '#6b4a30'); rect(g, ox + 20, oy + 6, 9, 1, '#7a5434');
      rect(g, ox + 21, oy + 7, 3, 5, '#a8784a'); rect(g, ox + 25, oy + 7, 3, 6, '#8e5f38'); dot(g, ox + 22, oy + 9, '#c89868');
      // campfire ring (the fire itself flickers in the ambient layer)
      ring(g, ox + 10, oy + 23, 2, PX.stoneDark); dot(g, ox + 9, oy + 22, '#4a3320'); dot(g, ox + 11, oy + 24, '#4a3320');
      // a deer carcass on a spit and a bow by the door
      rect(g, ox + 16, oy + 21, 7, 3, '#8e5f38'); rect(g, ox + 15, oy + 22, 9, 1, '#5e4029'); dot(g, ox + 22, oy + 20, '#7a4d31');
      rect(g, ox + 25, oy + 20, 1, 5, '#8a6a42'); dot(g, ox + 26, oy + 19, '#8a6a42'); dot(g, ox + 26, oy + 25, '#8a6a42');
      return;
    }
    case 'well': {
      // stone ring with dark water, a wooden frame and a bucket, on a little patch of paving
      for (let i = 0; i < 12; i++) dot(g, ox + 2 + hash(i, 13) * (W - 4), oy + 2 + hash(i, 14) * (H - 4), PX.gravel[i % 4]);
      rect(g, ox + 4, oy + 6, 10, 10, 'rgba(0,0,0,.25)');
      disc(g, ox + 8, oy + 8, 5, PX.stone); disc(g, ox + 8, oy + 8, 4, PX.stoneHi); disc(g, ox + 8, oy + 8, 3, '#2a3f5a'); dot(g, ox + 7, oy + 7, '#4a6a8a');
      rect(g, ox + 2, oy + 2, 1, 9, '#6b4a30'); rect(g, ox + 13, oy + 2, 1, 9, '#6b4a30'); rect(g, ox + 2, oy + 2, 12, 1, '#7a5434');
      rect(g, ox + 8, oy + 3, 1, 3, '#c8b088'); rect(g, ox + 7, oy + 5, 3, 2, '#7a5434'); // rope + bucket
      return;
    }
    case 'market': {
      rect(g, ox + 1, oy + 1, W - 2, H - 2, '#b8a074');
      for (let i = 0; i < 40; i++) dot(g, ox + 2 + hash(i, 4) * (W - 4), oy + 2 + hash(i, 5) * (H - 4), PX.dirtDark);
      const stall = (sx: number, sy: number, w: number, goods: string) => {
        for (let i = 0; i < w; i++) rect(g, sx + i, sy, 1, 3, (i >> 1) % 2 ? PX.cream : PX.red); // awning edge
        rect(g, sx, sy + 3, w, 4, PX.table); rect(g, sx, sy + 3, w, 1, PX.tableHi);
        for (let i = 1; i < w - 1; i += 2) dot(g, sx + i, sy + 4, goods);
      };
      stall(ox + 3, oy + 3, 12, '#c84a3a'); stall(ox + 17, oy + 3, 12, '#e8c84a'); stall(ox + 3, oy + 15, 12, '#7ab84a');
      crate(g, ox + 19, oy + 16); crate(g, ox + 24, oy + 18); barrel(g, ox + 21, oy + 25);
      return;
    }
    case 'trainingGrounds': {
      rect(g, ox + 1, oy + 1, W - 2, H - 2, '#b39770');
      for (let i = 0; i < 70; i++) dot(g, ox + 2 + hash(i, 6) * (W - 4), oy + 2 + hash(i, 7) * (H - 4), i % 2 ? PX.dirtDark : PX.dirtLight);
      for (let i = 0; i < W; i += 3) { dot(g, ox + i, oy, '#7a5434'); dot(g, ox + i, oy + H - 1, '#7a5434'); }
      for (let i = 0; i < H; i += 3) { dot(g, ox, oy + i, '#7a5434'); dot(g, ox + W - 1, oy + i, '#7a5434'); }
      rect(g, doorX - 3, oy + H - 1, 6, 1, '#b39770');
      for (const [dx, dy] of [[8, 9], [20, 8], [9, 22]]) { rect(g, ox + dx - 3, oy + dy, 7, 1, '#7a5434'); rect(g, ox + dx - 1, oy + dy - 2, 3, 5, '#d9b862'); dot(g, ox + dx, oy + dy - 3, '#c9a452'); }
      for (const tx of [34, 41]) { disc(g, ox + tx, oy + 8, 3, '#f0ece0'); disc(g, ox + tx, oy + 8, 2, PX.red); dot(g, ox + tx, oy + 8, '#f0ece0'); }
      for (let i = 0; i < 5; i++) rect(g, ox + 33 + i * 2, oy + 36, 1, 5, PX.steel);
      rect(g, ox + 32, oy + 40, 11, 1, PX.table);
      return;
    }
    case 'palisade': {
      for (let i = 0; i < 4; i++) { disc(g, ox + 3 + i * 3, oy + 8, 1, '#8a5c36'); }
      return;
    }
    case 'stockpile': {
      // a packed-earth yard with a low fence and three marked bays (wood, stone, furniture)
      rect(g, ox + 1, oy + 1, W - 2, H - 2, '#a8916a');
      for (let i = 0; i < 60; i++) dot(g, ox + 2 + hash(i, 21) * (W - 4), oy + 2 + hash(i, 22) * (H - 4), i % 2 ? PX.dirtDark : PX.dirtLight);
      for (let i = 0; i < W; i += 3) { dot(g, ox + i, oy, '#7a5434'); dot(g, ox + i, oy + H - 1, '#7a5434'); }
      for (let i = 0; i < H; i += 3) { dot(g, ox, oy + i, '#7a5434'); dot(g, ox + W - 1, oy + i, '#7a5434'); }
      rect(g, doorX - 4, oy + H - 1, 8, 1, '#a8916a'); // gate
      for (let k = 0; k < 3; k++) { // bay pallets
        const bx = ox + 3 + k * 15;
        rect(g, bx, oy + 3, 13, 33, 'rgba(0,0,0,.08)');
        for (let yy = oy + 4; yy < oy + 36; yy += 4) rect(g, bx, yy, 13, 1, 'rgba(90,60,30,.25)');
      }
      return;
    }
    case 'wrights': {
      // the builders' workshop: sawhorses, a plank stack, a ladder and tools
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.woodWall, PX.woodWallHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, '#9a7a52', '#86683f');
      for (let i = 0; i < 4; i++) rect(g, ox + 5, oy + 5 + i * 2, 12, 1, i % 2 ? PX.plankDark : PX.plank); // plank stack
      rect(g, ox + 20, oy + 6, 7, 1, '#6b4a30'); dot(g, ox + 20, oy + 7, '#6b4a30'); dot(g, ox + 26, oy + 7, '#6b4a30'); // sawhorse
      rect(g, ox + 21, oy + 5, 5, 1, PX.plank);
      for (let i = 0; i < 4; i++) rect(g, ox + 5 + i * 3, oy + 16, 1, 1, '#6b4a30'); rect(g, ox + 5, oy + 15, 10, 1, '#7a5434'); rect(g, ox + 5, oy + 17, 10, 1, '#7a5434'); // ladder
      rect(g, ox + 20, oy + 15, 4, 1, PX.steel); rect(g, ox + 22, oy + 16, 1, 3, '#6b4a30'); // hammer
      rect(g, ox + 24, oy + 20, 3, 2, PX.stoneDark); barrel(g, ox + 7, oy + 23);
      return;
    }
    case 'quarry': {
      // a stepped pit cut into the rock, cut blocks, a wooden lifting frame and a pick
      rect(g, ox + 2, oy + 2, W - 4, H - 4, '#77726a');
      rect(g, ox + 5, oy + 5, W - 10, H - 10, '#66625b');
      rect(g, ox + 8, oy + 8, W - 16, H - 16, '#57534d');
      rect(g, ox + 2, oy + 2, W - 4, 1, PX.rock[3]); rect(g, ox + 5, oy + 5, W - 10, 1, '#8a857a'); rect(g, ox + 8, oy + 8, W - 16, 1, '#77726a');
      rect(g, doorX - 2, oy + H - 6, 4, 4, '#77726a'); // ramp out of the pit
      for (const [bx, by] of [[3, 24], [7, 25], [24, 3]]) { rect(g, ox + bx, oy + by, 4, 3, '#c8c2b4'); rect(g, ox + bx, oy + by, 4, 1, '#e0dbcf'); }
      rect(g, ox + 23, oy + 20, 1, 8, '#6b4a30'); rect(g, ox + 28, oy + 20, 1, 8, '#6b4a30'); rect(g, ox + 23, oy + 20, 6, 1, '#7a5434'); dot(g, ox + 25, oy + 22, '#c8b088'); // frame + rope
      rect(g, ox + 12, oy + 13, 5, 1, PX.steel); rect(g, ox + 14, oy + 14, 1, 3, '#6b4a30'); // pick
      return;
    }
    case 'carpenter': {
      // a workshop: a long bench, a lathe, shavings, and a finished chair and table
      walls(g, ox + 1, oy + 1, W - 2, H - 2, doorX, PX.woodWall, PX.woodWallHi);
      planks(g, ox + 3, oy + 3, W - 6, H - 6, PX.floor, PX.floorLine);
      rect(g, ox + 4, oy + 4, W - 8, 3, PX.table); rect(g, ox + 4, oy + 4, W - 8, 1, PX.tableHi); // bench
      rect(g, ox + 7, oy + 5, 3, 1, PX.steel); rect(g, ox + 15, oy + 5, 4, 1, PX.plank);
      for (let i = 0; i < 14; i++) dot(g, ox + 5 + hash(i, 31) * (W - 10), oy + 9 + hash(i, 32) * 8, '#d9b48a'); // shavings
      rect(g, ox + 22, oy + 11, 4, 3, PX.plank); dot(g, ox + 22, oy + 14, PX.plankDark); dot(g, ox + 25, oy + 14, PX.plankDark); // table
      rect(g, ox + 18, oy + 12, 2, 2, PX.plank); rect(g, ox + 18, oy + 10, 1, 2, PX.plank); // chair
      return;
    }
  }
}

/** A building site: cleared ground, corner stakes and a string line (the building itself rises on top, drawn live). */
export function paintSite(g: G, kind: BuildingKind, ox: number, oy: number) {
  const d = CONFIG.buildings[kind];
  const W = d.w * R, H = d.h * R;
  rect(g, ox + 1, oy + 1, W - 2, H - 2, '#9c8460');
  for (let i = 0; i < W * H / 14; i++) dot(g, ox + 2 + hash(i, 41, W) * (W - 4), oy + 2 + hash(i, 42, H) * (H - 4), i % 3 ? PX.dirtDark : PX.dirtLight);
  for (let i = 1; i < W - 1; i += 2) { dot(g, ox + i, oy + 1, '#e8dcc0'); dot(g, ox + i, oy + H - 2, '#e8dcc0'); }
  for (let i = 1; i < H - 1; i += 2) { dot(g, ox + 1, oy + i, '#e8dcc0'); dot(g, ox + W - 2, oy + i, '#e8dcc0'); }
  for (const [sx, sy] of [[0, 0], [W - 2, 0], [0, H - 2], [W - 2, H - 2]]) rect(g, ox + sx, oy + sy, 2, 2, '#6b4a30');
}

/** Buildings + trees (everything static that sits above the ground and roads). */
export function paintWorld(s: GameState, cv: HTMLCanvasElement) {
  if (cv.width !== s.w * R) { cv.width = s.w * R; cv.height = s.h * R; }
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  for (const b of s.buildings) {
    const d = CONFIG.buildings[b.kind];
    if (b.site && !b.site.upgrade) { paintSite(g, b.kind, b.x * R, b.y * R); continue; }
    paintBuilding(g, b.kind, b.x * R, b.y * R, { fill: d.foodStorage ? b.food / d.foodStorage : 0, level: s.hallLevel });
  }
  // boulders on stone deposits
  for (let ty = 0; ty < s.h; ty++) for (let tx = 0; tx < s.w; tx++) {
    const i = ty * s.w + tx;
    if (s.tiles[i] !== STONE || s.occ[i] >= 0) continue;
    const n = hash(tx, ty, s.seed + 90) < 0.55 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const bx = tx * R + 4 + hash(tx, ty, s.seed + 91 + k) * (R - 8), by = ty * R + 4 + hash(tx, ty, s.seed + 93 + k) * (R - 8);
      const r = 2 + Math.floor(hash(tx, ty, s.seed + 95 + k) * 2.5);
      disc(g, bx + 1, by + 1, r, 'rgba(30,25,20,.3)');
      disc(g, bx, by, r, PX.boulderDark); disc(g, bx - 0.5, by - 0.5, r - 1, PX.boulder);
      dot(g, bx - r + 1, by - r + 1 + (r > 2 ? 1 : 0), PX.boulderHi); dot(g, bx - 1, by - 1, PX.boulderHi);
    }
  }
  // trees: canopies of dithered greens, darker shadow to the lower right
  const trees: { x: number; y: number; r: number; k: number }[] = [];
  for (let ty = 0; ty < s.h; ty++) for (let tx = 0; tx < s.w; tx++) {
    const i = ty * s.w + tx;
    if (s.tiles[i] !== FOREST || s.occ[i] >= 0) continue;
    const n = 2 + (hash(tx, ty, s.seed + 60) < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) trees.push({
      x: tx * R + 3 + hash(tx, ty, s.seed + 61 + k) * (R - 6),
      y: ty * R + 3 + hash(tx, ty, s.seed + 71 + k) * (R - 6),
      r: 4 + Math.floor(hash(tx, ty, s.seed + 81 + k) * 3), k: tx * 7 + ty * 13 + k,
    });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const t of trees) disc(g, t.x + 2, t.y + 2, t.r, PX.trunkShadow);
  for (const t of trees) {
    disc(g, t.x, t.y, t.r, PX.leaf[0]);
    disc(g, t.x - 1, t.y - 1, t.r - 1, PX.leaf[1]);
    disc(g, t.x - 2, t.y - 2, Math.max(1, t.r - 3), PX.leaf[2]);
    for (let i = 0; i < 4; i++) dot(g, t.x - t.r + 1 + hash(t.k, i) * t.r * 1.6, t.y - t.r + 1 + hash(t.k, i + 9) * t.r * 1.4, i % 2 ? PX.leaf[3] : PX.leaf[0]);
  }
}

/** A building's picture on its own (build-menu cards, the placement ghost). */
const solo = new Map<string, HTMLCanvasElement>();
export function buildingCanvas(kind: BuildingKind): HTMLCanvasElement {
  let cv = solo.get(kind);
  if (cv) return cv;
  const d = CONFIG.buildings[kind];
  cv = document.createElement('canvas');
  cv.width = d.w * R + 2; cv.height = d.h * R + 2;
  paintBuilding(cv.getContext('2d')!, kind, 0, 0, { fill: 0.6, level: 1 });
  solo.set(kind, cv);
  return cv;
}

// ---------- people ----------
// Taller figures (owner's pick): 3 wide x 5 tall, seen from the front.
// Letters: h hair, s skin, T tunic, l legs, g helmet, R red uniform, S shield, w sword,
// p spear tip, | spear shaft, H green hood, b bow, q quiver, n/N horse, m horse head.
/** The same picture three times as big. */
const big3 = (rows: string[]) => rows.flatMap(r => { const w = [...r].map(ch => ch.repeat(3)).join(''); return [w, w, w]; });
export const SPRITES: Record<string, string[]> = {
  civ: ['.h.', '.s.', 'TTT', '.T.', 'l.l'],
  swordsmen: ['.g.', '.s.', 'SRw', 'SRw', 'l.l'],
  heavy: ['.G.', '.s.', 'SKw', 'SRw', 'L.L'],
  boss: big3(['.G.', '.s.', 'SKw', 'SRw', 'L.L']),
  spearmen: ['..p', '.g|', '.s|', 'RR|', '.R|', 'l.l'],
  archers: ['.H.', '.s.', 'bRq', 'bR.', 'l.l'],
  cavalry: ['.g...', '.s...', 'RRR..', 'nnnnm', 'nnnn.', 'N..N.'],
};
export const SP_COL: Record<string, string> = {
  l: '#3e3028', g: '#b4bcc8', R: '#c0392b', S: '#8a6440', w: '#e6eaf0', p: '#d0d6de', '|': '#7a5434',
  G: '#6d7685', K: '#575e6b', L: '#4a4f5a', H: '#4f8a3a', b: '#8a5c36', q: '#6b4a30', n: '#8a5a3a', N: '#5a3824', m: '#3e2a1c',
};

/**
 * Draw one tiny villager in screen space. (ax, ay) = art pixel of their feet,
 * p = screen pixels per art pixel, (ox, oy) = screen position of art pixel 0,0.
 */
export function drawPawn(c: CanvasRenderingContext2D, v: Villager, ax: number, ay: number, p: number, ox: number, oy: number, walking: boolean) {
  const P = (x: number, y: number, col: string) => {
    c.fillStyle = col;
    const sx = Math.round(ox + (ax + x) * p), sy = Math.round(oy + (ay + y) * p);
    c.fillRect(sx, sy, Math.round(ox + (ax + x + 1) * p) - sx, Math.round(oy + (ay + y + 1) * p) - sy);
  };
  const sp = SPRITES[v.unit ?? 'civ'];
  const h = sp.length, w = sp[0].length;
  const flip = Math.cos(v.dir ?? 0) < -0.2;                 // face left when walking left
  const frame = walking ? Math.floor(v.step / 2) % 2 : -1;  // legs alternate when walking
  const x0 = -Math.floor(w / 2), y0 = -h + 1;
  for (let i = 1; i < w; i++) P(x0 + i, 1, 'rgba(0,0,0,.22)'); // shadow
  for (let r = 0; r < h; r++) {
    let row = sp[r];
    if (r === h - 1 && frame >= 0 && v.unit !== 'boss') row = v.unit === 'cavalry' ? (frame ? '.N.N.' : 'N..N.') : (frame ? 'l..' : '..l');
    for (let i = 0; i < w; i++) {
      const ch = row[flip ? w - 1 - i : i];
      if (ch === '.') continue;
      const col = ch === 'h' ? PX.hair[v.look.hair] : ch === 's' ? PX.skin[v.look.skin] : ch === 'T' ? PX.tunics[v.look.tunic] : SP_COL[ch];
      P(x0 + i, y0 + r, col);
    }
  }
  // carried goods, at the hand
  const hx = flip ? x0 - 1 : x0 + w;
  if (v.carry === 'basket') { P(hx, -2, '#a07840'); P(hx, -3, PX.crops[0]); }
  else if (v.carry === 'logs' || v.carry === 'wood') { P(hx, -3, '#8a5c36'); P(hx, -2, '#8a5c36'); P(hx + (flip ? -1 : 1), -3, '#d9b48a'); }
  else if (v.carry === 'stone') { P(hx, -3, '#c8c2b4'); P(hx, -2, '#9a958a'); P(hx + (flip ? -1 : 1), -2, '#9a958a'); }
  else if (v.carry === 'furniture') { P(hx, -4, PX.plank); P(hx, -3, PX.plank); P(hx + (flip ? -1 : 1), -3, PX.plank); P(hx + (flip ? -1 : 1), -2, PX.plankDark); }
  else if (v.carry === 'coins') P(hx, -2, PX.gold);
}
