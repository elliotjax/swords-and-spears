import { CONFIG, type BuildingKind } from '../config';
import { hash } from '../sim/rng';
import { canPlace, dayFrac, def } from '../sim/sim';
import type { GameState } from '../sim/types';
import { rr } from './draw';
import { PAL } from './palette';
import { drawAmbient, drawLights } from './ambient';
import { drawGoods } from './goods';
import { siteProgress } from '../sim/logistics';
import { bedSlots, buildingCanvas, drawPawn, paintGround, paintRoads, paintWorld, R } from './pixel';

// =====================================================================
//  Renderer: reads the game state and draws it. Never changes the state.
// =====================================================================

export interface Camera { x: number; y: number; zoom: number } // x,y = view centre in tiles

export interface Ghost { kind: BuildingKind; x: number; y: number }

export interface ViewState {
  ghost: Ghost | null;
  selected: number | null;
}


export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 20, y: 20, zoom: 1 };
  dpr = 1;
  vw = 0; vh = 0;
  // pixel-art layers (R art pixels per tile), scaled up crisply each frame
  private groundCv: HTMLCanvasElement | null = null;
  private groundSeed = NaN;
  private wear: HTMLCanvasElement;
  private wearOld: HTMLCanvasElement;
  private wearAt = -1;
  private wearFade = 1;
  private lastTime = 0;
  private worldCv: HTMLCanvasElement;
  private worldSig = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.wear = document.createElement('canvas');
    this.wearOld = document.createElement('canvas');
    this.worldCv = document.createElement('canvas');
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
  reset() { this.groundCv = null; this.groundSeed = NaN; this.worldSig = ''; this.wearAt = -1; }

  // ---------------- chunk caches ----------------

  // ---------------- frame ----------------

  render(s: GameState, view: ViewState, alpha: number, time: number) {
    const c = this.ctx, d = this.dpr, ppt = this.ppt;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#4f6636'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const tl = this.screenToWorld(0, 0), br = this.screenToWorld(this.vw, this.vh);

    // screen position (device px) of art pixel 0,0, and device px per art pixel
    const ox = (this.vw / 2 - this.cam.x * ppt) * d, oy = (this.vh / 2 - this.cam.y * ppt) * d;
    const p = (ppt / R) * d;
    c.imageSmoothingEnabled = false;
    const ax0 = Math.max(0, Math.floor(tl.x * R) - 2), ay0 = Math.max(0, Math.floor(tl.y * R) - 2);
    const ax1 = Math.min(s.w * R, Math.ceil(br.x * R) + 2), ay1 = Math.min(s.h * R, Math.ceil(br.y * R) + 2);
    const blit = (cv: HTMLCanvasElement, a = 1) => {
      if (a <= 0.001 || !cv.width || ax1 <= ax0 || ay1 <= ay0) return;
      c.globalAlpha = a;
      c.drawImage(cv, ax0, ay0, ax1 - ax0, ay1 - ay0, ox + ax0 * p, oy + ay0 * p, (ax1 - ax0) * p, (ay1 - ay0) * p);
      c.globalAlpha = 1;
    };

    // 1. ground (painted once per map)
    if (!this.groundCv || this.groundSeed !== s.seed) { this.groundCv = paintGround(s); this.groundSeed = s.seed; }
    blit(this.groundCv);

    // 2. roads: repainted only when they change (once a night), new roads fade in
    if (s.roadVersion !== this.wearAt) {
      const first = this.wearAt === -1;
      this.wearAt = s.roadVersion;
      [this.wear, this.wearOld] = [this.wearOld, this.wear];
      paintRoads(s, this.wear);
      this.wearFade = first ? 1 : 0;
      if (first) this.wearOld.getContext('2d')!.clearRect(0, 0, this.wearOld.width, this.wearOld.height);
    }
    this.wearFade = Math.min(1, this.wearFade + (time - this.lastTime) / CONFIG.paths.fadeInSeconds);
    this.lastTime = time;
    blit(this.wearOld, 1 - this.wearFade);
    blit(this.wear, this.wearFade);

    // 3. buildings (roofless) + trees: repainted when buildings change or granaries fill up
    const sig = `${s.version}|${s.hallLevel}|${s.seed}|` + s.buildings.map(b => {
      const fs = def(b.kind).foodStorage;
      return fs && b.kind !== 'townHall' ? Math.round((b.food / fs) * 12) : '';
    }).join(',');
    if (sig !== this.worldSig) { this.worldSig = sig; paintWorld(s, this.worldCv); }
    blit(this.worldCv);
    // goods you can see (stockpile piles, shelves) and building sites rising
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawGoods(c, s, ox, oy, p, { x0: ax0, y0: ay0, x1: ax1, y1: ay1 }, time);

    // world transform for vector overlays: 1 unit = 1 tile
    const wt = () => c.setTransform(ppt * d, 0, 0, ppt * d, ox, oy);
    wt();
    const selB = view.selected != null ? s.buildings.find(b => b.id === view.selected) : undefined;
    if (selB) {
      c.setLineDash([0.12, 0.08]); c.lineWidth = 0.05; c.strokeStyle = '#ffffff';
      c.strokeRect(selB.x + 0.03, selB.y + 0.03, selB.w - 0.06, selB.h - 0.06);
      c.setLineDash([]);
    }

    // 4. people: tiny pixel villagers, also visible inside (roofless) buildings
    c.setTransform(1, 0, 0, 1, 0, 0);
    const people: { v: (typeof s.villagers)[number]; ax: number; ay: number; walk: boolean }[] = [];
    for (const v of s.villagers) {
      let ax: number, ay: number;
      if (v.mode === 'inside' && v.vis < 0.5) {
        const b = s.buildings.find(q => q.id === v.inside);
        if (!b) continue;
        const slots = bedSlots(b.kind), idx = b.residents.indexOf(v.id);
        if (slots.length && idx >= 0 && v.goalKind === 'home') {
          const sl = slots[idx % slots.length];
          ax = b.x * R + sl.x; ay = b.y * R + sl.y; // asleep / resting in their bed
        } else {
          ax = b.x * R + 5 + Math.floor(hash(v.id, 1) * (b.w * R - 10));
          ay = b.y * R + 6 + Math.floor(hash(v.id, 2) * (b.h * R - 12));
        }
      } else {
        const off = v.mode === 'idle' ? 1 : 0;
        ax = Math.floor((v.px + (v.x - v.px) * alpha + v.ox * off) * R);
        ay = Math.floor((v.py + (v.y - v.py) * alpha + v.oy * off) * R);
      }
      if (ax < ax0 - 4 || ax > ax1 + 4 || ay < ay0 - 4 || ay > ay1 + 4) continue;
      people.push({ v, ax, ay, walk: v.mode !== 'inside' && (v.x !== v.px || v.y !== v.py) });
    }
    people.sort((a, b) => a.ay - b.ay);
    for (const q of people) drawPawn(c, q.v, q.ax, q.ay, p, ox, oy, q.walk);
    // ambient life: hearth fires and smoke, chickens and sheep, birds
    drawAmbient(c, s, ox, oy, p, time, { x0: ax0, y0: ay0, x1: ax1, y1: ay1 }, dayFrac(s) * 24);
    wt();

    // chapel radius: shown while placing a chapel, or when one is selected
    const ring = (cx: number, cy: number, r: number) => {
      c.fillStyle = 'rgba(255,240,180,.16)';
      c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.setLineDash([0.18, 0.12]); c.lineWidth = 0.05; c.strokeStyle = 'rgba(217,162,30,.9)';
      c.stroke(); c.setLineDash([]);
    };
    if (selB && def(selB.kind).happyRadius) ring(selB.x + selB.w / 2, selB.y + selB.h / 2, def(selB.kind).happyRadius!);
    if (view.ghost && def(view.ghost.kind).happyRadius) {
      const df = def(view.ghost.kind);
      ring(view.ghost.x + df.w / 2, view.ghost.y + df.h / 2, df.happyRadius!);
    }

    // placement ghost
    if (view.ghost) {
      const g = view.ghost, df = def(g.kind);
      const ok = canPlace(s, g.kind, g.x, g.y).ok;
      c.setTransform(1, 0, 0, 1, 0, 0);
      const pic = buildingCanvas(g.kind);
      c.globalAlpha = 0.7; c.imageSmoothingEnabled = false;
      c.drawImage(pic, ox + g.x * R * p, oy + g.y * R * p, pic.width * p, pic.height * p);
      c.globalAlpha = 1;
      wt();
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
      drawLights(c, s, ox, oy, p, time, dark); // warm firelight through the dark
    }

    // worker badges (screen space)
    if (this.cam.zoom > 0.45) this.badges(s, c);
    if (view.ghost) this.ghostLabel(s, c, view.ghost);
  }

  private badges(s: GameState, c: CanvasRenderingContext2D) {
    const d = this.dpr;
    const z = Math.max(0.75, Math.min(1.15, this.cam.zoom));
    c.font = `800 ${12 * z * d}px Nunito, system-ui, sans-serif`;
    c.textBaseline = 'middle';
    for (const b of s.buildings) {
      const df = def(b.kind);
      if (b.site) { this.siteBadge(s, c, b, z); continue; }
      if (!df.badge) continue;
      const cap = df.beds ?? df.soldierBeds ?? df.workers ?? df.trainingSlots ?? 0;
      const n = df.beds || df.soldierBeds ? b.residents.length : b.workers.length;
      const txt = df.foodStorage ? `${Math.round((b.food / df.foodStorage) * 100)}%` : `${n}/${cap}`;
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

  /** Building sites: a grey badge with a hammer and how far along it is. */
  private siteBadge(s: GameState, c: CanvasRenderingContext2D, b: GameState['buildings'][number], z: number) {
    const d = this.dpr;
    const txt = `${Math.floor(siteProgress(s, b) * 100)}%`;
    const p = this.worldToScreen(b.x + b.w / 2, b.y + 0.05);
    const tw = c.measureText(txt).width;
    const h = 22 * z * d, w = tw + 30 * z * d;
    const x = p.x * d - w / 2, y = p.y * d - h / 2;
    c.fillStyle = 'rgba(30,40,60,.18)'; rr(c, x + 1 * d, y + 2 * d, w, h, h / 2); c.fill();
    c.fillStyle = '#fff'; rr(c, x, y, w, h, h / 2); c.fill();
    c.lineWidth = 2 * d * z; c.strokeStyle = '#8a8478'; c.stroke();
    // hammer
    const hx = x + 12 * z * d, hy = y + h / 2;
    c.strokeStyle = '#8a5c36'; c.lineWidth = 2.2 * z * d; c.beginPath(); c.moveTo(hx - 3 * z * d, hy + 4 * z * d); c.lineTo(hx + 2 * z * d, hy - 2 * z * d); c.stroke();
    c.fillStyle = '#667086'; c.fillRect(hx - 1 * z * d, hy - 5 * z * d, 6 * z * d, 3.5 * z * d);
    c.fillStyle = '#262b38'; c.fillText(txt, x + 22 * z * d, y + h / 2 + 0.5 * d);
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

/** 0 = full daylight, 1 = darkest night. Dusk around 18:00-21:00, dawn around 4:00-6:30. */
export function nightAmount(t: number): number {
  const h = t * 24;
  const ss = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  if (h < 12) return 1 - ss(4, 6.5, h);
  return ss(18, 21, h);
}
