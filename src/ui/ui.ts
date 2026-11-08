import { BUILD_MENU, CONFIG, type BuildingKind, type Category } from '../config';
import { drawBuilding } from '../render/draw';
import {
  addWorker, beds, birthBlock, birthRate, canPlace, canUpgradeHall, dayFrac, dayNumber, def, getB, granaryCap,
  houseCap, houseCount, idleCount, lockReason, population, presentWorkers, rates, remove,
  removeWorker, upgradeHall,
} from '../sim/sim';
import type { Building, GameState } from '../sim/types';
import type { Game } from '../main';
import { IC } from './icons';

type Tab = 'build' | 'villagers' | 'military' | 'tech' | 'map';

const iconCache = new Map<string, string>();
/** Picture of a building (roof from above) as an image URL, for cards and panels. */
export function buildingIcon(kind: BuildingKind): string {
  let url = iconCache.get(kind);
  if (url) return url;
  const d = def(kind);
  const cv = document.createElement('canvas');
  const W = 108, H = 80;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const scale = Math.min((W - 6) / d.w, (H - 6) / d.h);
  c.translate((W - d.w * scale) / 2, (H - d.h * scale) / 2);
  c.scale(scale, scale);
  if (kind === 'lumberCamp') { c.fillStyle = '#3f9a5f'; c.beginPath(); c.arc(d.w / 2, d.h / 2, d.w * 0.55, 0, 7); c.fill(); }
  drawBuilding(c, kind, 0, 0, d.w, d.h, { t: 0.3, level: 1, seed: 3 });
  url = cv.toDataURL();
  iconCache.set(kind, url);
  return url;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString());
const sign = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export class UI {
  root: HTMLElement;
  tab: Tab = 'build';
  cat: Category = 'housing';
  private lastSheet = '';
  private toastT = 0;
  private confirmRemove = 0;
  private confirmNew = false;
  menuOpen = false;
  pressing = false;
  /** Set by the input module: 'tap' placement mode shows a confirm bar */
  placing: BuildingKind | null = null;

  constructor(private game: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div id="status" class="panel"></div>
      <div id="topright">
        <div id="speeds" class="panel">
          <button data-speed="0" aria-label="Pause">${IC.pause}</button>
          <button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="3">3×</button>
        </div>
        <button id="alert" class="panel hidden"></button>
        <button id="hallChip" class="panel chip"></button>
        <div class="chips-r">
          <span id="dayChip" class="panel chip"></span>
          <button id="menuBtn" class="panel" data-act="menu" aria-label="Menu">${IC.menu}</button>
        </div>
      </div>
      <div id="banner" class="panel hidden"></div>
      <div id="toast"></div>
      <div id="bottom">
        <div id="sheet"></div>
        <nav id="mainbar">
          <button data-tab="build">${IC.build}Build</button>
          <button data-tab="villagers">${IC.villagers}Villagers</button>
          <button data-tab="military">${IC.military}Military</button>
          <button data-tab="tech">${IC.tech}Tech</button>
          <button data-tab="map">${IC.map}Grand Map</button>
        </nav>
      </div>`;
    this.root.addEventListener('click', e => this.onClick(e));
    // don't rebuild panels while a finger is down on them (it would eat the tap)
    this.root.addEventListener('pointerdown', () => { this.pressing = true; });
    window.addEventListener('pointerup', () => { this.pressing = false; });
    window.addEventListener('pointercancel', () => { this.pressing = false; });
  }

  get s(): GameState { return this.game.s; }

  toast(msg: string) {
    const t = document.getElementById('toast')!;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('show'), 1800);
  }

  select(id: number | null) {
    this.game.view.selected = id;
    this.confirmRemove = 0;
    this.menuOpen = false;
    if (id != null) this.tab = this.tab === 'villagers' ? 'villagers' : 'build';
    this.update(true);
  }

  // ---------------- click handling ----------------

  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!el || el.disabled) return;
    const s = this.s, g = this.game;
    if (el.dataset.speed) { g.setSpeed(Number(el.dataset.speed)); this.update(true); return; }
    if (el.dataset.tab) {
      const t = el.dataset.tab as Tab;
      this.tab = t; g.view.selected = null; this.menuOpen = false; this.placing = null; g.view.ghost = null;
      this.update(true); return;
    }
    if (el.dataset.cat) { this.cat = el.dataset.cat as Category; this.update(true); return; }
    if (el.id === 'hallChip') { if (s.hallId != null) { this.select(s.hallId); g.centerOn(s.hallId); } return; }
    if (el.id === 'alert') { this.alertAction(); return; }
    const act = el.dataset.act, id = Number(el.dataset.id);
    switch (act) {
      case 'menu': this.menuOpen = !this.menuOpen; g.view.selected = null; this.confirmNew = false; break;
      case 'close': g.view.selected = null; this.menuOpen = false; break;
      case 'add': if (!addWorker(s, id)) this.toast(idleCount(s) ? 'Building is full' : 'No idle villagers'); break;
      case 'sub': removeWorker(s, id); break;
      case 'goto': this.tab = 'villagers'; g.view.selected = id; g.centerOn(id); break;
      case 'upgrade': if (upgradeHall(s)) this.toast(`Town Hall is now Lv ${s.hallLevel}!`); break;
      case 'remove':
        if (this.confirmRemove === id) { remove(s, id); g.view.selected = null; this.toast('Building removed'); }
        else this.confirmRemove = id;
        break;
      case 'place': g.confirmPlacement(); break;
      case 'cancelPlace': this.placing = null; g.view.ghost = null; break;
      case 'newgame':
        if (this.confirmNew) { g.newGame(); this.menuOpen = false; this.confirmNew = false; }
        else this.confirmNew = true;
        break;
      case 'recenter': if (s.hallId != null) g.centerOn(s.hallId); this.menuOpen = false; break;
      case 'card': break; // handled by input (tap vs drag)
    }
    this.update(true);
  }

  private alertAction() {
    const a = this.currentAlert();
    if (!a) return;
    if (a.go === 'villagers') { this.tab = 'villagers'; this.game.view.selected = null; }
    if (a.go === 'housing' || a.go === 'food') { this.tab = 'build'; this.cat = a.go; this.game.view.selected = null; }
    if (a.go === 'hall' && this.s.hallId != null) { this.select(this.s.hallId); this.game.centerOn(this.s.hallId); }
    this.update(true);
  }

  // ---------------- alerts ----------------

  currentAlert(): { title: string; sub: string; level: 'bad' | 'warn'; go: string } | null {
    const s = this.s;
    if (s.hallId == null) return null;
    const r = rates(s);
    const homeless = s.villagers.filter(v => v.home == null).length;
    const openJobs = s.buildings.reduce((a, b) => a + Math.max(0, (def(b.kind).workers ?? 0) - b.workers.length), 0);
    const has = (k: string) => s.buildings.some(b => b.kind === k);
    if (!has('farm')) return { title: 'Build a Farm', sub: 'Your people need food', level: r.food < 0 && s.food <= 0.01 ? 'bad' : 'warn', go: 'food' };
    if (s.food <= 0.01 && r.food < 0) return { title: 'Starving!', sub: 'Granary empty. Assign farmers', level: 'bad', go: 'villagers' };
    if (r.food < 0) return { title: 'Food shortage', sub: `Food dropping ${fmt(-r.food)} lb/day`, level: 'warn', go: 'villagers' };
    if (homeless > 0 && houseCount(s) < houseCap(s)) return { title: 'Need houses', sub: `${homeless} villagers have no bed`, level: 'warn', go: 'housing' };
    if (idleCount(s) > 0 && openJobs > 0) return { title: `${idleCount(s)} idle villagers`, sub: 'Tap to give them jobs', level: 'warn', go: 'villagers' };
    if (houseCount(s) >= houseCap(s) && beds(s) <= population(s) && CONFIG.townHall.levels[s.hallLevel])
      return { title: 'Houses full', sub: 'Upgrade the Town Hall', level: 'warn', go: 'hall' };
    return null;
  }

  // ---------------- per-frame-ish update ----------------

  update(force = false) {
    const s = this.s;
    const r = rates(s);
    const cap = granaryCap(s);
    const pct = Math.round(Math.min(100, (s.food / cap) * 100));
    const pop = population(s);
    const br = birthRate(s);
    const fc = r.food >= 0 ? 'var(--good)' : 'var(--bad)';
    document.getElementById('status')!.innerHTML = `
      <div class="srow"><span class="ic">${IC.food}</span><span class="lb">Food</span>
        <span class="vl">${Math.floor(s.food)} lb<small style="color:${fc}">${sign(r.food)}/d</small></span></div>
      <div class="gbar"><i style="width:${pct}%;background:${pct < 20 ? 'var(--bad)' : 'var(--good)'}"></i></div>
      <div class="gnote">Granary ${pct}% full</div>
      <div class="srow"><span class="ic">${IC.wood}</span><span class="lb">Wood</span><span class="vl">${Math.floor(s.wood)}${r.wood ? `<small>+${fmt(r.wood)}/d</small>` : ''}</span></div>
      <div class="srow"><span class="ic">${IC.gold}</span><span class="lb">Gold</span><span class="vl">${Math.floor(s.gold)}<small>+${fmt(r.gold)}/d</small></span></div>
      <div class="srow"><span class="ic">${IC.people}</span><span class="lb">Villagers</span><span class="vl">${pop} / ${beds(s)}</span></div>
      <div class="srow"><span class="ic">${IC.baby}</span><span class="lb">Births</span><span class="vl" style="color:${br ? 'var(--good)' : 'var(--muted)'}">${fmt(br)}/day</span></div>
      <div class="srow"><span class="ic">${IC.idle}</span><span class="lb">Idle</span><span class="vl" style="color:var(--warn)">${idleCount(s)}</span></div>
      <div class="srow"><span class="ic">${IC.army}</span><span class="lb">Army</span><span class="vl">0% / ${Math.round(30)}%</span></div>`;

    document.querySelectorAll<HTMLButtonElement>('#speeds button').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.speed) === this.game.speed));

    const t = dayFrac(s);
    const sun = t < 0.08 || t > 0.8 ? '🌙' : '☀️';
    document.getElementById('dayChip')!.textContent = `${sun} Day ${dayNumber(s)}`;
    const hc = document.getElementById('hallChip')!;
    hc.textContent = `Town Hall Lv ${s.hallLevel}`;
    hc.classList.toggle('hidden', s.hallId == null);
    document.getElementById('dayChip')!.classList.toggle('hidden', s.hallId == null);

    const al = this.currentAlert();
    const ae = document.getElementById('alert')!;
    ae.classList.toggle('hidden', !al);
    if (al) {
      const html = `${al.level === 'bad' ? IC.warn : IC.warnAmber}<div><b>${al.title}</b><span>${al.sub}</span></div>`;
      if (ae.innerHTML !== html) ae.innerHTML = html;
      ae.classList.toggle('warn', al.level === 'warn');
    }

    const banner = document.getElementById('banner')!;
    banner.classList.toggle('hidden', s.hallId != null);
    banner.textContent = 'Drag the Town Hall onto open grass';

    document.querySelectorAll<HTMLButtonElement>('#mainbar button').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === this.tab));

    this.renderSheet(force);
  }

  private renderSheet(force: boolean) {
    if (this.game.dragging || (this.pressing && !force)) return;
    const html = this.sheetHtml();
    if (html === this.lastSheet) return;
    this.lastSheet = html;
    const sh = document.getElementById('sheet')!;
    const scroll = sh.querySelector('#cards')?.scrollLeft ?? 0;
    const pscroll = sh.querySelector('.sheetp')?.scrollTop ?? 0;
    sh.innerHTML = html;
    const cards = sh.querySelector('#cards');
    if (cards) cards.scrollLeft = scroll;
    const p = sh.querySelector('.sheetp');
    if (p) p.scrollTop = pscroll;
  }

  private sheetHtml(): string {
    const s = this.s, g = this.game;
    if (this.menuOpen) return this.menuHtml();
    if (this.placing) {
      const ok = g.view.ghost ? canPlace(s, g.view.ghost.kind, g.view.ghost.x, g.view.ghost.y) : { ok: false, reason: '' };
      return `<div class="panel placebar"><div class="msg">${ok.ok ? 'Tap the map to move it' : ok.reason}</div>
        <button class="btn ghost" data-act="cancelPlace">Cancel</button>
        <button class="btn" data-act="place" ${ok.ok ? '' : 'disabled'}>Place</button></div>`;
    }
    const sel = getB(s, g.view.selected);
    if (sel) return this.buildingHtml(sel);
    if (s.hallId == null) {
      return `<div id="cards">${this.cardHtml('townHall')}</div>`;
    }
    switch (this.tab) {
      case 'build': {
        const cats = BUILD_MENU.map(m => `<button class="cat panel ${m.cat === this.cat ? 'on' : ''}" data-cat="${m.cat}">${m.label}</button>`).join('');
        const menu = BUILD_MENU.find(m => m.cat === this.cat)!;
        return `<div id="cats">${cats}</div><div id="cards">${menu.kinds.map(k => this.cardHtml(k)).join('')}</div>`;
      }
      case 'villagers': return this.villagersHtml();
      case 'military': return this.soonHtml('Military', 'Squads, barracks and recruiting arrive in Milestone 4.');
      case 'tech': return this.soonHtml('Tech', 'The tech tree (bought with gold) arrives in Milestone 2.');
      case 'map': return this.soonHtml('Grand Map', 'The grand map, parties and tributaries arrive in Milestone 3.');
    }
  }

  private cardHtml(k: BuildingKind): string {
    const s = this.s, d = def(k);
    const lock = lockReason(s, k);
    const sel = this.game.view.ghost?.kind === k;
    let cost: string;
    if (lock) cost = `<span class="ct">${IC.lock} ${lock}</span>`;
    else if (k === 'townHall') cost = `<span class="ct" style="color:var(--good)">Free</span>`;
    else {
      const parts: string[] = [];
      if (d.cost.wood) parts.push(`<span class="ct wood ${s.wood < d.cost.wood ? 'bad' : ''}">${d.cost.wood}🪵</span>`);
      if (d.cost.gold) parts.push(`<span class="ct ${s.gold < d.cost.gold ? 'bad' : ''}">${d.cost.gold}🪙</span>`);
      cost = `<div style="display:flex;gap:4px">${parts.join('')}</div>`;
    }
    return `<button class="card panel ${lock ? 'locked' : ''} ${sel ? 'sel' : ''}" data-act="card" data-kind="${k}">
      <img src="${buildingIcon(k)}" alt=""><span class="nm">${d.name}</span>${cost}</button>`;
  }

  private buildingHtml(b: Building): string {
    const s = this.s, d = def(b.kind);
    const head = `<h3><img src="${buildingIcon(b.kind)}" alt="">${d.name}<button class="x" data-act="close" aria-label="Close">✕</button></h3>`;
    let body = '';
    if (b.kind === 'townHall') {
      const next = CONFIG.townHall.levels[s.hallLevel];
      const can = canUpgradeHall(s);
      body = `<p>Level <b>${s.hallLevel}</b> · Houses <b>${houseCount(s)} / ${houseCap(s)}</b></p>
        <p>Villagers visit the hall in the evening. Homeless villagers sleep here.</p>`;
      if (next?.upgradeCost) {
        const unlocks = Object.values(CONFIG.buildings).filter(x => x.unlockHallLevel === s.hallLevel + 1).map(x => x.name);
        body += `<p>Next level: house limit <b>${next.houseCap}</b>${unlocks.length ? `, unlocks <b>${unlocks.join(', ')}</b>` : ''}.</p>
          <button class="btn" data-act="upgrade" ${can.ok ? '' : 'disabled'}>Upgrade to Lv ${s.hallLevel + 1} · ${next.upgradeCost.wood} wood, ${next.upgradeCost.gold} gold</button>`;
      } else body += `<p><b>Max level for now.</b></p>`;
    } else if (d.beds) {
      body = `<p>Residents <b>${b.residents.length} / ${d.beds}</b></p>
        <div class="bar"><i style="width:${(b.residents.length / d.beds) * 100}%;background:#4f7fc4"></i></div>
        <p>New villagers are born in houses with a free bed while there's a food surplus.</p>`;
    } else if (d.workers) {
      const here = presentWorkers(s, b);
      const out = d.output!;
      const [res, unit] = out.food ? [out.food, 'lb food'] : out.wood ? [out.wood, 'wood'] : [out.gold!, 'gold'];
      const bonus = d.grassBonus ? ` (+${Math.round(d.grassBonus * 100)}% on grassland)` : '';
      const eff = Math.min(1, b.workers.length / d.workers);
      body = `<div class="row"><span class="lb">Workers</span><div class="stepper">
          <button data-act="sub" data-id="${b.id}" ${b.workers.length ? '' : 'disabled'}>−</button>
          <span class="n">${b.workers.length} / ${d.workers}</span>
          <button data-act="add" data-id="${b.id}" ${b.workers.length < d.workers && idleCount(s) ? '' : 'disabled'}>+</button></div></div>
        <div class="bar"><i style="width:${eff * 100}%"></i></div>
        <p>At work right now: <b>${here}</b> · Idle villagers: <b>${idleCount(s)}</b></p>
        <p>Full staff makes <b>${res} ${unit}/day</b>${bonus}. Each worker adds an equal share.</p>`;
    }
    if (b.kind !== 'townHall') {
      const confirm = this.confirmRemove === b.id;
      body += `<button class="btn danger" data-act="remove" data-id="${b.id}">${confirm ? 'Tap again to remove' : `Remove (refund ${Math.round(CONFIG.removeRefund * 100)}%)`}</button>`;
    }
    return `<div class="panel sheetp">${head}${body}</div>`;
  }

  private villagersHtml(): string {
    const s = this.s;
    const jobs = s.buildings.filter(b => def(b.kind).workers);
    const homeless = s.villagers.filter(v => v.home == null).length;
    const rows = jobs.map(b => {
      const d = def(b.kind);
      return `<div class="jobrow"><button class="nm" data-act="goto" data-id="${b.id}" style="text-align:left">${d.name}
          <small>${presentWorkers(s, b)} at work now</small></button>
        <div class="stepper"><button data-act="sub" data-id="${b.id}" ${b.workers.length ? '' : 'disabled'}>−</button>
        <span class="n">${b.workers.length} / ${d.workers}</span>
        <button data-act="add" data-id="${b.id}" ${b.workers.length < d.workers! && idleCount(s) ? '' : 'disabled'}>+</button></div></div>`;
    }).join('');
    return `<div class="panel sheetp"><h3>Villagers<button class="x" data-act="close" data-tab="build" aria-label="Close">✕</button></h3>
      <p>Population <b>${population(s)}</b> · Idle <b style="color:var(--warn)">${idleCount(s)}</b> · Homeless <b>${homeless}</b> · Born so far <b>${s.births}</b></p>
      <p>${birthBlock(s) ? `No births right now: <b style="color:var(--bad)">${birthBlock(s)}</b>` : `Births: about <b style="color:var(--good)">${fmt(birthRate(s))} per day</b>`}</p>
      ${rows || '<p>Build a Farm, Lumber Camp or Market to create jobs.</p>'}</div>`;
  }

  private soonHtml(title: string, text: string) {
    return `<div class="panel sheetp"><h3>${title}<button class="x" data-tab="build" aria-label="Close">✕</button></h3><p>${text}</p></div>`;
  }

  private menuHtml() {
    return `<div class="panel sheetp"><h3>Menu<button class="x" data-act="close" aria-label="Close">✕</button></h3>
      <p>The game saves automatically. Version ${CONFIG.version}.</p>
      <button class="btn ghost" data-act="recenter">Center on Town Hall</button>
      <button class="btn danger" data-act="newgame">${this.confirmNew ? 'Tap again: erase and start over' : 'New game'}</button></div>`;
  }
}
