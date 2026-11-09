import { CONFIG, type BuildingKind } from '../config';
import { hash } from '../sim/rng';
import type { GameState } from '../sim/types';
import { R } from './pixel';

// =====================================================================
//  Ambient life: things that make the town feel alive but don't change
//  the game. Hearth smoke, flickering fires, chickens and sheep by the
//  farms, birds flying over, and warm lights at night.
// =====================================================================

type P = (ax: number, ay: number, col: string, w?: number, h?: number) => void;

/** Fire spots (art px from the building's corner) for each kind. */
function fires(kind: BuildingKind, W: number, H: number): { x: number; y: number; big?: boolean }[] {
  switch (kind) {
    case 'house': case 'longhouse': case 'manor': return [{ x: 6, y: H - 7 }];
    case 'townHall': return [{ x: 8, y: H - 9 }, { x: W - 8, y: H - 9 }];
    case 'tavern': return [{ x: W - 6, y: H - 6, big: true }];
    case 'barracks': return [{ x: 5, y: H - 6 }];
    case 'wrights': case 'carpenter': return [{ x: W - 6, y: H - 6 }];
    case 'hunter': return [{ x: 10, y: 24, big: true }];
    default: return [];
  }
}

/** Lights that glow at night (art px from the building's corner) and their radius in tiles. */
function lights(kind: BuildingKind, W: number, H: number): { x: number; y: number; r: number }[] {
  const f = fires(kind, W, H).map(p => ({ ...p, r: p.big ? 2.2 : 1.5 }));
  switch (kind) {
    case 'chapel': return [{ x: W / 2, y: 6, r: 1.6 }];
    case 'market': return [{ x: W / 2, y: H / 2, r: 1.2 }];
    case 'townHall': return [...f, { x: W / 2, y: H - 2, r: 1.8 }];
    case 'tavern': return [...f, { x: W / 2, y: H / 2, r: 1.6 }];
    case 'granary': case 'farm': case 'lumberCamp': case 'palisade': case 'trainingGrounds': case 'stockpile': case 'quarry': return [];
    default: return f;
  }
}

/** Is anybody home (inside the building)? */
function occupied(s: GameState, id: number) {
  for (const v of s.villagers) if (v.mode === 'inside' && v.inside === id) return true;
  return false;
}

/** Draw ambient life on top of buildings and people (before the night tint). */
export function drawAmbient(c: CanvasRenderingContext2D, s: GameState, ox: number, oy: number, p: number, t: number, view: { x0: number; y0: number; x1: number; y1: number }, hour: number) {
  const P: P = (ax, ay, col, w = 1, h = 1) => {
    const sx = Math.round(ox + ax * p), sy = Math.round(oy + ay * p);
    c.fillStyle = col; c.fillRect(sx, sy, Math.round(ox + (ax + w) * p) - sx, Math.round(oy + (ay + h) * p) - sy);
  };
  const inView = (x: number, y: number, m = 20) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;
  const cooking = (hour >= 4.5 && hour < 8) || (hour >= 16.5 && hour < 22);

  for (const b of s.buildings) {
    const bx = b.x * R, by = b.y * R, W = b.w * R, H = b.h * R;
    if (b.site && !b.site.upgrade) continue; // building sites: nothing lit yet
    if (!inView(bx + W / 2, by + H / 2, W + 30)) continue;
    // fires flicker; homes only smoke when somebody is in (or it's cooking time)
    const lit = b.kind === 'townHall' || b.kind === 'tavern' || (b.kind === 'hunter' ? b.workers.length > 0 : cooking || occupied(s, b.id));
    for (const [i, f] of fires(b.kind, W, H).entries()) {
      const fx = bx + f.x, fy = by + f.y;
      if (!lit) continue;
      const fl = Math.floor(t * 8 + i * 3 + b.id) % 3;
      P(fx - 1, fy - 1, fl === 0 ? '#f2c14e' : '#e8862a', 3, 2);
      P(fx - 1 + fl % 2, fy - 2, fl === 2 ? '#fff0a0' : '#f2c14e');
      // smoke puffs rise and drift with the wind, fading out
      for (let k = 0; k < 4; k++) {
        const ph = ((t * 0.32 + k / 4 + hash(b.id, i, 9)) % 1);
        const sx = fx + ph * 7 + Math.sin(ph * 6 + k) * 1.2, sy = fy - 3 - ph * 16;
        const a = (1 - ph) * 0.55;
        const sz = ph < 0.4 ? 1 : 2;
        P(Math.round(sx), Math.round(sy), `rgba(205,205,200,${a.toFixed(2)})`, sz, sz);
      }
    }
    // chickens peck about near farms and granaries; sheep graze beside farms
    if (b.kind === 'farm' || b.kind === 'granary') {
      const n = b.kind === 'farm' ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const seed = b.id * 31 + k;
        const cyc = 9 + hash(seed, 1) * 6, ph = (t / cyc + hash(seed, 2)) % 1;
        // walk a small loop just outside the bottom edge, pausing to peck
        const ang = hash(seed, 3) * 6.28 + Math.floor(ph * 5) * 1.3 + (ph * 5 % 1 < 0.6 ? (ph * 5 % 1) / 0.6 * 1.3 : 1.3);
        const cx = bx + W / 2 + (hash(seed, 4) - 0.5) * W * 0.8 + Math.cos(ang) * 4;
        const cy = by + H + 3 + Math.sin(ang) * 2;
        const peck = ph * 5 % 1 > 0.6 && Math.floor(t * 4 + k) % 2 === 0;
        P(Math.round(cx), Math.round(cy) - (peck ? 0 : 1), '#f4f1ea', 2, 1);
        P(Math.round(cx) + (Math.cos(ang) > 0 ? 2 : -1), Math.round(cy) - (peck ? 0 : 1), '#e8862a');
        P(Math.round(cx), Math.round(cy) - (peck ? 1 : 2), '#c0392b');
      }
    }
    if (b.kind === 'farm') {
      for (let k = 0; k < 2; k++) {
        const seed = b.id * 17 + k + 5;
        const side = hash(seed, 1) < 0.5 ? -1 : 1;
        const ph = (t / (20 + hash(seed, 2) * 10) + hash(seed, 3)) % 1;
        const sx = side < 0 ? bx - 5 - hash(seed, 4) * 6 : bx + W + 2 + hash(seed, 4) * 6;
        const sy = by + 6 + hash(seed, 5) * (H - 12) + Math.sin(ph * 6.28) * 3;
        if (s.occ[Math.floor(sy / R) * s.w + Math.floor(sx / R)] >= 0) continue; // not inside another building
        const rx = Math.round(sx), ry = Math.round(sy);
        P(rx - 1, ry - 1, 'rgba(0,0,0,.18)', 4, 1);
        P(rx - 1, ry - 3, '#efe9da', 4, 2); P(rx, ry - 4, '#f7f3e8', 2, 1);
        const head = Math.cos(ph * 12.5) > 0 ? 3 : -2;
        P(rx + head, ry - 3, '#3e3a36'); P(rx, ry - 1, '#3e3a36'); P(rx + 2, ry - 1, '#3e3a36');
      }
    }
  }

  // birds: a little flock crosses the sky now and then (their shadows on the ground)
  const period = 45, k = Math.floor(t / period), ph = (t % period) / period;
  if (ph < 0.5) {
    const span = s.w * R + 80, prog = ph / 0.5;
    const y0 = hash(k, 1, 77) * s.h * R, dir = hash(k, 2, 77) < 0.5 ? 1 : -1;
    const x0 = dir > 0 ? -40 + prog * span : s.w * R + 40 - prog * span;
    for (let i = 0; i < 5; i++) {
      const bxp = Math.round(x0 - dir * (i % 3) * 5 - dir * i * 2), byp = Math.round(y0 + (i - 2) * 4 + (i % 2) * 2);
      if (!inView(bxp, byp)) continue;
      const flap = Math.floor(t * 6 + i) % 2;
      P(bxp + 6, byp + 14, 'rgba(0,0,0,.15)', 3, 1); // shadow
      P(bxp, byp, '#2e2a28'); P(bxp - 1, byp - flap, '#2e2a28'); P(bxp + 1, byp - flap, '#2e2a28');
    }
  }
}

/** Warm glows at night, drawn on top of the night tint. */
export function drawLights(c: CanvasRenderingContext2D, s: GameState, ox: number, oy: number, p: number, t: number, dark: number) {
  if (dark < 0.05) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const b of s.buildings) {
    const W = b.w * R, H = b.h * R;
    if (b.site && !b.site.upgrade) continue;
    for (const [i, l] of lights(b.kind, W, H).entries()) {
      const x = ox + (b.x * R + l.x) * p, y = oy + (b.y * R + l.y) * p;
      const flick = 1 + Math.sin(t * 7 + b.id + i) * 0.04 + Math.sin(t * 13 + i) * 0.03;
      const r = l.r * R * p * flick;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      const a = Math.min(1, dark / CONFIG.schedule.nightTint) * 0.42;
      gr.addColorStop(0, `rgba(255,190,100,${a})`);
      gr.addColorStop(0.45, `rgba(255,150,60,${a * 0.45})`);
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = gr;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  c.restore();
}
