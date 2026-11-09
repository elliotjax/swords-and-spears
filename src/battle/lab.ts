import { CONFIG, type UnitKind } from '../config';
import { PX, R, SPRITES, SP_COL } from '../render/pixel';
import { hash } from '../sim/rng';
import { unitIcon } from '../ui/ui';
import { IC } from '../ui/icons';
import {
  BATTLE_TPS, createBattle, runBattle, squadAlive, squadHp, stepBattle, wavering,
  type BattleSetup, type BattleState, type BSoldier, type Side, type SideBonus,
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
  private cam = { x: 0, y: 0, zoom: 1 };
  private autoCam = true; // follow the fighting until the player pans/zooms
  private raf = 0;
  private acc = 0;
  private last = 0;
  private batch: { done: number; total: number; wins: number[]; time: number } | null = null;
  private view: 'setup' | 'fight' | 'result' = 'setup';

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
    this.view = 'setup';
    this.preview();
    this.renderPanel();
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

  private setup(): BattleSetup {
    const side = (i: 0 | 1) => UNITS.flatMap(u => Array.from({ length: this.counts[i][u] }, () => ({ unit: u, rank: this.ranks[i] })));
    return { sides: [side(0), side(1)], bonus: [this.colonyBonus(), {}] };
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
    this.b = createBattle(this.setup(), this.seed);
    this.ground = null;
    this.fit();
  }

  private fit() {
    const d = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * d);
    this.canvas.height = Math.round(window.innerHeight * d);
    const W = this.b?.W ?? CONFIG.battle.fieldW, H = this.b?.H ?? CONFIG.battle.fieldH;
    this.cam = { x: W / 2, y: H / 2 + 2.2, zoom: 1 };
    this.autoCam = true;
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
      case 'add': this.counts[side][u] = Math.min(MAX_SQUADS, this.counts[side][u] + 1); this.preview(); break;
      case 'add5': this.counts[side][u] = Math.min(MAX_SQUADS, this.counts[side][u] + 5); this.preview(); break;
      case 'sub': this.counts[side][u] = Math.max(0, this.counts[side][u] - 1); this.preview(); break;
      case 'rank': this.ranks[side] = (this.ranks[side] + 1) % CONFIG.military.ranks.length; this.preview(); break;
      case 'preset': {
        const p = PRESETS[Number(el.dataset.i)];
        this.counts = [Object.fromEntries(UNITS.map(x => [x, p.a[x] ?? 0])) as Record<UnitKind, number>, Object.fromEntries(UNITS.map(x => [x, p.b[x] ?? 0])) as Record<UnitKind, number>];
        this.preview(); break;
      }
      case 'fight':
        if (!this.b || !this.b.squads.some(q => q.side === 0) || !this.b.squads.some(q => q.side === 1)) return;
        this.view = 'fight'; if (!this.speed) this.speed = 1; break;
      case 'stop': this.view = 'setup'; this.seed++; this.preview(); break;
      case 'again': this.seed++; this.preview(); this.view = 'fight'; break;
      case 'edit': this.view = 'setup'; this.seed++; this.preview(); break;
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
    if (this.view === 'setup') {
      const col = (side: 0 | 1) => `<div class="labcol"><div class="labside" style="color:${TEAM[side]}">${SIDE_NAME[side]}</div>
        ${UNITS.map(u => `<div class="labrow"><img src="${unitIcon(u)}" alt=""><span>${CONFIG.military.units[u].name}</span>
          <button data-lab="sub" data-side="${side}" data-unit="${u}">−</button><b>${this.counts[side][u]}</b><button data-lab="add" data-side="${side}" data-unit="${u}">+</button><button class="p5" data-lab="add5" data-side="${side}" data-unit="${u}">+5</button></div>`).join('')}
        <div class="labmen">${this.men(side)} soldiers</div>
        <button class="mini" data-lab="rank" data-side="${side}">Rank: ${rankName(this.ranks[side])}</button></div>`;
      const bt = this.batch;
      const batch = bt ? (bt.done < bt.total ? `<p>Running ${bt.done}/${bt.total} battles…</p>`
        : `<p><b>${bt.total} battles:</b> <b style="color:${TEAM[0]}">You win ${Math.round(bt.wins[0] / bt.total * 100)}%</b> · <b style="color:${TEAM[1]}">Enemy ${Math.round(bt.wins[1] / bt.total * 100)}%</b> · Draw ${Math.round(bt.wins[2] / bt.total * 100)}% · avg ${fmtTime(bt.time / bt.total)}</p>`) : '';
      this.panel.innerHTML = `<div class="labpresets">${PRESETS.map((p, i) => `<button class="chip panel" data-lab="preset" data-i="${i}">${p.name}</button>`).join('')}</div>
        <div class="labcols">${col(0)}${col(1)}</div>${this.techNames().length ? `<p style="font-size:12px">Your techs help red: <b>${this.techNames().join(', ')}</b></p>` : ''}${batch}
        <div class="labbtns"><button class="btn" data-lab="fight">▶ Fight</button><button class="btn ghost" data-lab="batch">Run 50 battles</button></div>`;
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
    this.draw(this.view === 'fight' ? this.acc : 1);
  }

  private draw(alpha: number) {
    const b = this.b; if (!b) return;
    const c = this.ctx, d = Math.min(3, window.devicePixelRatio || 1);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (this.autoCam) this.followAction(b, vw, vh);
    const ppt = (vw / b.W) * this.cam.zoom;             // screen px per tile
    const p = (ppt / R) * d;                            // device px per art pixel
    const ox = (vw / 2 - this.cam.x * ppt) * d, oy = (vh / 2 - this.cam.y * ppt) * d;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#3f532c'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    if (!this.ground) this.ground = paintField(b);
    c.drawImage(this.ground, ox, oy, b.W * R * p, b.H * R * p);

    const px = (x: number) => Math.floor(x * R);
    // only draw what's on screen (big battles)
    const vx0 = this.cam.x - vw / 2 / ppt - 1, vx1 = this.cam.x + vw / 2 / ppt + 1, vy0 = this.cam.y - vh / 2 / ppt - 1, vy1 = this.cam.y + vh / 2 / ppt + 1;
    const onScreen = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
    const drawP = (ax: number, ay: number, col: string) => {
      const sx = Math.round(ox + ax * p), sy = Math.round(oy + ay * p);
      c.fillStyle = col; c.fillRect(sx, sy, Math.round(ox + (ax + 1) * p) - sx, Math.round(oy + (ay + 1) * p) - sy);
    };
    // blood on the ground
    for (const m of b.marks) {
      if (!onScreen(m.x, m.y)) continue;
      const ax = px(m.x), ay = px(m.y);
      drawP(ax, ay, m.k < 0.5 ? '#6e1f1a' : '#55201b');
      if (m.k > 0.35) drawP(ax + (m.k > 0.7 ? 1 : -1), ay, '#7d2620');
    }
    // fallen soldiers (each lies a little differently, weapon dropped beside them)
    for (const s of b.soldiers) if (s.dead && onScreen(s.x, s.y)) drawCorpse(drawP, s, px(s.x), px(s.y));
    // living soldiers, back to front
    const live = b.soldiers.filter(s => !s.dead && !s.fled && onScreen(s.x, s.y)).sort((a, z) => a.y - z.y);
    for (const s of live) {
      let x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
      if (s.lunge > 0) { x += Math.cos(s.lungeDir) * 0.12; y += Math.sin(s.lungeDir) * 0.12; }
      drawSoldier(drawP, s, px(x), px(y), s.x !== s.px || s.y !== s.py);
    }
    // arrows
    for (const a of b.arrows) {
      const k = Math.min(1, a.t / a.dur), ax = px(a.x), ay = px(a.y);
      const dx = Math.sign(a.tx - a.sx) || 1;
      if (k < 1) { drawP(ax, ay, '#d0d6de'); drawP(ax - dx, ay, '#7a5434'); drawP(ax - 2 * dx, ay, '#efe6d2'); }
      else { drawP(ax, ay, '#7a5434'); drawP(ax, ay - 1, '#efe6d2'); } // stuck in the ground
    }
    // effects: dust kicked up by horses, blood from hits, sparks from blocked blows
    for (const f of b.fx) {
      const ax = px(f.x), ay = px(f.y), k = f.t / 0.6;
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
    // squad badges: unit symbol, filled from the bottom by the squad's average HP
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.font = `800 ${9.5 * d}px Nunito, system-ui, sans-serif`;
    const words = ppt >= 24; // zoomed far out (big battles): just the badges, no words
    for (const q of b.squads) {
      if (q.gone) continue;
      let sx = 0, sy = 0, n = 0, top = 1e9;
      for (const id of q.members) {
        const s = b.soldiers[id - 1];
        if (s.dead || s.fled) continue;
        const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
        sx += x; sy += y; n++;
      }
      if (!n) continue;
      sx /= n; sy /= n;
      // sit just above the squad's middle (ignoring stragglers far away)
      for (const id of q.members) { const s = b.soldiers[id - 1]; if (!s.dead && !s.fled && Math.abs(s.y - sy) < 2.2) top = Math.min(top, s.y); }
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
  }

  /** Battle camera: frame everyone still on the field, zoomed in as close as fits. */
  private followAction(b: BattleState, vw: number, vh: number) {
    // everyone still fighting (not fleeing); ignore the furthest 8% at each edge (stragglers)
    const xs: number[] = [], ys: number[] = [];
    for (const s of b.soldiers) {
      if (s.dead || s.fled || b.squads[s.squad - 1].fleeing) continue;
      xs.push(s.x); ys.push(s.y);
    }
    if (!xs.length) return;
    xs.sort((a, z) => a - z); ys.sort((a, z) => a - z);
    const cut = Math.floor(xs.length * 0.08);
    const x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
    const panelH = this.panel.getBoundingClientRect().height, top = 70;
    const freeH = Math.max(120, vh - panelH - top - 20);
    const pad = 2.2;
    const zx = b.W / (x1 - x0 + pad * 2);                         // fit width
    const zy = (freeH / (vw / b.W)) / (y1 - y0 + pad * 2);        // fit height
    const zoom = Math.max(1, Math.min(maxZoom(b) * 0.8, Math.min(zx, zy)));
    const ppt = (vw / b.W) * zoom;
    const tx = (x0 + x1) / 2;
    const ty = (y0 + y1) / 2 + (vh / 2 - (top + freeH / 2)) / ppt; // centre in the free area above the panel
    const k = 0.08;
    this.cam.zoom += (zoom - this.cam.zoom) * k;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  // ---------------- pan & zoom ----------------
  private setupInput() {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number } | null = null;
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const fw = () => this.b?.W ?? CONFIG.battle.fieldW, fh = () => this.b?.H ?? CONFIG.battle.fieldH;
    const zmax = () => this.b ? maxZoom(this.b) : 4;
    const ppt = () => (window.innerWidth / fw()) * this.cam.zoom;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom }; } });
    cv.addEventListener('pointermove', e => {
      const q = pts.get(e.pointerId); if (!q) return;
      const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 0.5 && this.autoCam) { this.autoCam = false; this.renderTop(); }
      if (pts.size === 1) { this.cam.x -= dx / ppt(); this.cam.y -= dy / ppt(); }
      else if (pinch) { const [a, b] = [...pts.values()]; this.cam.zoom = Math.max(0.8, Math.min(zmax(), pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); }
      this.cam.x = Math.max(0, Math.min(fw(), this.cam.x)); this.cam.y = Math.max(-2, Math.min(fh() + 6, this.cam.y));
    });
    const end = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.zoom = Math.max(0.8, Math.min(zmax(), this.cam.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
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

const MAX_SQUADS = 50; // per unit type, per side
/** Closest zoom: about 7 tiles across the screen. */
const maxZoom = (b: BattleState) => Math.max(4, b.W / 7);

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
function drawSoldier(P: (x: number, y: number, c: string) => void, s: BSoldier, ax: number, ay: number, walking: boolean) {
  const sp = SPRITES[s.unit];
  const h = sp.length, w = sp[0].length;
  const flip = Math.cos(s.dir) < -0.2;
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
