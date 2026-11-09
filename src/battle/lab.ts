import { CONFIG, type UnitKind } from '../config';
import { PX, R, SPRITES, SP_COL } from '../render/pixel';
import { hash } from '../sim/rng';
import { unitIcon } from '../ui/ui';
import { IC } from '../ui/icons';
import {
  BATTLE_TPS, createBattle, runBattle, squadAlive, squadHp, stepBattle, wavering,
  type BattleSetup, type BattleState, type BSoldier, type Pt, type Side, type SideBonus, type SquadSetup,
} from './battle';
import type { GameState } from '../sim/types';

// =====================================================================
//  Battle Lab: a test screen to set up two armies, watch them fight,
//  and run many battles in the background to check the balance.
// =====================================================================

const UNITS: UnitKind[] = ['swordsmen', 'spearmen', 'archers', 'cavalry'];
const TEAM = ['#c0392b', '#3a62b8'], TEAM_DARK = ['#8e2a23', '#27457f'], TEAM_LIGHT = ['#ef9a90', '#93b2ee'];
const SIDE_NAME = ['You (red)', 'Enemy (blue)'];

const PRESETS: { name: string; a: Partial<Record<UnitKind, number>>; b: Partial<Record<UnitKind, number>> }[] = [
  { name: 'Balanced', a: { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, b: { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 } },
  { name: 'Spears vs Cavalry', a: { spearmen: 2 }, b: { cavalry: 4 } },
  { name: 'Cavalry vs Archers', a: { cavalry: 4 }, b: { archers: 2 } },
  { name: 'Archers vs Spears', a: { archers: 2 }, b: { spearmen: 2 } },
  { name: 'Swords vs Spears', a: { swordsmen: 2 }, b: { spearmen: 2 } },
  { name: 'Big battle', a: { swordsmen: 3, spearmen: 3, archers: 3, cavalry: 4 }, b: { swordsmen: 3, spearmen: 3, archers: 3, cavalry: 4 } },
  { name: 'Huge (400)', a: { swordsmen: 6, spearmen: 6, archers: 4, cavalry: 8 }, b: { swordsmen: 6, spearmen: 6, archers: 4, cavalry: 8 } },
  { name: 'Epic (1000)', a: { swordsmen: 15, spearmen: 15, archers: 10, cavalry: 20 }, b: { swordsmen: 15, spearmen: 15, archers: 10, cavalry: 20 } },
];

export class BattleLab {
  isOpen = false;
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private panel: HTMLDivElement;
  private b: BattleState | null = null;
  private counts: [Record<UnitKind, number>, Record<UnitKind, number>];
  private ranks: [number, number] = [1, 1];
  private speed = 1;
  private seed = 1;
  private ground: HTMLCanvasElement | null = null;
  private cam = { x: 0, y: 0, zoom: 1 }; // in shown (maybe turned) tiles
  private rot = false;                      // field shown turned (your army at the bottom)
  private minZoom = 0.8;
  private finger: Pt | null = null;         // where the finger is while dragging (for scrolling at the screen edges)
  private hit: { knob?: Pt; x?: Pt; head?: Pt } = {}; // screen spots of the selected squad's handles (CSS px)
  private autoCam = true; // follow the fighting until the player pans/zooms
  private raf = 0;
  private acc = 0;
  private last = 0;
  private batch: { done: number; total: number; wins: number[]; time: number } | null = null;
  private view: 'setup' | 'fight' | 'result' = 'setup';
  // ---- deployment (your side) ----
  /** Your squads: where they stand (x, y), their automatic spot (ax, ay), the arrow you drew, and whether they're on the field. */
  private army: (SquadSetup & { ax: number; ay: number; placed: boolean })[] = [];
  private field = { W: CONFIG.battle.fieldW, H: CONFIG.battle.fieldH };
  private sel = -1;                       // selected squad (index into army)
  private page: 'deploy' | 'army' = 'deploy';
  private drag: { mode: 'move' | 'path'; i: number; ox: number; oy: number; lx: number; ly: number } | null = null;
  private placedIdx: number[] = [];       // army index of each squad in the current battle setup

  constructor(private onClose: () => void, private getState?: () => GameState) {
    this.counts = [{ swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }, { swordsmen: 2, spearmen: 2, archers: 2, cavalry: 2 }];
    this.root = document.createElement('div');
    this.root.id = 'lab';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <canvas id="labMap"></canvas>
      <div class="labtop panel">
        <b>⚔️</b><span id="labTime">0:00</span>
        <div class="labspd">
          <button data-ls="0" aria-label="Pause">${IC.pause}</button><button data-ls="1">1×</button><button data-ls="2">2×</button><button data-ls="3">3×</button><button data-ls="10">10×</button>
        </div>
        <button class="x" data-lab="cam" aria-label="Auto camera" id="labCam">🎯</button>
        <button class="x" data-lab="close" aria-label="Close">✕</button>
      </div>
      <div id="labPanel" class="panel sheetp"></div>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('#labMap')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.panel = this.root.querySelector('#labPanel')!;
    this.root.addEventListener('click', e => this.onClick(e));
    this.setupInput();
    window.addEventListener('resize', () => { if (this.isOpen) this.fit(); });
  }

  open() {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.view = 'setup'; this.page = 'deploy';
    if (!this.army.length) this.rebuildArmy(); else this.preview();
    this.renderPanel();
    this.fit();
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.isOpen) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    this.onClose();
  }

  private side(i: 0 | 1): SquadSetup[] { return UNITS.flatMap(u => Array.from({ length: this.counts[i][u] }, () => ({ unit: u, rank: this.ranks[i] }))); }
  /** The battle as deployed: your placed squads with their spots and arrows (no arrow = hold), the enemy in its automatic formation. */
  private setup(): BattleSetup {
    this.placedIdx = [];
    const mine: SquadSetup[] = [];
    this.army.forEach((a, i) => { if (a.placed) { this.placedIdx.push(i); mine.push({ unit: a.unit, rank: a.rank, x: a.x, y: a.y, path: a.path }); } });
    return { sides: [mine, this.side(1)], bonus: [this.colonyBonus(), {}], orders: [true, false], field: this.field };
  }

  /** New armies: everyone starts in the automatic formation, with no arrows (holding). */
  private rebuildArmy() {
    const auto = createBattle({ sides: [this.side(0), this.side(1)] }, this.seed);
    this.field = { W: auto.W, H: auto.H };
    this.army = this.side(0).map(q => ({ ...q, ax: 0, ay: 0, placed: true }));
    for (const q of auto.squads) if (q.side === 0) { const a = this.army[q.src]; a.ax = a.x = q.cx; a.ay = a.y = q.cy; }
    this.sel = -1;
    this.ground = null;
    this.preview();
    this.fit();
  }

  /** Your researched military techs (from the colony) help the red side. */
  private colonyBonus(): SideBonus {
    const s = this.getState?.();
    const out: SideBonus = {};
    if (!s) return out;
    for (const id of s.techs) {
      const e = CONFIG.tech.list.find(t => t.id === id)?.effect ?? {};
      for (const k of ['damage', 'armour', 'range', 'charge', 'morale'] as const) if (e[k]) out[k] = (out[k] ?? 0) + e[k]!;
    }
    return out;
  }
  private men(side: 0 | 1) { return UNITS.reduce((a, u) => a + this.counts[side][u] * CONFIG.military.units[u].size, 0); }
  private techNames(): string[] {
    const s = this.getState?.();
    if (!s) return [];
    return s.techs.map(id => CONFIG.tech.list.find(t => t.id === id)).filter(t => t && t.group === 'Military' && !t.effect.train).map(t => t!.name);
  }

  /** Show the armies standing in formation (before pressing Fight). */
  private preview() {
    const W = this.b?.W, H = this.b?.H;
    this.b = createBattle(this.setup(), this.seed);
    if (W !== this.b.W || H !== this.b.H) this.ground = null;
  }

  // ---------------- view: the field can be shown turned (your army at the bottom) to fill a phone screen ----------------
  private get FW() { return this.b?.W ?? this.field.W; }
  private get FH() { return this.b?.H ?? this.field.H; }
  /** Size of the field as shown (tiles). */
  private get VW() { return this.rot ? this.FH : this.FW; }
  private get VH() { return this.rot ? this.FW : this.FH; }
  /** Field point -> shown point (tiles). Turned: your side (left) is at the bottom, the enemy at the top. */
  private toV(x: number, y: number): Pt { return this.rot ? { x: y, y: this.FW - x } : { x, y }; }
  private fromV(u: number, v: number): Pt { return this.rot ? { x: this.FW - v, y: u } : { x: u, y: v }; }
  private ppt() { return (window.innerWidth / this.VW) * this.cam.zoom; }
  /** Field point -> screen point (CSS px). */
  private toScreen(x: number, y: number): Pt { const v = this.toV(x, y), k = this.ppt(); return { x: (v.x - this.cam.x) * k + window.innerWidth / 2, y: (v.y - this.cam.y) * k + window.innerHeight / 2 }; }
  private toField(sx: number, sy: number): Pt { const k = this.ppt(); return this.fromV(this.cam.x + (sx - window.innerWidth / 2) / k, this.cam.y + (sy - window.innerHeight / 2) / k); }
  /** The free screen area for the field (below the top bar, above the panel). */
  private freeArea() {
    const vh = window.innerHeight, top = 72;
    const panelTop = this.panel.getBoundingClientRect().top || vh * 0.6;
    return { top, bottom: Math.max(top + 140, panelTop - 8) };
  }

  /** Show the whole field above the bottom panel (turned to fill a phone screen when that helps). */
  private fit() {
    const d = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * d);
    this.canvas.height = Math.round(window.innerHeight * d);
    const vw = window.innerWidth, vh = window.innerHeight;
    this.rot = vh > vw && this.field.W > this.field.H; // tall screen, wide field: turn it
    const A = this.freeArea(), freeH = A.bottom - A.top;
    const zoom = Math.min(1, (freeH / this.VH) / (vw / this.VW));
    const ppt = (vw / this.VW) * zoom;
    this.cam = { x: this.VW / 2, y: this.VH / 2 + (vh / 2 - (A.top + freeH / 2)) / ppt, zoom };
    this.minZoom = Math.min(0.8, zoom);
    this.autoCam = this.view !== 'setup';
  }

  // ---------------- clicks ----------------
  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!el || el.disabled) return;
    if (el.dataset.ls) { this.speed = Number(el.dataset.ls); this.renderTop(); return; }
    const act = el.dataset.lab, side = Number(el.dataset.side) as 0 | 1, u = el.dataset.unit as UnitKind;
    switch (act) {
      case 'close': this.close(); return;
      case 'cam': this.autoCam = true; this.renderTop(); return;
      case 'add': this.counts[side][u] = Math.min(MAX_SQUADS, this.counts[side][u] + 1); this.rebuildArmy(); break;
      case 'add5': this.counts[side][u] = Math.min(MAX_SQUADS, this.counts[side][u] + 5); this.rebuildArmy(); break;
      case 'sub': this.counts[side][u] = Math.max(0, this.counts[side][u] - 1); this.rebuildArmy(); break;
      case 'rank': this.ranks[side] = (this.ranks[side] + 1) % CONFIG.military.ranks.length; for (const a of this.army) a.rank = this.ranks[0]; this.preview(); break;
      case 'preset': {
        const p = PRESETS[Number(el.dataset.i)];
        this.counts = [Object.fromEntries(UNITS.map(x => [x, p.a[x] ?? 0])) as Record<UnitKind, number>, Object.fromEntries(UNITS.map(x => [x, p.b[x] ?? 0])) as Record<UnitKind, number>];
        this.rebuildArmy(); break;
      }
      case 'page': this.page = this.page === 'army' ? 'deploy' : 'army'; this.renderPanel(); this.fit(); return;
      // deployment
      case 'auto': for (const a of this.army) { a.x = a.ax; a.y = a.ay; a.placed = true; a.path = undefined; } this.sel = -1; this.preview(); break;
      case 'clear': for (const a of this.army) { a.placed = false; a.path = undefined; } this.sel = -1; this.preview(); break;
      case 'forward': // every squad without an arrow gets a straight one toward the enemy
        for (const a of this.army) if (a.placed && !a.path?.length) a.path = [{ x: this.field.W * 0.78, y: a.y! }];
        this.preview(); break;
      case 'place': { const a = this.army[Number(el.dataset.i)]; a.placed = true; a.x = a.ax; a.y = a.ay; this.sel = Number(el.dataset.i); this.preview(); break; }
      case 'unplace': if (this.sel >= 0) { this.army[this.sel].placed = false; this.army[this.sel].path = undefined; this.sel = -1; this.preview(); } break;
      case 'unpath': if (this.sel >= 0) { this.army[this.sel].path = undefined; this.preview(); } break;
      case 'fight':
        if (!this.b || !this.b.squads.some(q => q.side === 0) || !this.b.squads.some(q => q.side === 1)) return;
        this.sel = -1; this.preview();
        this.view = 'fight'; this.autoCam = true; if (!this.speed) this.speed = 1; break;
      case 'stop': this.view = 'setup'; this.seed++; this.preview(); this.renderPanel(); this.fit(); return;
      case 'again': this.seed++; this.preview(); this.view = 'fight'; this.autoCam = true; break;
      case 'edit': this.view = 'setup'; this.seed++; this.preview(); this.renderPanel(); this.fit(); return;
      case 'batch': this.runBatch(50); break;
    }
    this.renderPanel();
  }

  private runBatch(total: number) {
    const setup = this.setup();
    if (!setup.sides[0].length || !setup.sides[1].length) return;
    this.batch = { done: 0, total, wins: [0, 0, 0], time: 0 };
    const chunk = () => {
      if (!this.batch || !this.isOpen) return;
      const t0 = performance.now();
      while (this.batch.done < total && performance.now() - t0 < 30) {
        const r = runBattle(setup, 1000 + this.batch.done * 7 + this.seed * 131);
        this.batch.wins[r.winner === -1 ? 2 : r.winner]++;
        this.batch.time += r.t;
        this.batch.done++;
      }
      this.renderPanel();
      if (this.batch.done < total) setTimeout(chunk, 0);
    };
    chunk();
  }

  // ---------------- panels ----------------
  private renderTop() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-ls]').forEach(b => b.classList.toggle('on', Number(b.dataset.ls) === this.speed));
    this.root.querySelector('#labCam')?.classList.toggle('on', this.autoCam);
  }

  private renderPanel() {
    this.renderTop();
    const rankName = (i: number) => CONFIG.military.ranks[i].name;
    if (this.view === 'setup' && this.page === 'deploy') {
      const tray = this.army.map((a, i) => a.placed ? '' : `<button class="traycard" data-lab="place" data-i="${i}"><img src="${unitIcon(a.unit)}" alt="" draggable="false"><span>${SHORT[a.unit]}</span></button>`).join('');
      const a = this.sel >= 0 ? this.army[this.sel] : null;
      const selRow = a ? `<div class="labsel"><img src="${unitIcon(a.unit)}" alt=""><b>${CONFIG.military.units[a.unit].name}</b><span>${a.path?.length ? 'follows its arrow' : 'holds its ground'}</span>
          ${a.path?.length ? '<button class="mini" data-lab="unpath">✕ Arrow</button>' : ''}<button class="mini" data-lab="unplace">To tray</button></div>` : '';
      const placed = this.army.filter(x => x.placed).length;
      this.panel.innerHTML = `${selRow || `<p class="labhint">Drag squads to move them. Tap one, then drag its <b>➜</b> to draw its path. <b>No arrow = it holds its ground.</b></p>`}
        ${tray ? `<div class="labtray">${tray}</div>` : ''}
        <div class="labtools"><button class="mini" data-lab="page">⚙ Armies</button><button class="mini" data-lab="auto">Auto</button><button class="mini" data-lab="clear">Clear</button><button class="mini" data-lab="forward">All ➜</button></div>
        <div class="labbtns"><button class="btn" data-lab="fight" ${placed ? '' : 'disabled'}>▶ Fight</button><button class="btn ghost" data-lab="batch">Run 50 battles</button></div>
        ${this.batchHtml()}`;
    } else if (this.view === 'setup') {
      const col = (side: 0 | 1) => `<div class="labcol"><div class="labside" style="color:${TEAM[side]}">${SIDE_NAME[side]}</div>
        ${UNITS.map(u => `<div class="labrow"><img src="${unitIcon(u)}" alt=""><span>${CONFIG.military.units[u].name}</span>
          <button data-lab="sub" data-side="${side}" data-unit="${u}">−</button><b>${this.counts[side][u]}</b><button data-lab="add" data-side="${side}" data-unit="${u}">+</button><button class="p5" data-lab="add5" data-side="${side}" data-unit="${u}">+5</button></div>`).join('')}
        <div class="labmen">${this.men(side)} soldiers</div>
        <button class="mini" data-lab="rank" data-side="${side}">Rank: ${rankName(this.ranks[side])}</button></div>`;
      this.panel.innerHTML = `<div class="labpresets">${PRESETS.map((p, i) => `<button class="chip panel" data-lab="preset" data-i="${i}">${p.name}</button>`).join('')}</div>
        <div class="labcols">${col(0)}${col(1)}</div>${this.techNames().length ? `<p style="font-size:12px">Your techs help red: <b>${this.techNames().join(', ')}</b></p>` : ''}
        <p style="font-size:12px">Changing the armies puts your squads back in the automatic formation.</p>
        <div class="labbtns"><button class="btn" data-lab="page">Done: deploy ➜</button></div>`;
    } else if (this.view === 'fight') {
      this.panel.innerHTML = `<div class="labbtns"><div class="labscore">${this.scoreHtml()}</div><button class="btn ghost" data-lab="stop">Stop</button></div>`;
    } else {
      const b = this.b!;
      const title = b.winner === 0 ? '🏆 You win!' : b.winner === 1 ? 'Defeat' : 'Draw';
      const rows = (side: Side) => b.squads.filter(q => q.side === side).map(q => {
        const n = squadAlive(b, q), size = q.members.length;
        const status = n === 0 ? 'wiped out' : q.fleeing ? `fled with ${n}` : `${n} standing`;
        return `<div class="labres"><img src="${unitIcon(q.unit)}" alt=""><span>${CONFIG.military.units[q.unit].name} #${q.num}</span><b>${n}/${size}</b><small>${status}</small></div>`;
      }).join('');
      this.panel.innerHTML = `<h3 style="color:${b.winner === 1 ? TEAM[1] : TEAM[0]}">${title} <small style="color:var(--muted);font-size:13px;margin-left:6px">${fmtTime(b.t)}</small></h3>
        <div class="labcols"><div class="labcol"><div class="labside" style="color:${TEAM[0]}">${SIDE_NAME[0]}</div>${rows(0)}</div>
        <div class="labcol"><div class="labside" style="color:${TEAM[1]}">${SIDE_NAME[1]}</div>${rows(1)}</div></div>
        <div class="labbtns"><button class="btn" data-lab="again">Fight again</button><button class="btn ghost" data-lab="edit">Change armies</button></div>`;
    }
  }

  private batchHtml() {
    const bt = this.batch;
    return bt ? (bt.done < bt.total ? `<p>Running ${bt.done}/${bt.total} battles…</p>`
      : `<p><b>${bt.total} battles:</b> <b style="color:${TEAM[0]}">You win ${Math.round(bt.wins[0] / bt.total * 100)}%</b> · <b style="color:${TEAM[1]}">Enemy ${Math.round(bt.wins[1] / bt.total * 100)}%</b> · Draw ${Math.round(bt.wins[2] / bt.total * 100)}% · avg ${fmtTime(bt.time / bt.total)}</p>`) : '';
  }

  private scoreHtml() {
    const b = this.b!;
    const side = (sd: Side) => {
      const qs = b.squads.filter(q => q.side === sd);
      const men = qs.reduce((a, q) => a + squadAlive(b, q), 0), total = qs.reduce((a, q) => a + q.members.length, 0);
      return `<b style="color:${TEAM[sd]}">${men}/${total}</b>`;
    };
    return `${side(0)} soldiers vs ${side(1)}`;
  }

  // ---------------- frame ----------------
  private frame(now: number) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const b = this.b;
    if (b && this.view === 'fight' && !b.over) {
      this.acc += dt * BATTLE_TPS * this.speed;
      let n = 0;
      while (this.acc >= 1 && n < 60) { stepBattle(b); this.acc -= 1; n++; }
      if (n >= 60) this.acc = 0;
      if (b.over) { this.view = 'result'; this.renderPanel(); }
      else if (Math.floor(b.t * 2) !== Math.floor((b.t - n / BATTLE_TPS) * 2)) {
        const sc = this.panel.querySelector('.labscore'); if (sc) sc.innerHTML = this.scoreHtml();
      }
    }
    const t = this.root.querySelector('#labTime')!;
    t.textContent = b ? fmtTime(b.t) : '0:00';
    this.edgeScroll(dt);
    this.draw(this.view === 'fight' ? this.acc : 1);
  }

  private draw(alpha: number) {
    const b = this.b; if (!b) return;
    const c = this.ctx, d = Math.min(3, window.devicePixelRatio || 1);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (this.autoCam) this.followAction(b, vw, vh);
    const ppt = this.ppt();                             // screen px per tile
    const p = (ppt / R) * d;                            // device px per art pixel
    const ox = (vw / 2 - this.cam.x * ppt) * d, oy = (vh / 2 - this.cam.y * ppt) * d; // screen spot of shown (0, 0)
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#3f532c'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    if (!this.ground) this.ground = paintField(b);
    if (this.rot) { c.setTransform(0, -p, p, 0, ox, oy + b.W * R * p); c.drawImage(this.ground, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0); }
    else c.drawImage(this.ground, ox, oy, b.W * R * p, b.H * R * p);
    const S = (x: number, y: number) => { const v = this.toV(x, y); return { x: ox + v.x * R * p, y: oy + v.y * R * p }; }; // device px
    if (this.view === 'setup') { // your half: where you can deploy
      const a = S(0, 0), z = S(b.W / 2, b.H), m0 = S(b.W / 2, 0), m1 = S(b.W / 2, b.H);
      c.fillStyle = 'rgba(192,57,43,.08)'; c.fillRect(Math.min(a.x, z.x), Math.min(a.y, z.y), Math.abs(z.x - a.x), Math.abs(z.y - a.y));
      c.strokeStyle = 'rgba(192,57,43,.55)'; c.lineWidth = 1.5 * d; c.setLineDash([6 * d, 5 * d]);
      c.beginPath(); c.moveTo(m0.x, m0.y); c.lineTo(m1.x, m1.y); c.stroke(); c.setLineDash([]);
    }

    // art pixel of a field point (in the shown, maybe turned, layout)
    const A = (x: number, y: number): [number, number] => { const v = this.toV(x, y); return [Math.floor(v.x * R), Math.floor(v.y * R)]; };
    // only draw what's on screen (big battles)
    const vx0 = this.cam.x - vw / 2 / ppt - 1, vx1 = this.cam.x + vw / 2 / ppt + 1, vy0 = this.cam.y - vh / 2 / ppt - 1, vy1 = this.cam.y + vh / 2 / ppt + 1;
    const onScreen = (x: number, y: number) => { const v = this.toV(x, y); return v.x > vx0 && v.x < vx1 && v.y > vy0 && v.y < vy1; };
    const drawP = (ax: number, ay: number, col: string) => {
      const sx = Math.round(ox + ax * p), sy = Math.round(oy + ay * p);
      c.fillStyle = col; c.fillRect(sx, sy, Math.round(ox + (ax + 1) * p) - sx, Math.round(oy + (ay + 1) * p) - sy);
    };
    // blood on the ground
    for (const m of b.marks) {
      if (!onScreen(m.x, m.y)) continue;
      const [ax, ay] = A(m.x, m.y);
      drawP(ax, ay, m.k < 0.5 ? '#6e1f1a' : '#55201b');
      if (m.k > 0.35) drawP(ax + (m.k > 0.7 ? 1 : -1), ay, '#7d2620');
    }
    // fallen soldiers (each lies a little differently, weapon dropped beside them)
    for (const s of b.soldiers) if (s.dead && onScreen(s.x, s.y)) { const [ax, ay] = A(s.x, s.y); drawCorpse(drawP, s, ax, ay); }
    // living soldiers, back to front (as shown)
    const live = b.soldiers.filter(s => !s.dead && !s.fled && onScreen(s.x, s.y)).map(s => {
      let x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
      if (s.lunge > 0) { x += Math.cos(s.lungeDir) * 0.12; y += Math.sin(s.lungeDir) * 0.12; }
      const [ax, ay] = A(x, y);
      return { s, ax, ay };
    }).sort((a, z) => a.ay - z.ay);
    for (const { s, ax, ay } of live) {
      const flip = (this.rot ? Math.sin(s.dir) : Math.cos(s.dir)) < -0.2; // face the way they're going, as shown
      drawSoldier(drawP, s, ax, ay, s.x !== s.px || s.y !== s.py, flip);
    }
    // arrows in flight (drawn along their main direction as shown)
    for (const a of b.arrows) {
      const k = Math.min(1, a.t / a.dur), [ax, ay] = A(a.x, a.y);
      if (k < 1) {
        const dv = this.rot ? { x: a.ty - a.sy, y: -(a.tx - a.sx) } : { x: a.tx - a.sx, y: a.ty - a.sy };
        const hz = Math.abs(dv.x) >= Math.abs(dv.y), sx = hz ? Math.sign(dv.x) || 1 : 0, sy = hz ? 0 : Math.sign(dv.y) || 1;
        drawP(ax, ay, '#d0d6de'); drawP(ax - sx, ay - sy, '#7a5434'); drawP(ax - 2 * sx, ay - 2 * sy, '#efe6d2');
      } else { drawP(ax, ay, '#7a5434'); drawP(ax, ay - 1, '#efe6d2'); } // stuck in the ground
    }
    // effects: dust kicked up by horses, blood from hits, sparks from blocked blows
    for (const f of b.fx) {
      const [ax, ay] = A(f.x, f.y), k = f.t / 0.6;
      if (f.kind === 'dust') {
        const r = Math.round(k * 2);
        const col = k < 0.5 ? 'rgba(196,170,120,.75)' : 'rgba(196,170,120,.4)';
        drawP(ax - r, ay, col); drawP(ax + r, ay - 1, col); drawP(ax, ay - r, col);
      } else if (f.kind === 'blood') {
        if (k < 0.5) { const r = Math.round(k * 4); drawP(ax - r, ay - 1 + r, '#b3261e'); drawP(ax + r, ay - r + 1, '#cf3a2c'); }
      } else if (k < 0.35) {
        drawP(ax, ay, '#fff6c8'); drawP(ax - 1, ay - 1, '#ffe07a'); drawP(ax + 1, ay + 1, '#ffe07a');
      }
    }
    this.drawOrders(b, S, d);
    // squad badges: unit symbol, filled from the bottom by the squad's average HP
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.font = `800 ${9.5 * d}px Nunito, system-ui, sans-serif`;
    const words = ppt >= 24; // zoomed far out (big battles): just the badges, no words
    for (const q of b.squads) {
      if (q.gone) continue;
      let sx = 0, sy = 0, n = 0, top = 1e9;
      const vs: Pt[] = [];
      for (const id of q.members) {
        const s = b.soldiers[id - 1];
        if (s.dead || s.fled) continue;
        const v = this.toV(s.px + (s.x - s.px) * alpha, s.py + (s.y - s.py) * alpha);
        vs.push(v); sx += v.x; sy += v.y; n++;
      }
      if (!n) continue;
      sx /= n; sy /= n;
      // sit just above the squad's middle (ignoring stragglers far away)
      for (const v of vs) if (Math.abs(v.y - sy) < 2.2) top = Math.min(top, v.y);
      const size = Math.round(Math.max(15, Math.min(24, ppt * 0.9)) * d);
      const bx = Math.round(ox + sx * R * p - size / 2), by = Math.round(oy + top * R * p - 8 * p - size);
      const hp = Math.max(0, Math.min(1, squadHp(b, q)));
      const shaky = wavering(q);
      const edge = q.broken ? '#e8a03a' : shaky && Math.floor(b.t * 3) % 2 ? '#f2d03a' : TEAM[q.side];
      c.fillStyle = 'rgba(15,15,25,.55)'; c.fillRect(bx + d, by + d, size, size);   // shadow
      c.fillStyle = '#f4f1ea'; c.fillRect(bx, by, size, size);                      // empty part
      const fh = Math.round(size * hp);
      c.fillStyle = q.broken ? '#f2c48a' : TEAM_LIGHT[q.side];
      c.fillRect(bx, by + size - fh, size, fh);                                     // HP fill
      c.strokeStyle = edge; c.lineWidth = 2 * d; c.strokeRect(bx + d, by + d, size - 2 * d, size - 2 * d);
      drawGlyph(c, q.unit, bx + size / 2, by + size / 2, Math.max(1, Math.floor(size / 9)));
      if (shaky && words) {
        c.lineWidth = 3 * d; c.strokeStyle = 'rgba(0,0,0,.65)'; c.fillStyle = '#ffe680';
        c.strokeText('Wavering', bx + size / 2, by + size + 2 * d); c.fillText('Wavering', bx + size / 2, by + size + 2 * d);
      }
      if (q.broken && words) {
        const left = Math.max(0, Math.ceil(CONFIG.battle.fightAfterBreakSeconds - (b.t - q.brokenAt)));
        const txt = q.fleeing ? 'Fleeing!' : `${left}s`;
        c.lineWidth = 3 * d; c.strokeStyle = 'rgba(0,0,0,.65)'; c.fillStyle = '#fff';
        c.strokeText(txt, bx + size / 2, by + size + 2 * d); c.fillText(txt, bx + size / 2, by + size + 2 * d);
      }
    }
    if (this.view === 'setup') this.drawHandles(d);
  }

  /** Arrows (paths) on the field: all of them while deploying, the rest of each path during the fight. */
  private drawOrders(b: BattleState, S: (x: number, y: number) => Pt, d: number) {
    const c = this.ctx;
    const arrow = (pts: Pt[], col: string, w: number, alpha: number) => {
      if (pts.length < 2) return;
      c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
      c.setLineDash([w * 2.2, w * 1.6]);
      c.beginPath(); pts.forEach((q, i) => { const v = S(q.x, q.y); if (i) c.lineTo(v.x, v.y); else c.moveTo(v.x, v.y); }); c.stroke(); c.setLineDash([]);
      const a = S(pts[pts.length - 1].x, pts[pts.length - 1].y), z = S(pts[pts.length - 2].x, pts[pts.length - 2].y);
      const ang = Math.atan2(a.y - z.y, a.x - z.x), h = w * 3.4;
      c.fillStyle = col; c.beginPath(); c.moveTo(a.x + Math.cos(ang) * h * 0.6, a.y + Math.sin(ang) * h * 0.6);
      c.lineTo(a.x + Math.cos(ang + 2.5) * h, a.y + Math.sin(ang + 2.5) * h); c.lineTo(a.x + Math.cos(ang - 2.5) * h, a.y + Math.sin(ang - 2.5) * h); c.fill();
      c.globalAlpha = 1;
    };
    if (this.view === 'setup') {
      this.army.forEach((a, i) => {
        if (!a.placed || !a.path?.length) return;
        const on = i === this.sel;
        arrow([{ x: a.x!, y: a.y! }, ...a.path], on ? '#ffffff' : TEAM[0], (on ? 3.4 : 2.6) * d, on ? 0.95 : 0.85);
      });
    } else {
      for (const q of b.squads) if (q.side === 0 && q.order === 'path' && !q.gone && !q.fleeing) arrow([{ x: q.mx, y: q.my }, ...q.path.slice(q.pathI)], TEAM_LIGHT[0], 2 * d, 0.55);
    }
  }

  /**
   * The selected squad's handles, drawn at a fixed size on screen (easy to hit at any zoom):
   * the ➜ knob in front of it (drag to draw a new arrow), the arrowhead (drag to extend/reshape the arrow),
   * and ✕ (delete the arrow).
   */
  private drawHandles(d: number) {
    this.hit = {};
    const a = this.sel >= 0 ? this.army[this.sel] : null;
    if (!a?.placed) return;
    const c = this.ctx, box = this.squadBox(this.sel);
    if (!box) return;
    const r = this.screenBox(box);
    c.strokeStyle = '#ffffff'; c.lineWidth = 2 * d; c.setLineDash([5 * d, 4 * d]);
    c.strokeRect((r.x0 - 6) * d, (r.y0 - 6) * d, (r.x1 - r.x0 + 12) * d, (r.y1 - r.y0 + 12) * d); c.setLineDash([]);
    const circle = (p: Pt, rad: number, ring: string) => {
      c.fillStyle = 'rgba(15,15,25,.4)'; c.beginPath(); c.arc(p.x * d + d, p.y * d + 2 * d, rad * d, 0, 7); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(p.x * d, p.y * d, rad * d, 0, 7); c.fill();
      c.strokeStyle = ring; c.lineWidth = 2.5 * d; c.stroke();
    };
    // the knob: just in front of the squad (toward the enemy, as shown)
    const f = this.rot ? { x: 0, y: -1 } : { x: 1, y: 0 };
    const mid = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, half = this.rot ? (r.y1 - r.y0) / 2 : (r.x1 - r.x0) / 2;
    const k = { x: mid.x + f.x * (half + 30), y: mid.y + f.y * (half + 30) };
    if (!a.path?.length) {
      c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2 * d; c.setLineDash([4 * d, 4 * d]);
      c.beginPath(); c.moveTo((mid.x + f.x * half) * d, (mid.y + f.y * half) * d); c.lineTo(k.x * d, k.y * d); c.stroke(); c.setLineDash([]);
    }
    circle(k, 17, TEAM[0]);
    const ang = Math.atan2(f.y, f.x), P = (u: number, v: number) => ({ x: (k.x + Math.cos(ang) * u - Math.sin(ang) * v) * d, y: (k.y + Math.sin(ang) * u + Math.cos(ang) * v) * d });
    c.fillStyle = TEAM[0]; c.beginPath(); const t1 = P(9, 0), t2 = P(-1, -7), t3 = P(-1, 7); c.moveTo(t1.x, t1.y); c.lineTo(t2.x, t2.y); c.lineTo(t3.x, t3.y); c.fill();
    c.lineWidth = 4 * d; c.strokeStyle = TEAM[0]; c.beginPath(); const q1 = P(-9, 0), q2 = P(0, 0); c.moveTo(q1.x, q1.y); c.lineTo(q2.x, q2.y); c.stroke();
    this.hit.knob = k;
    if (a.path?.length) {
      // arrowhead handle (drag to keep drawing from the end) and ✕ beside it
      const e = a.path[a.path.length - 1], h = this.toScreen(e.x, e.y);
      c.strokeStyle = '#ffffff'; c.lineWidth = 2.5 * d; c.beginPath(); c.arc(h.x * d, h.y * d, 15 * d, 0, 7); c.stroke();
      this.hit.head = h;
      const x = { x: h.x + 34, y: h.y - 28 };
      circle(x, 13, '#d6453d');
      c.strokeStyle = '#d6453d'; c.lineWidth = 2.6 * d; c.beginPath();
      c.moveTo((x.x - 5) * d, (x.y - 5) * d); c.lineTo((x.x + 5) * d, (x.y + 5) * d); c.moveTo((x.x + 5) * d, (x.y - 5) * d); c.lineTo((x.x - 5) * d, (x.y + 5) * d); c.stroke();
      this.hit.x = x;
    }
  }

  /** Where a squad is on the field (its soldiers' box, field tiles), from the preview battle. */
  private squadBox(i: number) {
    const q = this.bsquad(i); if (!q) return null;
    const b = this.b!;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id of q.members) { const s = b.soldiers[id - 1]; x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
    return { x0: x0 - 0.2, y0: y0 - 0.45, x1: x1 + 0.2, y1: y1 + 0.15 };
  }
  /** A field box on screen (CSS px). */
  private screenBox(b: { x0: number; y0: number; x1: number; y1: number }) {
    const a = this.toScreen(b.x0, b.y0), z = this.toScreen(b.x1, b.y1);
    return { x0: Math.min(a.x, z.x), y0: Math.min(a.y, z.y), x1: Math.max(a.x, z.x), y1: Math.max(a.y, z.y) };
  }
  /** The preview battle's squad for army entry i. */
  private bsquad(i: number) {
    const b = this.b; if (!b) return null;
    const k = this.placedIdx.indexOf(i); if (k < 0) return null;
    return b.squads.find(x => x.side === 0 && x.src === k) ?? null;
  }
  /** Your placed squad under a screen point (CSS px), within a fingertip (or -1). */
  private squadAtScreen(sx: number, sy: number): number {
    let best = -1, bd = Infinity;
    this.army.forEach((a, i) => {
      if (!a.placed) return;
      const box = this.squadBox(i); if (!box) return;
      const r = this.screenBox(box);
      const d = Math.hypot(Math.max(r.x0 - sx, 0, sx - r.x1), Math.max(r.y0 - sy, 0, sy - r.y1));
      if (d < 16 && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Battle camera: frame everyone still on the field, zoomed in as close as fits. */
  private followAction(b: BattleState, vw: number, vh: number) {
    // everyone still fighting (not fleeing); ignore the furthest 8% at each edge (stragglers)
    const xs: number[] = [], ys: number[] = [];
    for (const s of b.soldiers) {
      if (s.dead || s.fled || b.squads[s.squad - 1].fleeing) continue;
      const v = this.toV(s.x, s.y);
      xs.push(v.x); ys.push(v.y);
    }
    if (!xs.length) return;
    xs.sort((a, z) => a - z); ys.sort((a, z) => a - z);
    const cut = Math.floor(xs.length * 0.08);
    const x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
    const A = this.freeArea(), freeH = A.bottom - A.top;
    const pad = 2.2, VW = this.VW;
    const zx = VW / (x1 - x0 + pad * 2);                          // fit width
    const zy = (freeH / (vw / VW)) / (y1 - y0 + pad * 2);         // fit height
    const zoom = Math.max(this.minZoom, Math.min(maxZoom(VW) * 0.8, Math.min(zx, zy)));
    const ppt = (vw / VW) * zoom;
    const tx = (x0 + x1) / 2;
    const ty = (y0 + y1) / 2 + (vh / 2 - (A.top + freeH / 2)) / ppt; // centre in the free area above the panel
    const k = 0.08;
    this.cam.zoom += (zoom - this.cam.zoom) * k;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  // ---------------- dragging squads and drawing arrows ----------------

  /** Follow the finger: move the squad, or draw the arrow. */
  private dragTo(sx: number, sy: number) {
    const g = this.drag; if (!g) return;
    const w = this.toField(sx, sy), a = this.army[g.i], F = this.field;
    if (g.mode === 'path') {
      const pts = a.path!, last = pts.length ? pts[pts.length - 1] : { x: a.x!, y: a.y! };
      const x = Math.max(0.5, Math.min(F.W - 0.5, w.x)), y = Math.max(0.5, Math.min(F.H - 0.5, w.y));
      const step = Math.max(0.3, 10 / this.ppt()); // a point every ~10 screen px
      if (Math.hypot(x - last.x, y - last.y) > step) pts.push({ x, y });
    } else {
      // move (your half only); the arrow moves with the squad. Only this squad's soldiers move (smooth, no rebuild).
      const nx = Math.max(0.8, Math.min(F.W / 2 - 0.4, w.x + g.ox)), ny = Math.max(1, Math.min(F.H - 1, w.y + g.oy));
      const mx = nx - a.x!, my = ny - a.y!;
      if (!mx && !my) return;
      a.x = nx; a.y = ny;
      if (a.path) for (const p of a.path) { p.x += mx; p.y += my; }
      const q = this.bsquad(g.i);
      if (q) {
        q.cx += mx; q.cy += my; q.mx += mx; q.my += my;
        for (const id of q.members) { const s = this.b!.soldiers[id - 1]; s.x += mx; s.y += my; s.px = s.x; s.py = s.y; }
      }
    }
  }

  /** While dragging near a screen edge, scroll the field (so long arrows can go anywhere). */
  private edgeScroll(dt: number) {
    const f = this.finger; if (!this.drag || !f) return;
    const A = this.freeArea(), m = 44, vw = window.innerWidth;
    const ex = f.x < m ? -1 : f.x > vw - m ? 1 : 0;
    const ey = f.y < A.top + m ? -1 : f.y > A.bottom - m ? 1 : 0;
    if (!ex && !ey) return;
    const speed = 380 / this.ppt() * dt; // ~380 screen px per second
    this.cam.x = Math.max(0, Math.min(this.VW, this.cam.x + ex * speed));
    this.cam.y = Math.max(-2, Math.min(this.VH + 6, this.cam.y + ey * speed));
    this.dragTo(f.x, f.y);
  }

  /** Smooth a drawn arrow (finger wobble) and space its points evenly. */
  private smoothPath(start: Pt, pts: Pt[]): Pt[] {
    let line = [start, ...pts];
    for (let k = 0; k < 2; k++) { // Chaikin smoothing, keeping both ends
      const out: Pt[] = [line[0]];
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      out.push(line[line.length - 1]);
      line = out;
    }
    const even: Pt[] = [];
    let last = line[0];
    for (const p of line.slice(1)) if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.6) { even.push(p); last = p; }
    const end = line[line.length - 1];
    if (!even.length || even[even.length - 1] !== end) even.push(end);
    return even;
  }

  // ---------------- input: pan, zoom, deploy ----------------
  private setupInput() {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number } | null = null;
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const zmax = () => maxZoom(this.VW);
    let tapStart: { x: number; y: number } | null = null;
    const near = (p: Pt | undefined, x: number, y: number, r: number) => !!p && Math.hypot(p.x - x, p.y - y) < r;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { if (this.drag) this.endDrag(); const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom }; return; }
      tapStart = { x: e.clientX, y: e.clientY };
      if (this.view !== 'setup') return;
      // deployment: the selected squad's ✕, arrowhead or knob (fingertip-sized), or a squad to drag
      const sx = e.clientX, sy = e.clientY, H = this.hit;
      if (this.sel >= 0 && this.army[this.sel].placed) {
        const a = this.army[this.sel];
        if (a.path?.length && near(H.x, sx, sy, 24)) { a.path = undefined; this.preview(); this.renderPanel(); tapStart = null; return; }
        if (a.path?.length && near(H.head, sx, sy, 28)) { this.startDrag({ mode: 'path', i: this.sel, ox: 0, oy: 0, lx: 0, ly: 0 }, sx, sy); return; } // keep drawing from the end
        if (near(H.knob, sx, sy, 30)) { a.path = []; this.startDrag({ mode: 'path', i: this.sel, ox: 0, oy: 0, lx: 0, ly: 0 }, sx, sy); return; }
      }
      const i = this.squadAtScreen(sx, sy);
      if (i >= 0) {
        const a = this.army[i], w = this.toField(sx, sy);
        if (this.sel !== i) { this.sel = i; this.renderPanel(); }
        this.startDrag({ mode: 'move', i, ox: a.x! - w.x, oy: a.y! - w.y, lx: a.x!, ly: a.y! }, sx, sy);
      }
    });
    cv.addEventListener('pointermove', e => {
      const q = pts.get(e.pointerId); if (!q) return;
      const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
      if (this.drag && pts.size === 1) { this.finger = { x: e.clientX, y: e.clientY }; this.dragTo(e.clientX, e.clientY); return; }
      if (Math.abs(dx) + Math.abs(dy) > 0.5 && this.autoCam) { this.autoCam = false; this.renderTop(); }
      if (pts.size === 1) { this.cam.x -= dx / this.ppt(); this.cam.y -= dy / this.ppt(); }
      else if (pinch) {
        // zoom around the middle of the two fingers
        const [a, b] = [...pts.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const before = this.toV(this.toField(mx, my).x, this.toField(mx, my).y);
        this.cam.zoom = Math.max(this.minZoom, Math.min(zmax(), pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        const after = this.toV(this.toField(mx, my).x, this.toField(mx, my).y);
        this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
      }
      this.cam.x = Math.max(0, Math.min(this.VW, this.cam.x)); this.cam.y = Math.max(-2, Math.min(this.VH + 6, this.cam.y));
    });
    // dragging a card from the tray onto the field: it lands where you let go (a tap puts it in its usual spot)
    let card: { i: number; x: number; y: number; on: boolean } | null = null;
    this.panel.addEventListener('pointerdown', e => {
      const el = (e.target as HTMLElement).closest('.traycard') as HTMLElement | null;
      if (el && this.view === 'setup') card = { i: Number(el.dataset.i), x: e.clientX, y: e.clientY, on: false };
    });
    window.addEventListener('pointermove', e => {
      if (!card) return;
      if (!card.on && Math.hypot(e.clientX - card.x, e.clientY - card.y) < 10) return;
      const top = this.panel.getBoundingClientRect().top;
      const a = this.army[card.i], F = this.field;
      if (e.clientY < top - 10) {
        const w = this.toField(e.clientX, e.clientY - 24);
        a.x = Math.max(0.8, Math.min(F.W / 2 - 0.4, w.x)); a.y = Math.max(1, Math.min(F.H - 1, w.y));
        if (!a.placed || !card.on) { a.placed = true; card.on = true; this.sel = card.i; this.preview(); }
        else { const sq = this.bsquad(card.i); if (sq) { const mx = a.x - sq.cx, my = a.y - sq.cy; sq.cx += mx; sq.cy += my; for (const id of sq.members) { const s = this.b!.soldiers[id - 1]; s.x += mx; s.y += my; s.px = s.x; s.py = s.y; } } }
      } else if (card.on) { a.placed = false; card.on = false; this.preview(); } // dragged back onto the tray
    });
    const cardUp = () => {
      if (!card) return;
      const moved = card.on; card = null;
      if (moved) { this.preview(); this.renderPanel(); }
    };
    window.addEventListener('pointerup', cardUp); window.addEventListener('pointercancel', cardUp);

    const end = (e: PointerEvent) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (this.drag) { this.endDrag(); return; }
      // a tap on empty ground while deploying clears the selection
      if (this.view === 'setup' && tapStart && e.type === 'pointerup' && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 8 && this.sel >= 0) { this.sel = -1; this.renderPanel(); }
      tapStart = null;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.zoom = Math.max(this.minZoom, Math.min(zmax(), this.cam.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
  }

  private startDrag(g: NonNullable<BattleLab['drag']>, sx: number, sy: number) {
    this.drag = g; this.finger = { x: sx, y: sy };
    this.root.classList.add('dragging'); // the bottom panel fades out of the way
  }
  private endDrag() {
    const g = this.drag; this.drag = null; this.finger = null;
    this.root.classList.remove('dragging');
    if (!g) return;
    const a = this.army[g.i];
    if (g.mode === 'path') {
      // too short to mean anything: no arrow
      let len = 0, prev: Pt = { x: a.x!, y: a.y! };
      for (const q of a.path ?? []) { len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
      if (len < 1.2) a.path = undefined;
      else a.path = this.smoothPath({ x: a.x!, y: a.y! }, a.path!);
    }
    this.preview(); this.renderPanel();
  }
}

// little pixel symbols for squad badges (7 x 7)
const GLYPHS: Record<UnitKind, string[]> = {
  swordsmen: ['...x...', '...x...', '...x...', '...x...', '.xxxxx.', '...x...', '...x...'],
  spearmen: ['...x...', '..xxx..', '...x...', '...x...', '...x...', '...x...', '...x...'],
  archers: ['xx.....', 'x.x....', 'x..x.x.', 'xxxxxxx', 'x..x.x.', 'x.x....', 'xx.....'],
  cavalry: ['.....x.', '....xxx', 'xxxxxx.', 'xxxxx..', 'x...x..', 'x...x..', '.......'],
};
function drawGlyph(c: CanvasRenderingContext2D, u: UnitKind, cx: number, cy: number, k: number) {
  const g = GLYPHS[u];
  c.fillStyle = '#262b38';
  const x0 = Math.round(cx - 3.5 * k), y0 = Math.round(cy - 3.5 * k);
  for (let r = 0; r < 7; r++) for (let i = 0; i < 7; i++) if (g[r][i] === 'x') c.fillRect(x0 + i * k, y0 + r * k, k, k);
}

const SHORT: Record<UnitKind, string> = { swordsmen: 'Swords', spearmen: 'Spears', archers: 'Archers', cavalry: 'Horse' };
const MAX_SQUADS = 50; // per unit type, per side
/** Closest zoom: about 7 tiles across the screen. */
const maxZoom = (shownW: number) => Math.max(4, shownW / 7);

function fmtTime(t: number) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }

/** Flat grassy battlefield in the pixel style. */
function paintField(b: BattleState): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = b.W * R; cv.height = b.H * R;
  const g = cv.getContext('2d')!;
  g.fillStyle = PX.grass[0]; g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < cv.width * cv.height * 0.09; i++) {
    const x = Math.floor(hash(i, 1, 5) * cv.width), y = Math.floor(hash(i, 2, 5) * cv.height);
    g.fillStyle = PX.grass[1 + (i % 4)]; g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i, 3, 5) * cv.width), y = Math.floor(hash(i, 4, 5) * cv.height);
    g.fillStyle = PX.flowers[i % PX.flowers.length]; g.fillRect(x, y, 1, 1);
  }
  // faint edges show where each side flees
  g.fillStyle = 'rgba(192,57,43,.18)'; g.fillRect(0, 0, 3, cv.height);
  g.fillStyle = 'rgba(58,98,184,.18)'; g.fillRect(cv.width - 3, 0, 3, cv.height);
  return cv;
}

/** A fallen soldier lying on the ground, with their weapon beside them. */
function drawCorpse(P: (x: number, y: number, c: string) => void, s: BSoldier, ax: number, ay: number) {
  const h = hash(s.id, 7, 3), dir = h < 0.5 ? 1 : -1;
  if (s.unit === 'cavalry') {
    // a fallen horse with its rider
    for (let i = -2; i <= 2; i++) P(ax + i * dir, ay, '#6b4a2e');
    P(ax + 3 * dir, ay - 1, '#6b4a2e'); P(ax - 1 * dir, ay + 1, '#4a3320'); P(ax + 1 * dir, ay + 1, '#4a3320');
    P(ax - 2 * dir, ay - 1, TEAM[s.side]); P(ax - 3 * dir, ay - 1, PX.skin[0]);
    return;
  }
  P(ax - dir, ay, TEAM_DARK[s.side]); P(ax, ay, TEAM[s.side]); P(ax + dir, ay, PX.skin[0]); P(ax - 2 * dir, ay, '#3e3028');
  const w = hash(s.id, 8, 3);
  const wy = ay + (w < 0.5 ? 1 : -1), wx = ax + Math.round((w * 4) % 2) * dir;
  if (s.unit === 'spearmen') { for (let i = -1; i <= 2; i++) P(wx + i * dir, wy, '#8a6a42'); P(wx + 3 * dir, wy, '#c9ced6'); }
  else if (s.unit === 'archers') { P(wx, wy, '#8a6a42'); P(wx + dir, wy, '#8a6a42'); }
  else { P(wx, wy, '#c9ced6'); P(wx + dir, wy, '#c9ced6'); P(wx - dir, wy, '#6b4a2e'); }
}

/** One soldier in team colours (red = you, blue = enemy). Flashes white when hit. */
function drawSoldier(P: (x: number, y: number, c: string) => void, s: BSoldier, ax: number, ay: number, walking: boolean, flip: boolean) {
  const sp = SPRITES[s.unit];
  const h = sp.length, w = sp[0].length;
  const frame = walking ? Math.floor(s.step / 2) % 2 : -1;
  const x0 = -Math.floor(w / 2), y0 = -h + 1;
  for (let i = 1; i < w; i++) P(ax + x0 + i, ay + 1, 'rgba(0,0,0,.22)');
  for (let r = 0; r < h; r++) {
    let row = sp[r];
    if (r === h - 1 && frame >= 0) row = s.unit === 'cavalry' ? (frame ? '.N.N.' : 'N..N.') : (frame ? 'l..' : '..l');
    for (let i = 0; i < w; i++) {
      const ch = row[flip ? w - 1 - i : i];
      if (ch === '.') continue;
      let col = ch === 's' ? PX.skin[0] : ch === 'R' ? TEAM[s.side] : SP_COL[ch];
      if (s.flash > 0) col = '#ffffff';
      P(ax + x0 + i, ay + y0 + r, col);
    }
  }
}
