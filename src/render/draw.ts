import type { BuildingKind } from '../config';
import { DOORS } from '../sim/doors';
import { hash } from '../sim/rng';
import type { Villager } from '../sim/types';
import { PAL } from './palette';

// All drawing here is in TILE units (1 = one tile). The caller sets the transform.
type C = CanvasRenderingContext2D;
export const LW = 0.026; // outline width (about 1.6 px at default zoom)

export function rr(c: C, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function stroke(c: C, color = PAL.outline, w = LW) {
  c.lineWidth = w; c.strokeStyle = color; c.stroke();
}

function shadowRect(c: C, x: number, y: number, w: number, h: number, r = 0.04) {
  c.fillStyle = PAL.shadow;
  rr(c, x + 0.1, y + 0.12, w, h, r);
  c.fill();
}

function circle(c: C, x: number, y: number, r: number, fill: string, line?: string, lw = LW) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill; c.fill();
  if (line) stroke(c, line, lw);
}

function barrel(c: C, x: number, y: number, r = 0.1) {
  c.fillStyle = PAL.shadow; c.beginPath(); c.arc(x + 0.04, y + 0.05, r, 0, 7); c.fill();
  circle(c, x, y, r, PAL.wood, PAL.outline);
  c.beginPath(); c.arc(x, y, r * 0.62, 0, 7); stroke(c, PAL.woodDark, LW * 0.8);
  circle(c, x - r * 0.25, y - r * 0.25, r * 0.18, '#d4a271');
}

function crate(c: C, x: number, y: number, s = 0.2) {
  c.fillStyle = PAL.shadow; c.fillRect(x + 0.04, y + 0.05, s, s);
  c.fillStyle = '#c99260'; c.fillRect(x, y, s, s);
  c.beginPath(); c.rect(x, y, s, s); stroke(c);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + s, y + s); c.moveTo(x + s, y); c.lineTo(x, y + s);
  stroke(c, PAL.woodDark, LW * 0.7);
}

export function smoke(c: C, x: number, y: number, t: number, seed: number) {
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.35 + i / 3 + hash(seed) ) % 1;
    c.fillStyle = `rgba(255,255,255,${0.42 * (1 - p)})`;
    c.beginPath();
    c.arc(x + p * 0.35 + Math.sin(p * 6 + seed) * 0.03, y - p * 0.45, 0.05 + p * 0.11, 0, 7);
    c.fill();
  }
}

function chimney(c: C, x: number, y: number) {
  const s = 0.16;
  c.fillStyle = PAL.shadow; c.fillRect(x - s / 2 + 0.04, y - s / 2 + 0.05, s, s);
  c.fillStyle = PAL.stone; c.fillRect(x - s / 2, y - s / 2, s, s);
  c.beginPath(); c.rect(x - s / 2, y - s / 2, s, s); stroke(c);
  c.fillStyle = PAL.outline; c.fillRect(x - s / 4.5, y - s / 4.5, s / 2.25, s / 2.25);
}

/** Roof seen from above with a ridge. vertical=true: ridge runs top-bottom. */
function roof(c: C, x: number, y: number, w: number, h: number, vertical: boolean,
  lit = PAL.roofLit, shade = PAL.roofShade, hi = PAL.roofHi) {
  shadowRect(c, x, y, w, h);
  if (vertical) {
    const m = x + w * 0.5;
    c.fillStyle = lit; c.fillRect(x, y, m - x, h);
    c.fillStyle = shade; c.fillRect(m, y, x + w - m, h);
    // shingle lines
    c.strokeStyle = 'rgba(80,20,20,.16)'; c.lineWidth = LW * 0.8;
    c.beginPath();
    for (let yy = y + 0.1; yy < y + h - 0.02; yy += 0.1) { c.moveTo(x, yy); c.lineTo(x + w, yy); }
    c.stroke();
    c.fillStyle = hi; c.fillRect(m - 0.04, y, 0.05, h);
  } else {
    const m = y + h * 0.5;
    c.fillStyle = lit; c.fillRect(x, y, w, m - y);
    c.fillStyle = shade; c.fillRect(x, m, w, y + h - m);
    c.strokeStyle = 'rgba(80,20,20,.16)'; c.lineWidth = LW * 0.8;
    c.beginPath();
    for (let xx = x + 0.1; xx < x + w - 0.02; xx += 0.1) { c.moveTo(xx, y); c.lineTo(xx, y + h); }
    c.stroke();
    c.fillStyle = hi; c.fillRect(x, m - 0.04, w, 0.05);
  }
  c.beginPath(); c.rect(x, y, w, h); stroke(c);
}

/** A front door with a stone step; (x, y) is the doorway point villagers walk into. */
function doorway(c: C, x: number, y: number) {
  c.fillStyle = PAL.shadow; c.fillRect(x - 0.15, y + 0.01, 0.34, 0.11);
  c.fillStyle = PAL.stone; c.fillRect(x - 0.17, y - 0.02, 0.34, 0.1);
  c.beginPath(); c.rect(x - 0.17, y - 0.02, 0.34, 0.1); stroke(c, PAL.outline, LW * 0.8);
  c.fillStyle = '#6b4a35'; c.fillRect(x - 0.1, y - 0.12, 0.2, 0.1);
  c.beginPath(); c.rect(x - 0.1, y - 0.12, 0.2, 0.1); stroke(c, PAL.outline, LW * 0.8);
}

// ---------- buildings ----------

export interface DrawOpts { t: number; level?: number; seed?: number; occupied?: boolean }

export function drawBuilding(c: C, kind: BuildingKind, x: number, y: number, w: number, h: number, o: DrawOpts) {
  const seed = o.seed ?? 1;
  switch (kind) {
    case 'townHall': return townHall(c, x, y, o);
    case 'hut': return hut(c, x, y, o, seed);
    case 'house': {
      roof(c, x + 0.16, y + 0.12, w - 0.32, h - 0.42, true);
      chimney(c, x + w * 0.72, y + 0.42);
      smoke(c, x + w * 0.72, y + 0.36, o.t, seed);
      doorway(c, x + DOORS.house.x, y + DOORS.house.y);
      barrel(c, x + 0.3, y + h - 0.18);
      if (hash(seed, 3) > 0.5) crate(c, x + w - 0.42, y + h - 0.3, 0.18);
      return;
    }
    case 'cottage': {
      roof(c, x + 0.12, y + 0.12, 1.25, h - 0.4, true);
      chimney(c, x + 0.95, y + 0.4);
      smoke(c, x + 0.95, y + 0.34, o.t, seed);
      // little garden
      c.fillStyle = PAL.soil; rr(c, x + 1.47, y + 0.2, 0.42, 1.2, 0.05); c.fill(); stroke(c, PAL.woodDark);
      for (let i = 0; i < 4; i++) circle(c, x + 1.68, y + 0.38 + i * 0.27, 0.07, i % 2 ? PAL.crop : PAL.crop2);
      doorway(c, x + DOORS.cottage.x, y + DOORS.cottage.y);
      barrel(c, x + 0.25, y + h - 0.16);
      return;
    }
    case 'longhouse': {
      roof(c, x + 0.12, y + 0.15, w - 0.24, h - 0.5, false);
      chimney(c, x + 0.8, y + 0.55); chimney(c, x + w - 0.8, y + 0.55);
      smoke(c, x + 0.8, y + 0.5, o.t, seed); smoke(c, x + w - 0.8, y + 0.5, o.t + 0.5, seed + 1);
      doorway(c, x + DOORS.longhouse.x, y + DOORS.longhouse.y);
      barrel(c, x + 0.3, y + h - 0.18); crate(c, x + w - 0.5, y + h - 0.3, 0.2);
      return;
    }
    case 'manor': {
      roof(c, x + 0.15, y + 0.15, w - 0.3, 1.5, false);
      roof(c, x + 0.15, y + 1.55, 1.2, 1.1, true);
      chimney(c, x + 2.2, y + 0.55); smoke(c, x + 2.2, y + 0.5, o.t, seed);
      c.fillStyle = PAL.stone; rr(c, x + 1.55, y + 1.85, 1.2, 0.85, 0.08); c.fill(); stroke(c);
      c.fillStyle = '#e8e2d4';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
        c.fillRect(x + 1.68 + i * 0.36, y + 1.98 + j * 0.36, 0.22, 0.2);
      circle(c, x + 2.15, y + 2.27, 0.14, PAL.crop, PAL.outline);
      doorway(c, x + DOORS.manor.x, y + DOORS.manor.y);
      return;
    }
    case 'farm': return farm(c, x, y, w, h, o, seed);
    case 'granary': return granary(c, x, y, o);
    case 'lumberCamp': return lumberCamp(c, x, y, w, h, o, seed);
    case 'market': return market(c, x, y, w, h);
    case 'barracks': {
      roof(c, x + 0.15, y + 0.15, w - 0.3, h - 0.45, false, PAL.slateLit, PAL.slateShade, '#9aa8c8');
      c.fillStyle = PAL.banner; c.fillRect(x + w / 2 - 0.15, y + h - 0.42, 0.3, 0.2);
      return;
    }
    case 'palisade': {
      for (let i = 0; i < 4; i++) {
        circle(c, x + 0.2 + i * 0.2, y + 0.5, 0.11, PAL.wood, PAL.outline);
        circle(c, x + 0.2 + i * 0.2, y + 0.5, 0.05, '#d4a271');
      }
      return;
    }
  }
}

function townHall(c: C, x: number, y: number, o: DrawOpts) {
  const lv = o.level ?? 1;
  // front wall with door and banners
  shadowRect(c, x + 0.25, y + 2.2, 2.5, 0.55);
  c.fillStyle = PAL.wall; c.fillRect(x + 0.25, y + 2.2, 2.5, 0.52);
  c.beginPath(); c.rect(x + 0.25, y + 2.2, 2.5, 0.52); stroke(c);
  c.fillStyle = PAL.stone; c.fillRect(x + 1.2, y + 2.72, 0.6, 0.18);
  c.beginPath(); c.rect(x + 1.2, y + 2.72, 0.6, 0.18); stroke(c);
  c.fillStyle = '#6b4a35'; c.fillRect(x + 1.32, y + 2.4, 0.36, 0.32);
  // main roof
  roof(c, x + 0.16, y + 0.16, 2.68, 2.12, false);
  // banners
  for (const bx of [x + 0.5, x + 2.32]) {
    c.fillStyle = PAL.shadow; c.fillRect(bx + 0.04, y + 2.3, 0.18, 0.55);
    c.fillStyle = PAL.banner; c.beginPath();
    c.moveTo(bx, y + 2.26); c.lineTo(bx + 0.18, y + 2.26); c.lineTo(bx + 0.18, y + 2.8);
    c.lineTo(bx + 0.09, y + 2.72); c.lineTo(bx, y + 2.8); c.closePath(); c.fill(); stroke(c);
    if (lv >= 2) circle(c, bx + 0.09, y + 2.45, 0.04, PAL.gold);
  }
  // central tower with crenellations and a pyramid roof
  const tx = x + 0.92, ty = y + 0.3, ts = 1.16;
  c.fillStyle = PAL.shadow; c.fillRect(tx + 0.1, ty + 0.12, ts, ts);
  c.fillStyle = PAL.wall; c.fillRect(tx, ty, ts, ts);
  c.beginPath(); c.rect(tx, ty, ts, ts); stroke(c);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = PAL.stone; c.fillRect(tx + 0.02 + i * 0.195, ty - 0.1, 0.12, 0.12);
    c.beginPath(); c.rect(tx + 0.02 + i * 0.195, ty - 0.1, 0.12, 0.12); stroke(c, PAL.outline, LW * 0.7);
  }
  const ix = tx + 0.12, iy = ty + 0.12, is = ts - 0.24, cx = ix + is / 2, cy = iy + is / 2;
  const tri = (ax: number, ay: number, bx: number, by: number, col: string) => {
    c.fillStyle = col; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(cx, cy); c.closePath(); c.fill();
  };
  tri(ix, iy, ix + is, iy, PAL.roofHi);
  tri(ix, iy, ix, iy + is, PAL.roofLit);
  tri(ix + is, iy, ix + is, iy + is, PAL.roofShade);
  tri(ix, iy + is, ix + is, iy + is, '#b33d34');
  c.beginPath(); c.rect(ix, iy, is, is); stroke(c);
  c.beginPath(); c.moveTo(ix, iy); c.lineTo(ix + is, iy + is); c.moveTo(ix + is, iy); c.lineTo(ix, iy + is);
  stroke(c, 'rgba(58,51,66,.5)', LW * 0.7);
  // flag
  const wave = Math.sin(o.t * 4) * 0.05;
  c.fillStyle = PAL.banner; c.beginPath();
  c.moveTo(cx, cy); c.lineTo(cx + 0.55, cy - 0.12 + wave); c.lineTo(cx + 0.5, cy + 0.02 + wave * 0.6);
  c.closePath(); c.fill();
  circle(c, cx, cy, 0.06, PAL.gold, PAL.outline, LW * 0.7);
  if (lv >= 3) { barrel(c, x + 0.1, y + 2.85, 0.09); barrel(c, x + 2.9, y + 2.85, 0.09); }
}

function hut(c: C, x: number, y: number, o: DrawOpts, seed: number) {
  shadowRect(c, x + 0.15, y + 0.12, 0.7, 0.66, 0.2);
  c.fillStyle = '#e2c27a'; rr(c, x + 0.15, y + 0.12, 0.7, 0.66, 0.2); c.fill();
  c.save(); rr(c, x + 0.15, y + 0.12, 0.7, 0.66, 0.2); c.clip();
  c.fillStyle = '#c9a45c'; c.fillRect(x + 0.5, y, 0.5, 1);
  c.strokeStyle = 'rgba(120,80,30,.3)'; c.lineWidth = LW * 0.7; c.beginPath();
  for (let i = 0; i < 7; i++) { c.moveTo(x + 0.15, y + 0.18 + i * 0.09); c.lineTo(x + 0.85, y + 0.2 + i * 0.09); }
  c.stroke(); c.restore();
  c.fillStyle = '#f0d898'; c.fillRect(x + 0.47, y + 0.12, 0.05, 0.66);
  rr(c, x + 0.15, y + 0.12, 0.7, 0.66, 0.2); stroke(c);
  smoke(c, x + 0.5, y + 0.3, o.t, seed);
  doorway(c, x + DOORS.hut.x, y + DOORS.hut.y);
}

function farm(c: C, x: number, y: number, w: number, h: number, o: DrawOpts, seed: number) {
  const fx = x + 0.12, fy = y + 0.12, fw = w - 0.24, fh = h - 0.24;
  c.fillStyle = PAL.soil; c.fillRect(fx, fy, fw, fh);
  // furrows and crops
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const ry = fy + 0.25 + r * ((fh - 0.42) / (rows - 1));
    c.strokeStyle = PAL.furrow; c.lineWidth = 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(fx + 0.15, ry); c.lineTo(fx + fw - 0.15, ry); c.stroke();
    for (let k = 0; k < 10; k++) {
      const cx = fx + 0.22 + k * ((fw - 0.44) / 9);
      if (r === 0 && k > 7) continue; // scarecrow corner
      const sway = Math.sin(o.t * 2 + k * 0.7 + r) * 0.008;
      circle(c, cx + sway, ry, 0.065, (k + r) % 3 ? PAL.crop : PAL.crop2);
      circle(c, cx + sway - 0.02, ry - 0.02, 0.022, '#a6e08a');
    }
  }
  c.lineCap = 'butt';
  c.beginPath(); c.rect(fx, fy, fw, fh); stroke(c, '#6e4a2c');
  // fence posts and rails
  c.strokeStyle = PAL.wood; c.lineWidth = 0.035;
  c.beginPath(); c.rect(x + 0.06, y + 0.06, w - 0.12, h - 0.12); c.stroke();
  for (let i = 0; i <= w * 2; i++) {
    for (const py of [y + 0.06, y + h - 0.06]) circle(c, x + 0.06 + i * ((w - 0.12) / (w * 2)), py, 0.035, PAL.woodDark);
  }
  for (let i = 1; i < h * 2; i++) {
    for (const px of [x + 0.06, x + w - 0.06]) circle(c, px, y + 0.06 + i * ((h - 0.12) / (h * 2)), 0.035, PAL.woodDark);
  }
  // gate in the front fence
  const gx = x + DOORS.farm.x, gy = y + h - 0.06;
  c.fillStyle = '#c9a571'; c.fillRect(gx - 0.2, gy - 0.05, 0.4, 0.1);
  circle(c, gx - 0.22, gy, 0.05, PAL.woodDark, PAL.outline, LW * 0.6);
  circle(c, gx + 0.22, gy, 0.05, PAL.woodDark, PAL.outline, LW * 0.6);
  // scarecrow
  const sx = x + w - 0.42, sy = y + 0.38;
  c.strokeStyle = PAL.woodDark; c.lineWidth = 0.04;
  c.beginPath(); c.moveTo(sx - 0.18, sy); c.lineTo(sx + 0.18, sy); c.moveTo(sx, sy - 0.08); c.lineTo(sx, sy + 0.2); c.stroke();
  circle(c, sx, sy - 0.08, 0.07, '#e8c96a', PAL.outline, LW * 0.7);
  // hay bale
  if (hash(seed, 5) > 0.3) {
    c.fillStyle = PAL.shadow; rr(c, x + 0.24, y + h - 0.42, 0.34, 0.24, 0.06); c.fill();
    c.fillStyle = '#e8c96a'; rr(c, x + 0.2, y + h - 0.46, 0.34, 0.24, 0.06); c.fill(); stroke(c);
    c.beginPath(); c.moveTo(x + 0.31, y + h - 0.46); c.lineTo(x + 0.31, y + h - 0.22);
    c.moveTo(x + 0.43, y + h - 0.46); c.lineTo(x + 0.43, y + h - 0.22); stroke(c, '#b8963c', LW * 0.7);
  }
}

function granary(c: C, x: number, y: number, o: DrawOpts) {
  // a round thatched store on short stilts, seen from above
  const cx = x + 0.5, cy = y + 0.44, r = 0.34;
  c.fillStyle = PAL.shadow; c.beginPath(); c.arc(cx + 0.08, cy + 0.1, r, 0, 7); c.fill();
  for (const [dx, dy] of [[-0.24, 0.24], [0.24, 0.24]]) { // stilts peeking out at the front
    c.fillStyle = PAL.woodDark; c.fillRect(cx + dx - 0.03, cy + dy, 0.06, 0.1);
  }
  circle(c, cx, cy, r, '#e2c27a', PAL.outline);
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, 7); c.clip();
  c.fillStyle = '#c9a45c'; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, -0.6, 2.2); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(120,80,30,.35)'; c.lineWidth = LW * 0.7; c.beginPath();
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  c.stroke();
  c.beginPath(); c.arc(cx, cy, r * 0.62, 0, 7); stroke(c, 'rgba(120,80,30,.35)', LW * 0.7);
  c.restore();
  circle(c, cx, cy, 0.075, PAL.wood, PAL.outline, LW * 0.8);
  // grain sack by the door
  circle(c, x + 0.84, y + 0.8, 0.09, '#e6cf98', PAL.outline, LW * 0.7);
  circle(c, x + 0.84, y + 0.74, 0.03, PAL.crop2);
  doorway(c, x + DOORS.granary.x, y + DOORS.granary.y);
  void o;
}

function lumberCamp(c: C, x: number, y: number, w: number, h: number, o: DrawOpts, seed: number) {
  // clearing
  c.fillStyle = '#b8a070'; rr(c, x + 0.02, y + 0.04, w - 0.04, h - 0.06, 0.5); c.fill();
  c.fillStyle = PAL.dirt; rr(c, x + 0.08, y + 0.08, w - 0.16, h - 0.16, 0.45); c.fill();
  // stumps
  for (let i = 0; i < 4; i++) {
    const sx = x + 0.3 + hash(seed, i, 1) * (w - 0.6), sy = y + 0.3 + hash(seed, i, 2) * (h - 0.6);
    if (sx > x + 0.9 && sy > y + 0.9) continue;
    c.fillStyle = PAL.shadow; c.beginPath(); c.arc(sx + 0.03, sy + 0.04, 0.09, 0, 7); c.fill();
    circle(c, sx, sy, 0.09, PAL.woodDark, PAL.outline, LW * 0.8);
    circle(c, sx, sy, 0.055, '#d9b48a');
  }
  // lean-to shelter
  c.fillStyle = PAL.shadow; c.fillRect(x + 0.32, y + 0.28, 0.75, 0.5);
  c.fillStyle = PAL.wood; c.fillRect(x + 0.25, y + 0.22, 0.75, 0.5);
  c.strokeStyle = PAL.woodDark; c.lineWidth = LW * 0.8; c.beginPath();
  for (let i = 1; i < 5; i++) { c.moveTo(x + 0.25 + i * 0.15, y + 0.22); c.lineTo(x + 0.25 + i * 0.15, y + 0.72); }
  c.stroke();
  c.beginPath(); c.rect(x + 0.25, y + 0.22, 0.75, 0.5); stroke(c);
  // log pile (logs seen end-on)
  const lx = x + w - 0.95, ly = y + h - 0.7;
  c.fillStyle = PAL.shadow; rr(c, lx + 0.05, ly + 0.06, 0.72, 0.48, 0.1); c.fill();
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4 - r; k++) {
    const cx = lx + 0.1 + k * 0.17 + r * 0.085, cy = ly + 0.35 - r * 0.15;
    circle(c, cx, cy, 0.085, PAL.wood, PAL.outline, LW * 0.8);
    circle(c, cx, cy, 0.045, '#e3c093');
  }
  // chopping block with an axe
  const bx = x + 0.45, by = y + h - 0.45;
  circle(c, bx, by, 0.12, PAL.woodDark, PAL.outline);
  circle(c, bx, by, 0.07, '#d9b48a');
  c.strokeStyle = '#6b4a35'; c.lineWidth = 0.035; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + 0.22, by - 0.14); c.stroke();
  c.fillStyle = '#9aa3b2'; c.fillRect(bx - 0.04, by - 0.05, 0.08, 0.1);
  void o;
}

function market(c: C, x: number, y: number, w: number, h: number) {
  const stall = (sx: number, sy: number, sw: number, sh: number) => {
    shadowRect(c, sx, sy, sw, sh);
    const n = 5;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? PAL.wall : PAL.banner;
      c.fillRect(sx + (i * sw) / n, sy, sw / n, sh);
    }
    c.fillStyle = 'rgba(60,20,20,.18)'; c.fillRect(sx, sy + sh * 0.55, sw, sh * 0.45);
    c.beginPath(); c.rect(sx, sy, sw, sh); stroke(c);
    for (let i = 0; i <= n; i++) circle(c, sx + (i * sw) / n, sy + sh, 0.03, PAL.banner);
  };
  stall(x + 0.15, y + 0.15, w - 0.3, 0.62);
  stall(x + 0.15, y + 0.95, w * 0.55, 0.55);
  crate(c, x + w - 0.6, y + 1.05, 0.22);
  crate(c, x + w - 0.42, y + 1.3, 0.2);
  barrel(c, x + 0.3, y + h - 0.25);
  // coin sacks
  circle(c, x + 0.75, y + h - 0.24, 0.1, '#e6cf98', PAL.outline);
  circle(c, x + 0.75, y + h - 0.27, 0.04, PAL.gold);
}

// ---------- trees ----------

export function tree(c: C, x: number, y: number, r: number, seed: number, pass: 0 | 1) {
  if (pass === 0) {
    c.fillStyle = 'rgba(25,60,35,.32)';
    c.beginPath(); c.arc(x + r * 0.32, y + r * 0.38, r, 0, 7); c.fill();
    return;
  }
  const g = hash(seed, 11);
  const base = g < 0.4 ? PAL.tree[1] : g < 0.8 ? PAL.tree[0] : PAL.tree[2];
  const hi = base === PAL.tree[0] ? PAL.tree[1] : base === PAL.tree[1] ? PAL.tree[2] : '#7fcf8f';
  circle(c, x, y, r, '#25643f');
  // bumpy canopy: a ring of smaller blobs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + g * 3;
    circle(c, x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.55, base);
  }
  circle(c, x - r * 0.14, y - r * 0.16, r * 0.55, hi);
  circle(c, x - r * 0.25, y - r * 0.3, r * 0.28, mix(hi, '#ffffff', 0.25));
  for (let i = 0; i < 3; i++)
    circle(c, x - r * 0.4 + hash(seed, i, 2) * r * 0.7, y - r * 0.4 + hash(seed, i, 3) * r * 0.6, r * 0.07, PAL.treeHi);
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ---------- villagers ----------

export function villager(c: C, v: Villager, x: number, y: number, walking: boolean) {
  const s = 1;
  c.fillStyle = 'rgba(25,40,25,.3)';
  c.beginPath(); c.ellipse(x + 0.05, y + 0.06, 0.15 * s, 0.12 * s, 0, 0, 7); c.fill();
  c.save();
  c.translate(x, y);
  c.rotate(v.dir);
  const swing = walking ? Math.sin(v.step) * 0.06 : 0;
  const skin = PAL.skin[v.look.skin];
  // hands
  circle(c, swing, -0.15, 0.04, skin, PAL.outline, LW * 0.6);
  circle(c, -swing, 0.15, 0.04, skin, PAL.outline, LW * 0.6);
  // body (shoulders)
  c.beginPath(); c.ellipse(0, 0, 0.1, 0.16, 0, 0, 7);
  c.fillStyle = PAL.tunics[v.look.tunic]; c.fill(); stroke(c, PAL.outline, LW * 0.8);
  // head + hair
  circle(c, 0.01, 0, 0.085, skin, PAL.outline, LW * 0.7);
  c.beginPath(); c.arc(0.01, 0, 0.085, Math.PI * 0.55, Math.PI * 1.45);
  c.closePath(); c.fillStyle = PAL.hair[v.look.hair]; c.fill();
  // carried goods
  if (v.carry === 'basket') {
    circle(c, 0.04, 0.2, 0.075, '#c8964f', PAL.outline, LW * 0.7);
    circle(c, 0.04, 0.2, 0.04, PAL.crop2);
  } else if (v.carry === 'logs') {
    c.fillStyle = PAL.wood;
    rr(c, -0.05, -0.24, 0.1, 0.48, 0.04); c.fill(); stroke(c, PAL.outline, LW * 0.6);
    rr(c, 0.05, -0.22, 0.09, 0.44, 0.04); c.fill(); stroke(c, PAL.outline, LW * 0.6);
  } else if (v.carry === 'coins') {
    circle(c, 0.03, 0.2, 0.06, '#e6cf98', PAL.outline, LW * 0.6);
    circle(c, 0.03, 0.2, 0.025, PAL.gold);
  }
  c.restore();
}
