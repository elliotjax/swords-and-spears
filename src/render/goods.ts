import type { Good } from '../config';
import { amountOf, siteMaterials, siteNeed, siteProgress } from '../sim/logistics';
import type { Building, GameState } from '../sim/types';
import { buildingCanvas, PX, R } from './pixel';

// =====================================================================
//  Goods you can see: piles in the stockpile bays, goods waiting on work
//  buildings' shelves, and building sites rising as the wrights work.
//  Drawn live every frame (cheap little rectangles), on top of the world.
// =====================================================================

type P = (ax: number, ay: number, col: string, w?: number, h?: number) => void;

/** One stacked item of a good at art pixel (x, y). */
function item(P: P, g: Good, x: number, y: number, k: number) {
  if (g === 'wood') { P(x, y, '#8a5c36', 4, 2); P(x, y, '#a8784a', 4, 1); P(x + 3, y, '#d9b48a', 1, 2); }
  else if (g === 'stone') { P(x, y, '#9a958a', 3, 2); P(x, y, '#c8c2b4', 3, 1); if (k % 3 === 0) P(x + 2, y + 1, '#77726a'); }
  else { // furniture: chairs, stools and little tables
    if (k % 3 === 0) { P(x, y, PX.plank, 3, 1); P(x, y + 1, PX.plankDark); P(x + 2, y + 1, PX.plankDark); }
    else if (k % 3 === 1) { P(x, y, PX.plank, 2, 2); P(x, y - 1, PX.plankDark, 1, 1); }
    else { P(x, y, '#c49a68', 3, 2); P(x + 1, y + 1, PX.plankDark); }
  }
}

/** A neat pile: `n` items in a grid filling a box from the bottom up. */
function pile(P: P, g: Good, n: number, x: number, y: number, cols: number, rows: number) {
  const cw = 4, ch = g === 'wood' ? 2 : 3;
  n = Math.min(n, cols * rows);
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    item(P, g, x + c * cw + (r % 2) * (g === 'wood' ? 1 : 0), y + (rows - 1 - r) * ch, i);
  }
}

export function drawGoods(c: CanvasRenderingContext2D, s: GameState, ox: number, oy: number, p: number, view: { x0: number; y0: number; x1: number; y1: number }, t: number) {
  const P: P = (ax, ay, col, w = 1, h = 1) => {
    const sx = Math.round(ox + ax * p), sy = Math.round(oy + ay * p);
    c.fillStyle = col; c.fillRect(sx, sy, Math.round(ox + (ax + w) * p) - sx, Math.round(oy + (ay + h) * p) - sy);
  };
  const inView = (b: Building) => {
    const x0 = b.x * R, y0 = b.y * R;
    return x0 + b.w * R > view.x0 - 8 && x0 < view.x1 + 8 && y0 + b.h * R > view.y0 - 8 && y0 < view.y1 + 8;
  };
  for (const b of s.buildings) {
    if (!inView(b)) continue;
    const bx = b.x * R, by = b.y * R, W = b.w * R, H = b.h * R;
    if (b.site && !b.site.upgrade) { drawSite(c, s, b, P, ox, oy, p, t); continue; }
    if (b.site?.upgrade) { scaffold(P, bx, by, W, H, 1); sitePiles(s, b, P, bx, by, W, H); continue; }
    switch (b.kind) {
      case 'stockpile': {
        // three bays: wood, stone, furniture (each item is several units)
        pile(P, 'wood', Math.ceil(amountOf(b, 'wood') / 10), bx + 3, by + 4, 3, 16);
        pile(P, 'stone', Math.ceil(amountOf(b, 'stone') / 10), bx + 18, by + 3, 3, 11);
        pile(P, 'furniture', Math.ceil(amountOf(b, 'furniture') / 2), bx + 33, by + 3, 3, 11);
        break;
      }
      case 'lumberCamp': pile(P, 'wood', Math.ceil(amountOf(b, 'wood') / 5), bx + 20, by + 22, 2, 6); break;
      case 'quarry': pile(P, 'stone', Math.ceil(amountOf(b, 'stone') / 4), bx + 12, by + 22, 3, 3); break;
      case 'carpenter':
        pile(P, 'wood', Math.ceil(amountOf(b, 'wood') / 8), bx + 4, by + 20, 2, 4);
        pile(P, 'furniture', Math.ceil(amountOf(b, 'furniture')), bx + 14, by + 19, 3, 4);
        break;
    }
  }
}

/** Wooden scaffolding poles around a building (or the part of it built so far). */
function scaffold(P: P, x: number, y: number, W: number, H: number, upTo: number) {
  const top = y + H * (1 - upTo);
  for (const px of [x + 1, x + W - 2]) P(px, top, '#7a5434', 1, y + H - top);
  for (let yy = y + H - 4; yy >= top; yy -= 6) P(x + 1, yy, '#8a6440', W - 2, 1);
}

/** Materials waiting at a site (they get used up as the wrights build). */
function sitePiles(s: GameState, b: Building, P: P, x: number, y: number, W: number, H: number) {
  const prog = siteProgress(s, b);
  let cx = x + 2;
  for (const g of ['wood', 'stone', 'furniture'] as Good[]) {
    const left = amountOf(b, g) * (1 - prog);
    if (left < 0.5 || !siteNeed(s, b, g)) continue;
    const n = Math.ceil(left / (g === 'furniture' ? 1 : 8));
    pile(P, g, n, cx, y + H - 9, 2, 2);
    cx += 10;
    if (cx > x + W - 8) break;
  }
}

function drawSite(c: CanvasRenderingContext2D, s: GameState, b: Building, P: P, ox: number, oy: number, p: number, t: number) {
  const bx = b.x * R, by = b.y * R, W = b.w * R, H = b.h * R;
  const prog = siteProgress(s, b);
  // the building rises from the front edge as the work is done
  if (prog > 0.01) {
    const pic = buildingCanvas(b.kind);
    const rows = Math.max(1, Math.round(H * prog));
    c.imageSmoothingEnabled = false;
    c.drawImage(pic, 0, H - rows, W, rows, ox + bx * p, oy + (by + H - rows) * p, W * p, rows * p);
    scaffold(P, bx, by, W, H, prog);
  }
  sitePiles(s, b, P, bx, by, W, H);
  // waiting for materials: a small flag on a stake
  if (siteMaterials(s, b) < 0.999 && prog >= siteMaterials(s, b) - 0.01) {
    const f = Math.floor(t * 3) % 2;
    P(bx + W - 4, by + 2, '#6b4a30', 1, 6); P(bx + W - 3, by + 2, '#d9a21e', 3 + f, 2);
  }
}
