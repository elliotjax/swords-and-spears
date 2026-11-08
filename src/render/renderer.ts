import { CONFIG, type BuildingKind } from '../config';
import { hash, noise2 } from '../sim/rng';
import { canPlace, dayFrac, def, getB } from '../sim/sim';
import { FOREST, type GameState } from '../sim/types';
import { drawBuilding, LW, rr, tree, villager } from './draw';
import { PAL } from './palette';

// =====================================================================
//  Renderer: reads the game state and draws it. Never changes the state.
// =====================================================================

export interface Camera { x: number; y: number; zoom: number } // x,y = view centre in tiles

export interface Ghost { kind: BuildingKind; x: number; y: number }

export interface ViewState {
  ghost: Ghost | null;
  selected: number | null;
}

const CH = 8; // tiles per cached chunk
const WEAR_RES = 16; // pixels per tile in the road texture

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 20, y: 20, zoom: 1 };
  dpr = 1;
  vw = 0; vh = 0;
  private ground = new Map<string, HTMLCanvasElement>();
  private trees = new Map<string, HTMLCanvasElement>();
  private treeSig = '';
  private wear: HTMLCanvasElement;
  private wearAt = -1;
  private seed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.wear = document.createElement('canvas');
    this.resize();
  }

  resize() {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.vw = window.innerWidth; this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  }

  get ppt() { return CONFIG.camera.tilePx * this.cam.zoom; } // pixels per tile

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.vw / 2) / this.ppt + this.cam.x, y: (sy - this.vh / 2) / this.ppt + this.cam.y };
  }
  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.ppt + this.vw / 2, y: (wy - this.cam.y) * this.ppt + this.vh / 2 };
  }

  clampCam(s: GameState) {
    const C = CONFIG.camera;
    this.cam.zoom = Math.max(C.minZoom, Math.min(C.maxZoom, this.cam.zoom));
    const m = 2;
    this.cam.x = Math.max(-m, Math.min(s.w + m, this.cam.x));
    this.cam.y = Math.max(-m, Math.min(s.h + m, this.cam.y));
  }

  /** Clear cached map images (e.g. when starting a new game). */
  reset() { this.ground.clear(); this.trees.clear(); this.treeSig = ''; this.wearAt = -1; }

  // ---------------- chunk caches ----------------

  private bucket() {
    const r = this.ppt * this.dpr;
    const b = Math.pow(2, Math.ceil(Math.log2(r) * 2) / 2);
    return Math.max(8, Math.min(220, b));
  }

  private chunk(cache: Map<string, HTMLCanvasElement>, s: GameState, cx: number, cy: number,
    res: number, paint: (c: CanvasRenderingContext2D, x0: number, y0: number) => void) {
    const key = `${cx},${cy},${res}`;
    let cv = cache.get(key);
    if (cv) { cache.delete(key); cache.set(key, cv); return cv; } // LRU touch
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(CH * res);
    const c = cv.getContext('2d')!;
    c.setTransform(res, 0, 0, res, -cx * CH * res, -cy * CH * res);
    paint(c, cx * CH, cy * CH);
    cache.set(key, cv);
    while (cache.size > 48) cache.delete(cache.keys().next().value!);
    void s;
    return cv;
  }

  private paintGround(s: GameState, c: CanvasRenderingContext2D, x0: number, y0: number) {
    // soft colour patches: one pixel per tile, smoothly stretched (no hard edges)
    const M = 3, n = CH + M * 2;
    const tex = document.createElement('canvas');
    tex.width = tex.height = n;
    const tc = tex.getContext('2d')!;
    const img = tc.createImageData(n, n);
    const sd = s.seed;
    const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
    const base = [139, 199, 122], light = [161, 214, 143], dark = [116, 178, 102], forestC = [104, 166, 92], off = [110, 160, 100];
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
      const x = x0 - M + tx, y = y0 - M + ty;
      const inMap = x >= 0 && y >= 0 && x < s.w && y < s.h;
      let col: number[];
      if (!inMap) col = off;
      else if (s.tiles[y * s.w + x] === FOREST) col = forestC;
      else {
        const v = noise2(x / 4.5, y / 4.5, sd + 3) * 0.75 + noise2(x / 1.7, y / 1.7, sd + 9) * 0.25;
        col = v > 0.56 ? lerp(base, light, Math.min(1, (v - 0.56) * 4)) : v < 0.42 ? lerp(base, dark, Math.min(1, (0.42 - v) * 4)) : base;
      }
      const k = (ty * n + tx) * 4;
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(tex, x0 - M + 0.5, y0 - M + 0.5, n, n);
    // small details
    for (let y = y0; y < y0 + CH; y++) for (let x = x0; x < x0 + CH; x++) {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const forest = s.tiles[y * s.w + x] === FOREST;
      const tufts = forest ? 1 : 3;
      c.strokeStyle = forest ? '#4e8e4c' : '#6aa95c'; c.lineWidth = 0.022; c.lineCap = 'round';
      c.beginPath();
      for (let k = 0; k < tufts; k++) {
        if (hash(x, y, sd + 10 + k) < 0.45) continue;
        const tx = x + hash(x, y, sd + 20 + k), ty = y + hash(x, y, sd + 30 + k);
        c.moveTo(tx - 0.05, ty - 0.06); c.lineTo(tx - 0.02, ty);
        c.moveTo(tx, ty - 0.09); c.lineTo(tx, ty);
        c.moveTo(tx + 0.05, ty - 0.06); c.lineTo(tx + 0.02, ty);
      }
      c.stroke();
      if (!forest && hash(x, y, sd + 40) < 0.16) {
        const fx = x + hash(x, y, sd + 41) * 0.8 + 0.1, fy = y + hash(x, y, sd + 42) * 0.8 + 0.1;
        const col = ['#ffffff', '#ffe27a', '#f6a6c1', '#ffffff'][(hash(x, y, sd + 43) * 4) | 0];
        for (let k = 0; k < 3; k++) {
          c.fillStyle = col; c.beginPath();
          c.arc(fx + (k - 1) * 0.07, fy + (k % 2) * 0.06, 0.028, 0, 7); c.fill();
        }
      }
      if (!forest && hash(x, y, sd + 50) < 0.07) {
        const px = x + hash(x, y, sd + 51) * 0.8 + 0.1, py = y + hash(x, y, sd + 52) * 0.8 + 0.1;
        c.fillStyle = '#c9c4b5'; c.beginPath(); c.ellipse(px, py, 0.06, 0.04, 0.3, 0, 7); c.fill();
        c.fillStyle = '#e4e0d4'; c.beginPath(); c.ellipse(px - 0.015, py - 0.012, 0.03, 0.018, 0.3, 0, 7); c.fill();
      }
    }
  }

  private paintTrees(s: GameState, c: CanvasRenderingContext2D, x0: number, y0: number) {
    const list: { x: number; y: number; r: number; seed: number }[] = [];
    for (let y = y0 - 1; y < y0 + CH + 1; y++) for (let x = x0 - 1; x < x0 + CH + 1; x++) {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const i = y * s.w + x;
      if (s.tiles[i] !== FOREST) continue;
      const b = s.occ[i] >= 0 ? getB(s, s.occ[i]) : undefined;
      if (b && b.kind === 'lumberCamp') continue; // the camp has cleared these trees
      const n = 2 + (hash(x, y, s.seed + 60) < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        list.push({
          x: x + 0.2 + hash(x, y, s.seed + 61 + k) * 0.6,
          y: y + 0.2 + hash(x, y, s.seed + 71 + k) * 0.6,
          r: 0.3 + hash(x, y, s.seed + 81 + k) * 0.17,
          seed: x * 1000 + y * 7 + k,
        });
      }
    }
    list.sort((a, b) => a.y - b.y);
    for (const t of list) tree(c, t.x, t.y, t.r, t.seed, 0);
    for (const t of list) tree(c, t.x, t.y, t.r, t.seed, 1);
  }

  // ---------------- desire paths (gravel roads) ----------------
  // Foot traffic is counted between neighbouring tiles. Each worn link is drawn
  // as a thin path through tile centres, with smooth curves where paths bend
  // or branch, so roads join up naturally (diagonals included).

  private paintWear(s: GameState) {
    const R = WEAR_RES;
    const cv = this.wear;
    if (cv.width !== s.w * R) { cv.width = s.w * R; cv.height = s.h * R; }
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.setTransform(R, 0, 0, R, 0, 0);
    const P = CONFIG.paths;
    const W = s.w, N = s.w * s.h;
    const DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    const adj: ({ x: number; y: number; t: number }[] | undefined)[] = new Array(N);
    const links: { ax: number; ay: number; bx: number; by: number; t: number }[] = [];
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 4; d++) {
        const t = s.edges[i * 4 + d];
        if (t < P.faint) continue;
        const ax = i % W, ay = Math.floor(i / W), bx = ax + DIRS[d][0], by = ay + DIRS[d][1];
        if (bx < 0 || by < 0 || bx >= W || by >= s.h) continue;
        const j = by * W + bx;
        (adj[i] ??= []).push({ x: bx, y: by, t });
        (adj[j] ??= []).push({ x: ax, y: ay, t });
        links.push({ ax, ay, bx, by, t });
      }
    }
    const level = (t: number) => (t >= P.road ? 3 : t >= P.trail ? 2 : 1);
    const network = (minLevel: number, width: number, color: string, alpha = 1) => {
      c.globalAlpha = alpha;
      c.lineWidth = width; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i < N; i++) {
        const list = adj[i];
        if (!list) continue;
        const cx = (i % W) + 0.5, cy = Math.floor(i / W) + 0.5;
        const mids = list.filter(n => level(n.t) >= minLevel).map(n => ({ x: (cx + n.x + 0.5) / 2, y: (cy + n.y + 0.5) / 2 }));
        if (mids.length === 1) { c.moveTo(cx, cy); c.lineTo(mids[0].x, mids[0].y); }
        for (let a = 0; a < mids.length; a++) for (let b = a + 1; b < mids.length; b++) {
          c.moveTo(mids[a].x, mids[a].y);
          c.quadraticCurveTo(cx, cy, mids[b].x, mids[b].y);
        }
      }
      c.stroke();
      c.globalAlpha = 1;
    };
    // 1. faintly worn grass
    network(1, 0.16, '#c9bf92', 0.5);
    // 2. gravel trail, 3. wide gravel road (dark edge first, then the gravel)
    network(2, 0.27, '#b3a78f');
    network(3, 0.42, '#a99c84');
    network(2, 0.2, '#d8cfbd');
    network(3, 0.33, '#ded6c6');
    // little stones
    for (const l of links) {
      const lv = level(l.t);
      if (lv < 2) continue;
      const half = (lv === 3 ? 0.13 : 0.07);
      const n = lv === 3 ? 5 : 3;
      const dx = l.bx - l.ax, dy = l.by - l.ay, len = Math.hypot(dx, dy);
      const px = -dy / len, py = dx / len;
      for (let k = 0; k < n; k++) {
        const h1 = hash(l.ax * 97 + l.bx, l.ay * 89 + l.by, k);
        const h2 = hash(l.ax * 31 + l.bx, l.ay * 37 + l.by, k + 9);
        const f = 0.25 + h1 * 0.5, o = (h2 - 0.5) * 2 * half;
        const x = l.ax + 0.5 + dx * f + px * o, y = l.ay + 0.5 + dy * f + py * o;
        c.fillStyle = k % 2 ? '#a0947e' : '#f4efe4';
        c.beginPath(); c.arc(x, y, 0.022 + h2 * 0.012, 0, 7); c.fill();
      }
    }
  }

  // ---------------- frame ----------------

  render(s: GameState, view: ViewState, alpha: number, time: number) {
    const c = this.ctx, d = this.dpr, ppt = this.ppt;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#6d9d62'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // visible tile range
    const tl = this.screenToWorld(0, 0), br = this.screenToWorld(this.vw, this.vh);
    const cx0 = Math.floor(tl.x / CH) - 0, cy0 = Math.floor(tl.y / CH);
    const cx1 = Math.floor(br.x / CH), cy1 = Math.floor(br.y / CH);
    const res = this.bucket();

    const sig = s.buildings.filter(b => b.kind === 'lumberCamp').map(b => b.id).join(',') + ':' + s.seed;
    if (sig !== this.treeSig) { this.trees.clear(); this.treeSig = sig; }

    const blit = (cv: HTMLCanvasElement, cx: number, cy: number) => {
      const p0 = this.worldToScreen(cx * CH, cy * CH), p1 = this.worldToScreen((cx + 1) * CH, (cy + 1) * CH);
      const x0 = Math.round(p0.x * d), y0 = Math.round(p0.y * d);
      c.drawImage(cv, x0, y0, Math.round(p1.x * d) - x0, Math.round(p1.y * d) - y0);
    };

    c.imageSmoothingEnabled = true;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
      blit(this.chunk(this.ground, s, cx, cy, res, (g, x, y) => this.paintGround(s, g, x, y)), cx, cy);

    // world transform: 1 unit = 1 tile
    const wt = () => c.setTransform(ppt * d, 0, 0, ppt * d, (this.vw / 2 - this.cam.x * ppt) * d, (this.vh / 2 - this.cam.y * ppt) * d);
    wt();

    // worn paths
    if (Math.floor(time * 2) !== this.wearAt) { this.wearAt = Math.floor(time * 2); this.paintWear(s); }
    c.imageSmoothingQuality = 'medium';
    {
      // only copy the visible part of the road texture
      const R = WEAR_RES;
      const x0 = Math.max(0, Math.floor(tl.x) - 1), y0 = Math.max(0, Math.floor(tl.y) - 1);
      const x1 = Math.min(s.w, Math.ceil(br.x) + 1), y1 = Math.min(s.h, Math.ceil(br.y) + 1);
      if (x1 > x0 && y1 > y0) c.drawImage(this.wear, x0 * R, y0 * R, (x1 - x0) * R, (y1 - y0) * R, x0, y0, x1 - x0, y1 - y0);
    }

    // trees
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
      blit(this.chunk(this.trees, s, cx, cy, res, (g, x, y) => this.paintTrees(s, g, x, y)), cx, cy);
    wt();

    // buildings (sorted top to bottom)
    const bs = [...s.buildings].sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const b of bs) {
      if (b.x > br.x + 1 || b.y > br.y + 1 || b.x + b.w < tl.x - 1 || b.y + b.h < tl.y - 1) continue;
      drawBuilding(c, b.kind, b.x, b.y, b.w, b.h, { t: time, level: s.hallLevel, seed: b.id });
      if (b.id === view.selected) {
        c.setLineDash([0.12, 0.08]);
        c.lineWidth = 0.05; c.strokeStyle = '#ffffff';
        rr(c, b.x + 0.02, b.y + 0.02, b.w - 0.04, b.h - 0.04, 0.1); c.stroke();
        c.setLineDash([]);
      }
    }

    // villagers
    const vs = s.villagers.filter(v => v.vis > 0.01);
    vs.sort((a, b) => a.y - b.y);
    for (const v of vs) {
      // walkers stay on the middle of the path; idlers get a small personal offset
      const off = v.mode === 'idle' ? 1 : 0;
      const x = v.px + (v.x - v.px) * alpha + v.ox * off;
      const y = v.py + (v.y - v.py) * alpha + v.oy * off;
      if (x < tl.x - 1 || x > br.x + 1 || y < tl.y - 1 || y > br.y + 1) continue;
      c.globalAlpha = v.vis;
      villager(c, v, x, y, v.mode !== 'inside' && (v.x !== v.px || v.y !== v.py));
    }
    c.globalAlpha = 1;

    // placement ghost
    if (view.ghost) {
      const g = view.ghost, df = def(g.kind);
      const ok = canPlace(s, g.kind, g.x, g.y).ok;
      c.globalAlpha = 0.6;
      drawBuilding(c, g.kind, g.x, g.y, df.w, df.h, { t: time, level: s.hallLevel });
      c.globalAlpha = 1;
      c.fillStyle = ok ? 'rgba(70,200,95,.32)' : 'rgba(214,69,61,.32)';
      c.fillRect(g.x, g.y, df.w, df.h);
      c.setLineDash([0.14, 0.09]); c.lineWidth = 0.05;
      c.strokeStyle = ok ? '#2f9d58' : '#d6453d';
      c.strokeRect(g.x + 0.02, g.y + 0.02, df.w - 0.04, df.h - 0.04);
      c.setLineDash([]);
    }

    // night tint
    c.setTransform(1, 0, 0, 1, 0, 0);
    const dark = nightAmount(dayFrac(s)) * CONFIG.schedule.nightTint;
    if (dark > 0.001 && s.hallId != null) {
      c.fillStyle = `rgba(28,34,90,${dark})`;
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // worker badges (screen space)
    if (this.cam.zoom > 0.45) this.badges(s, c);
    if (view.ghost) this.ghostLabel(s, c, view.ghost);
    void LW;
  }

  private badges(s: GameState, c: CanvasRenderingContext2D) {
    const d = this.dpr;
    const z = Math.max(0.75, Math.min(1.15, this.cam.zoom));
    c.font = `800 ${12 * z * d}px Nunito, system-ui, sans-serif`;
    c.textBaseline = 'middle';
    for (const b of s.buildings) {
      const df = def(b.kind);
      if (!df.badge) continue;
      const cap = df.beds ?? df.workers ?? 0;
      const n = df.beds ? b.residents.length : b.workers.length;
      const txt = `${n}/${cap}`;
      const p = this.worldToScreen(b.x + b.w / 2, b.y + 0.05);
      const tw = c.measureText(txt).width;
      const h = 22 * z * d, w = tw + 26 * z * d;
      const x = p.x * d - w / 2, y = p.y * d - h / 2;
      c.fillStyle = 'rgba(30,40,60,.18)'; rr(c, x + 1 * d, y + 2 * d, w, h, h / 2); c.fill();
      c.fillStyle = '#fff'; rr(c, x, y, w, h, h / 2); c.fill();
      c.lineWidth = 2 * d * z; c.strokeStyle = PAL.badge[df.badge]; c.stroke();
      c.fillStyle = PAL.badge[df.badge];
      c.beginPath(); c.arc(x + 11 * z * d, y + h / 2, 4 * z * d, 0, 7); c.fill();
      c.fillStyle = '#262b38'; c.fillText(txt, x + 19 * z * d, y + h / 2 + 0.5 * d);
    }
  }

  private ghostLabel(s: GameState, c: CanvasRenderingContext2D, g: Ghost) {
    const r = canPlace(s, g.kind, g.x, g.y);
    if (r.ok) return;
    const d = this.dpr, df = def(g.kind);
    const p = this.worldToScreen(g.x + df.w / 2, g.y);
    c.font = `800 ${12 * d}px Nunito, system-ui, sans-serif`;
    c.textBaseline = 'middle';
    const tw = c.measureText(r.reason!).width, h = 24 * d, w = tw + 20 * d;
    const x = p.x * d - w / 2, y = p.y * d - h - 8 * d;
    c.fillStyle = '#d6453d'; rr(c, x, y, w, h, h / 2); c.fill();
    c.fillStyle = '#fff'; c.fillText(r.reason!, x + 10 * d, y + h / 2 + 0.5 * d);
  }
}

export function nightAmount(t: number): number {
  const S = CONFIG.schedule;
  const ss = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  if (t < 0.12) return 1 - ss(0, 0.12, t);
  return ss(S.workEnd + 0.04, S.sleepStart + 0.04, t);
}
