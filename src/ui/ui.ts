import { BUILD_MENU, CONFIG, GOODS, type BuildingKind, type Cost, type Good, type Category, type UnitKind } from '../config';
import { buildingCanvas, drawPawn } from '../render/pixel';
import {
  addWorker, allAsleep, beds, carrierCount, deliveryLoss, birthBlock, birthRate, canPlace, canUpgradeHall, dayNumber, def, foodCap, foodStored, getB, hourOf,
  houseCap, houseCount, idleCount, lockReason, population, presentWorkers, rates, remove,
  removeWorker, spawnVillagers, upgradeHall, soldiers, soldierBeds, armyUpkeep, battleReady, rankOf,
  squadName, recruitBlock, recruit, disband, quickTown, avgHappiness, nearChapel, civilians,
  techBlock, techDef, startResearch, cancelResearch, hasTech, addGoods,
} from '../sim/sim';
import {
  amountOf, available, goodsIn, incoming, isBuilt, isSite, madeHere, siteHours, siteMaterials, siteNeed, siteProgress,
  siteWrightCap, stockCap, stockTotal,
} from '../sim/logistics';
import type { Building, GameState, Squad, Villager } from '../sim/types';
import type { Game } from '../main';
import { IC } from './icons';
import { BUILD_ID } from '../update';

type Tab = 'build' | 'villagers' | 'military' | 'tech' | 'map';

const iconCache = new Map<string, string>();
/** Picture of a building (roof from above) as an image URL, for cards and panels. */
export function buildingIcon(kind: BuildingKind): string {
  let url = iconCache.get(kind);
  if (url) return url;
  url = buildingCanvas(kind).toDataURL(); // pixel art; shown with crisp scaling (CSS)
  iconCache.set(kind, url);
  return url;
}

const unitCache = new Map<string, string>();
/** Picture of a soldier (seen from above, facing up) for cards and the formation. */
export function unitIcon(u: UnitKind): string {
  let url = unitCache.get(u);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const v = { unit: u, step: 0, dir: 0, carry: null, look: { tunic: 0, hair: 0, skin: 0 } } as unknown as Villager;
  drawPawn(c, v, 0, 0, u === 'boss' ? 3 : 8, u === 'cavalry' ? 34 : 30, 54, false);
  url = cv.toDataURL();
  unitCache.set(u, url);
  return url;
}

const GOOD_LABEL: Record<Good, string> = { wood: 'Wood', stone: 'Stone', furniture: 'Furniture' };
const GOOD_EMOJI: Record<Good, string> = { wood: '🪵', stone: '🪨', furniture: '🪑' };
const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString());
const sign = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export class UI {
  root: HTMLElement;
  tab: Tab = 'build';
  cat: Category = 'housing';
  private lastSheet = '';
  private toastT = 0;
  private techsSeen = -1;
  private sitesSeen = new Map<number, string>(); // building sites last time we looked (to say when they finish)
  private hallSeen = -1;
  private confirmRemove = 0;
  private confirmNew = false;
  menuOpen = false;
  pressing = false;
  private clockKey = '';
  milPage: 'overview' | 'recruit' = 'overview';
  private confirmDisband = 0;
  /** Set by the input module: 'tap' placement mode shows a confirm bar */
  placing: BuildingKind | null = null;

  constructor(private game: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div id="status" class="panel"></div>
      <div id="topright">
        <div id="timepanel" class="panel">
          <div class="clockrow"><span id="dial"></span>
            <div class="tt"><b id="dayTxt"></b><div class="tline"><span id="timeTxt"></span><span id="phase" class="phase"></span></div></div></div>
          <div id="speeds">
            <button data-speed="0" aria-label="Pause">${IC.pause}</button>
            <button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="3">3×</button>
          </div>
        </div>
        <button id="alert" class="panel hidden"></button>
        <div class="chips-r">
          <button id="hallChip" class="panel chip"></button>
          <button id="menuBtn" class="panel" data-act="menu" aria-label="Menu">${IC.menu}</button>
        </div>
      </div>
      ${CONFIG.showTestTools ? `<div id="testbar" class="panel" aria-label="Testing tools">
        <button data-speed="${CONFIG.testSpeed}" aria-label="${CONFIG.testSpeed}x speed">${IC.fast}<span>${CONFIG.testSpeed}×</span></button>
        <button data-act="testVillagers" aria-label="Add 10 villagers">${IC.addPeople}<span>+10</span></button>
        <button data-act="testGold" aria-label="Add 100 gold">${IC.gold}<span>+100</span></button>
        <button data-act="testWood" aria-label="Add goods">${IC.wood}<span>+Goods</span></button>
        <button data-act="testLab" aria-label="Battle Lab">${IC.swords}<span>Battle</span></button>
        <button data-act="testTown" aria-label="Build a starter town">${IC.town}<span>Town</span></button>
        <button data-act="testUnlock" id="unlockBtn" aria-label="Unlock everything">${IC.unlock}<span>Unlock</span></button>
      </div>` : ''}
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
    if (el.dataset.mil) { this.milPage = el.dataset.mil as 'overview' | 'recruit'; this.confirmDisband = 0; this.update(true); return; }
    if (el.id === 'hallChip') { if (s.hallId != null) { this.select(s.hallId); g.centerOn(s.hallId); } return; }
    if (el.id === 'alert') { this.alertAction(); return; }
    const act = el.dataset.act, id = Number(el.dataset.id);
    switch (act) {
      case 'menu': this.menuOpen = !this.menuOpen; g.view.selected = null; this.confirmNew = false; break;
      case 'close': g.view.selected = null; this.menuOpen = false; break;
      case 'add': if (!addWorker(s, id)) this.toast(idleCount(s) ? 'Building is full' : 'No idle villagers'); break;
      case 'sub': removeWorker(s, id); break;
      case 'goto': this.tab = 'villagers'; g.view.selected = id; g.centerOn(id); break;
      case 'upgrade': if (upgradeHall(s)) this.toast('Upgrade started: haulers and wrights are on it'); break;
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
      case 'testVillagers': this.toast(spawnVillagers(s, 10) ? '+10 villagers' : 'Place the Town Hall first'); break;
      case 'testGold': s.gold += 100; this.toast('+100 gold'); break;
      case 'testWood': {
        const n = addGoods(s, 'wood', 100) + addGoods(s, 'stone', 50) + addGoods(s, 'furniture', 10);
        this.toast(n ? '+100 wood, +50 stone, +10 furniture' : 'No room: build a Stockpile');
        break;
      }
      case 'testLab': g.openLab(); return;
      case 'testTown': { const n = quickTown(s); g.view.selected = null; if (s.hallId != null) g.centerOn(s.hallId); this.toast(`Starter town: ${n} buildings`); break; }
      case 'testUnlock': s.unlockAll = !s.unlockAll; this.toast(s.unlockAll ? 'Everything unlocked (testing)' : 'Normal progression'); break;
      case 'recruit': {
        const q = recruit(s, el.dataset.unit as UnitKind);
        if (q) this.toast(`${squadName(q)} recruited!`);
        break;
      }
      case 'research': {
        const t = techDef(el.dataset.tech ?? '');
        if (t && startResearch(s, t.id)) this.toast(`Researching ${t.name}`);
        break;
      }
      case 'cancelResearch': if (cancelResearch(s)) this.toast('Research stopped (gold refunded)'); break;
      case 'disband':
        if (this.confirmDisband === id) { disband(s, id); this.confirmDisband = 0; this.toast('Squad disbanded'); }
        else this.confirmDisband = id;
        break;
    }
    this.update(true);
  }

  private alertAction() {
    const a = this.currentAlert();
    if (!a) return;
    if (a.go === 'villagers') { this.tab = 'villagers'; this.game.view.selected = null; }
    if (a.go === 'housing' || a.go === 'food' || a.go === 'town') { this.tab = 'build'; this.cat = a.go; this.game.view.selected = null; }
    if (a.go.startsWith('select:')) { const id = Number(a.go.slice(7)); this.select(id); this.game.centerOn(id); }
    if (a.go === 'hall' && this.s.hallId != null) { this.select(this.s.hallId); this.game.centerOn(this.s.hallId); }
    this.update(true);
  }

  // ---------------- alerts ----------------

  currentAlert(): { title: string; sub: string; level: 'bad' | 'warn'; go: string } | null {
    const s = this.s;
    if (s.hallId == null) return null;
    const r = rates(s);
    const homeless = s.villagers.filter(v => v.home == null).length;
    const openJobs = s.buildings.reduce((a, b) => a + (isBuilt(b) ? Math.max(0, (def(b.kind).workers ?? 0) - b.workers.length) : 0), 0);
    const has = (k: string) => s.buildings.some(b => b.kind === k);
    const built = (k: string) => s.buildings.some(b => b.kind === k && isBuilt(b));
    if (!built('stockpile')) return { title: 'Build a Stockpile', sub: 'Haulers there carry all the materials', level: 'bad', go: 'town' };
    if (!built('wrights') && s.buildings.some(isSite)) return { title: "Build a Wright's Lodge", sub: 'Wrights build your buildings', level: 'bad', go: 'town' };
    if (!has('farm')) return { title: 'Build a Farm', sub: 'Your people need food', level: r.food < 0 && foodStored(s) <= 0.01 ? 'bad' : 'warn', go: 'food' };
    if (!built('granary') && !has('granary')) return { title: 'Build a Granary', sub: 'Farmers need somewhere to store food', level: 'warn', go: 'food' };
    const noKeeper = s.buildings.find(b => b.kind === 'granary' && isBuilt(b) && !b.workers.length);
    if (noKeeper) return { title: 'Granary has no keeper', sub: 'It can\'t take food. Assign 1 worker', level: 'warn', go: 'villagers' };
    if (foodStored(s) <= 0.01 && r.food < 0) return { title: 'Starving!', sub: 'Granary empty. Assign farmers', level: 'bad', go: 'villagers' };
    if (r.food < 0) return { title: 'Food shortage', sub: `Food dropping ${fmt(-r.food)} lb/day`, level: 'warn', go: 'villagers' };
    if (homeless > 0 && houseCount(s) < houseCap(s)) return { title: 'Need houses', sub: `${homeless} villagers have no bed`, level: 'warn', go: 'housing' };
    if (idleCount(s) > 0 && openJobs > 0) return { title: `${idleCount(s)} idle villagers`, sub: 'Tap to give them jobs', level: 'warn', go: 'villagers' };
    const fullShelf = s.buildings.find(b => { const g = madeHere(b), d = def(b.kind); return g && d.shelf && b.workers.length && amountOf(b, g) >= d.shelf - 0.5; });
    if (fullShelf) return { title: `${def(fullShelf.kind).name} is full`, sub: 'Work stopped: add haulers or a closer stockpile', level: 'warn', go: 'select:' + fullShelf.id };
    const pileFull = stockCap(s) && GOODS.reduce((a, g) => a + stockTotal(s, g), 0) >= stockCap(s) - 5;
    if (pileFull) return { title: 'Stockpiles are full', sub: 'Build another Stockpile', level: 'warn', go: 'town' };
    if (houseCount(s) >= houseCap(s) && beds(s) <= population(s) && CONFIG.townHall.levels[s.hallLevel])
      return { title: 'Houses full', sub: 'Upgrade the Town Hall', level: 'warn', go: 'hall' };
    return null;
  }

  // ---------------- per-frame-ish update ----------------

  update(force = false) {
    const s = this.s;
    const r = rates(s);
    const cap = foodCap(s), stored = foodStored(s);
    const pct = cap ? Math.round(Math.min(100, (stored / cap) * 100)) : 0;
    const pop = population(s);
    const br = birthRate(s);
    const fc = r.food >= 0 ? 'var(--good)' : 'var(--bad)';
    document.getElementById('status')!.innerHTML = `
      <div class="srow"><span class="ic">${IC.food}</span><span class="lb">Food</span>
        <span class="vl">${Math.floor(stored)} lb<small style="color:${fc}">${sign(r.food)}/d</small></span></div>
      <div class="gbar"><i style="width:${pct}%;background:${pct < 20 ? 'var(--bad)' : 'var(--good)'}"></i></div>
      <div class="gnote">Granary ${pct}% full</div>
      ${GOODS.map(g => `<div class="srow"><span class="ic">${IC[g]}</span><span class="lb">${GOOD_LABEL[g]}</span><span class="vl">${Math.floor(stockTotal(s, g))}${Math.abs(r[g]) > 0.05 ? `<small style="color:${r[g] < 0 ? 'var(--bad)' : 'inherit'}">${sign(r[g])}/d</small>` : ''}</span></div>`).join('')}
      <div class="gnote">Stockpiles ${Math.floor(GOODS.reduce((a, g) => a + stockTotal(s, g), 0))} / ${stockCap(s)}</div>
      <div class="srow"><span class="ic">${IC.gold}</span><span class="lb">Gold</span><span class="vl">${Math.floor(s.gold)}<small>+${fmt(r.gold)}/d</small></span></div>
      <div class="srow"><span class="ic">${IC.people}</span><span class="lb">Villagers</span><span class="vl">${civilians(s)} / ${beds(s)}</span></div>
      <div class="srow"><span class="ic">${IC.baby}</span><span class="lb">Births</span><span class="vl" style="color:${br ? 'var(--good)' : 'var(--muted)'}">${fmt(br)}/day</span></div>
      <div class="srow"><span class="ic">${IC.idle}</span><span class="lb">Idle</span><span class="vl" style="color:var(--warn)">${idleCount(s)}</span></div>
      <div class="srow"><span class="ic">${IC.army}</span><span class="lb">Army</span><span class="vl">${population(s) ? Math.round((soldiers(s) / population(s)) * 100) : 0}% / ${Math.round(CONFIG.military.armyCap * 100)}%</span></div>`;
    document.getElementById('unlockBtn')?.classList.toggle('on', s.unlockAll);

    document.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.speed) === this.game.speed));

    this.updateClock();
    const hc = document.getElementById('hallChip')!;
    hc.textContent = `Town Hall Lv ${s.hallLevel}${getB(s, s.hallId)?.site ? ' ⚒' : ''}`;
    hc.classList.toggle('hidden', s.hallId == null);

    if (s.techs.length > this.techsSeen) { const t = techDef(s.techs[s.techs.length - 1]); if (t && this.techsSeen >= 0) this.toast(`Research done: ${t.name}!`); }
    this.techsSeen = s.techs.length;
    // finished buildings and hall upgrades
    if (this.hallSeen > 0 && s.hallLevel > this.hallSeen) this.toast(`Town Hall is now Lv ${s.hallLevel}!`);
    this.hallSeen = s.hallLevel;
    for (const [id, name] of this.sitesSeen) {
      const b = getB(s, id);
      if (b && !b.site && b.kind !== 'townHall') this.toast(`${name} finished!`);
    }
    this.sitesSeen = new Map(s.buildings.filter(b => b.site).map(b => [b.id, def(b.kind).name]));

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

  /** The time + speed panel: a small clock dial, day, time, and what villagers are doing. */
  private updateClock() {
    const s = this.s, S = CONFIG.schedule;
    const started = s.hallId != null;
    const h = hourOf(s);
    const mins = Math.floor((h * 60) / 15) * 15; // shown in 15-minute steps
    const hh = Math.floor(mins / 60), mm = mins % 60;
    const night = h < 5.5 || h >= 19.5;
    const fast = allAsleep(s);
    const phase = h >= S.workStart && h < S.workEnd ? ['Work', 'work'] : h >= S.workEnd && h < S.sleepStart ? ['Free time', 'free'] : [fast ? 'Sleep ⏩' : 'Sleep', 'sleep'];
    const key = `${started}|${dayNumber(s)}|${mins}|${fast}`;
    if (key === this.clockKey) return;
    this.clockKey = key;
    const dn = dayNumber(s) - 1, Y = S.daysPerYear;
    document.getElementById('dayTxt')!.textContent = `Day ${(dn % Y) + 1}, Year ${Math.floor(dn / Y)}`;
    document.getElementById('timeTxt')!.textContent = started
      ? `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` : 'Not started';
    const ph = document.getElementById('phase')!;
    ph.textContent = started ? phase[0] : '';
    ph.className = 'phase ' + phase[1];
    ph.classList.toggle('hidden', !started);
    // dial: 12-hour face with an hour hand; the face is day-coloured or night-coloured
    const a = ((h % 12) / 12) * Math.PI * 2 - Math.PI / 2;          // hour hand
    const m = ((mins % 60) / 60) * Math.PI * 2 - Math.PI / 2;       // minute hand
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2;
      return `<circle cx="${16 + Math.cos(t) * 11.5}" cy="${16 + Math.sin(t) * 11.5}" r="${i % 3 ? 0.9 : 1.5}" fill="${night ? '#c9d2ee' : '#8a6a2a'}"/>`;
    }).join('');
    const icon = night
      ? '<path d="M19.5 9.5a5 5 0 1 0 3 8.5 4 4 0 0 1-3-8.5z" fill="#f4e3a3" opacity=".35"/>'
      : '';
    document.getElementById('dial')!.innerHTML = `<svg width="34" height="34" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="${night ? '#33406e' : '#fbe7a8'}" stroke="${night ? '#1f2848' : '#d9a21e'}" stroke-width="2"/>
      ${icon}${ticks}
      <line x1="16" y1="16" x2="${16 + Math.cos(a) * 8.5}" y2="${16 + Math.sin(a) * 8.5}" stroke="${night ? '#ffffff' : '#262b38'}" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="16" y1="16" x2="${16 + Math.cos(m) * 11}" y2="${16 + Math.sin(m) * 11}" stroke="${night ? '#ffffff' : '#262b38'}" stroke-width="1.3" stroke-linecap="round" opacity=".7"/>
      <circle cx="16" cy="16" r="2" fill="#d6453d"/></svg>`;
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
      case 'military': return this.militaryHtml();
      case 'tech': return this.techHtml();
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
      cost = `<div class="costs">${this.costHtml(d.cost)}</div>`;
    }
    return `<button class="card panel ${lock ? 'locked' : ''} ${sel ? 'sel' : ''}" data-act="card" data-kind="${k}">
      <img src="${buildingIcon(k)}" alt=""><span class="nm">${d.name}</span>${cost}</button>`;
  }

  /** Cost chips (red when there isn't enough free in the stockpiles). */
  private costHtml(c: Cost): string {
    const s = this.s;
    const parts: string[] = [];
    for (const g of GOODS) if (c[g]) parts.push(`<span class="ct ${g} ${available(s, g) < c[g]! ? 'bad' : ''}">${c[g]}${GOOD_EMOJI[g]}</span>`);
    if (c.gold) parts.push(`<span class="ct ${s.gold < c.gold ? 'bad' : ''}">${c.gold}🪙</span>`);
    return parts.join('');
  }

  /** Materials list for a site: delivered / needed (and on the way). */
  private materialsHtml(b: Building): string {
    const s = this.s;
    return GOODS.filter(g => siteNeed(s, b, g)).map(g => {
      const need = siteNeed(s, b, g), got = Math.min(need, Math.floor(amountOf(b, g))), way = incoming(s, b, g);
      return `<div class="mrow"><span class="ic">${IC[g]}</span><span class="lb">${GOOD_LABEL[g]}</span>
        <span class="vl">${got} / ${need}${way ? ` <small>+${way} on the way</small>` : ''}</span></div>
        <div class="bar thin"><i style="width:${(got / need) * 100}%;background:#b5803a"></i></div>`;
    }).join('');
  }

  /** A building that isn't finished yet (or the Town Hall being upgraded). */
  private siteHtml(b: Building): string {
    const s = this.s;
    const prog = siteProgress(s, b), mat = siteMaterials(s, b);
    const wr = s.villagers.filter(v => v.site === b.id);
    const working = wr.filter(v => v.inside === b.id && v.mode === 'work').length;
    const hasWrights = s.buildings.some(q => q.kind === 'wrights' && isBuilt(q) && q.workers.length);
    const hasHaulers = s.buildings.some(q => q.kind === 'stockpile' && isBuilt(q) && q.workers.length);
    let why = '';
    if (mat < 0.999 && !hasHaulers) why = 'No haulers: build a Stockpile and give it workers.';
    else if (mat < 0.999 && GOODS.some(g => siteNeed(s, b, g) - amountOf(b, g) - incoming(s, b, g) > 0.5 && stockTotal(s, g) < 1)) why = 'Waiting: the stockpiles have run out of something it needs.';
    else if (!hasWrights) why = "No wrights: build a Wright's Lodge and give it workers.";
    else if (prog >= mat - 0.01 && mat < 0.999) why = 'Waiting for haulers to bring materials.';
    return `<p><b>${b.site?.upgrade ? `Upgrading to Lv ${s.hallLevel + 1}` : 'Being built'}</b> · ${Math.floor(prog * 100)}% done</p>
      <div class="bar"><i style="width:${prog * 100}%;background:#8a8478"></i></div>
      <h4>Materials</h4>${this.materialsHtml(b) || '<p>None needed.</p>'}
      <p>Wrights here <b>${working}</b> (${wr.length} assigned, up to ${siteWrightCap(b)}) · Work ${fmt(Math.min(b.site!.work, siteHours(s, b)))} / ${fmt(siteHours(s, b))} wright-hours</p>
      ${why ? `<p><b style="color:var(--warn)">${why}</b></p>` : ''}
      <p style="font-size:12px">Haulers bring the materials from the stockpiles; wrights build as far as the materials that have arrived allow.</p>`;
  }

  private buildingHtml(b: Building): string {
    const s = this.s, d = def(b.kind);
    const head = `<h3><img src="${buildingIcon(b.kind)}" alt="">${d.name}<button class="x" data-act="close" aria-label="Close">✕</button></h3>`;
    let body = '';
    if (b.site && !b.site.upgrade) {
      body = this.siteHtml(b);
    } else if (b.kind === 'townHall') {
      const next = CONFIG.townHall.levels[s.hallLevel];
      const can = canUpgradeHall(s);
      body = `<p>Level <b>${s.hallLevel}</b> · Houses <b>${houseCount(s)} / ${houseCap(s)}</b></p>
        <p>Food stored here <b>${Math.floor(b.food)} / ${d.foodStorage} lb</b></p>
        <p>Villagers visit the hall in the evening. Homeless villagers sleep here.</p>`;
      if (b.site) body += this.siteHtml(b);
      else if (next?.upgradeCost) {
        const unlocks = Object.values(CONFIG.buildings).filter(x => x.unlockHallLevel === s.hallLevel + 1).map(x => x.name);
        body += `<p>Next level: house limit <b>${next.houseCap}</b>${unlocks.length ? `, unlocks <b>${unlocks.join(', ')}</b>` : ''}.</p>
          <p>Upgrade cost: <span class="costs">${this.costHtml(next.upgradeCost)}</span> (gold now; haulers bring the rest and wrights do the work)</p>
          <button class="btn" data-act="upgrade" ${can.ok ? '' : 'disabled'}>${can.ok ? `Upgrade to Lv ${s.hallLevel + 1}` : can.reason}</button>`;
      } else body += `<p><b>Max level for now.</b></p>`;
    } else if (d.storage) {
      const used = goodsIn(b), pct = Math.round((used / d.storage) * 100);
      body = `${this.stepperHtml(b, 'Haulers')}
        <p>Stored <b>${Math.floor(used)} / ${d.storage}</b> (${pct}% full)</p>
        <div class="bar"><i style="width:${pct}%;background:#b5803a"></i></div>
        ${GOODS.map(g => `<div class="mrow"><span class="ic">${IC[g]}</span><span class="lb">${GOOD_LABEL[g]}</span><span class="vl">${Math.floor(amountOf(b, g))}</span></div>`).join('')}
        <p>Haulers out working now: <b>${s.villagers.filter(v => v.job === b.id && v.haul).length}</b> of ${b.workers.length}</p>
        <p style="font-size:12px">Haulers carry materials to building sites first, then supplies to workshops, then collect goods from work buildings (fullest shelves first). Nearby jobs win.</p>`;
    } else if (b.kind === 'wrights') {
      const sites = s.buildings.filter(isSite);
      body = `${this.stepperHtml(b, 'Wrights')}
        <p>At a building site now: <b>${s.villagers.filter(v => v.job === b.id && v.site != null && v.inside === v.site).length}</b> · Building sites: <b>${sites.length}</b></p>
        ${sites.map(q => `<div class="mrow"><span class="ic">${IC.hammer}</span><span class="lb">${def(q.kind).name}${q.site?.upgrade ? ' upgrade' : ''}</span><span class="vl">${Math.floor(siteProgress(s, q) * 100)}%<small>${s.villagers.filter(v => v.site === q.id).length} wrights</small></span></div>`).join('')}
        <p style="font-size:12px">Wrights build anything you place. They go to the nearest site that has materials waiting (older sites first), up to ${CONFIG.build.wrightsPerTile * 4 | 0} on a small site, and stay until it's done.</p>`;
    } else if (d.foodStorage) {
      const pct = Math.round((b.food / d.foodStorage) * 100);
      body = `${d.workers ? this.stepperHtml(b) : ''}
        <p>Stored <b>${Math.floor(b.food)} / ${d.foodStorage} lb</b> (${pct}% full)</p>
        <div class="bar"><i style="width:${pct}%;background:#b5803a"></i></div>
        ${d.workers && !b.workers.length ? '<p><b style="color:var(--bad)">No keeper: this granary can\'t take food.</b> Assign 1 worker.</p>' : ''}
        <p>Farmers carry food here from the nearest farm. Your people eat from the Town Hall and granaries.</p>`;
    } else if (d.beds) {
      body = `<p>Residents <b>${b.residents.length} / ${d.beds}</b></p>
        <div class="bar"><i style="width:${(b.residents.length / d.beds) * 100}%;background:#4f7fc4"></i></div>
        <p>New villagers are born in houses with a free bed while there's a food surplus.</p>
        ${nearChapel(s, b) ? '<p>⛪ Near a chapel: residents are happier.</p>' : ''}`;
    } else if (d.workers) {
      const here = presentWorkers(s, b);
      const out = d.output!;
      const mg = madeHere(b);
      const [res, unit] = out.food ? [out.food, 'lb food'] : mg ? [out[mg]!, GOOD_LABEL[mg].toLowerCase()] : [out.gold!, 'gold'];
      const bonus = d.grassBonus ? ` (+${Math.round(d.grassBonus * 100)}% on grassland)` : '';
      const eff = Math.min(1, b.workers.length / d.workers);
      body = `${this.stepperHtml(b)}
        <div class="bar"><i style="width:${eff * 100}%"></i></div>
        <p>At work right now: <b>${here}</b> · Idle villagers: <b>${idleCount(s)}</b></p>
        <p>Full staff makes <b>${res} ${unit}/day</b>${bonus}. Each worker adds an equal share, only while actually working.</p>`;
      if (mg && d.shelf) {
        const have = amountOf(b, mg), full = have >= d.shelf - 0.5;
        body += `<p>Waiting here: <b style="color:${full ? 'var(--bad)' : 'inherit'}">${Math.floor(have)} / ${d.shelf}</b>${full ? ' · <b style="color:var(--bad)">Full! Work stops until haulers collect it</b>' : ' (haulers take it to a stockpile)'}</p>`;
      }
      if (d.input) for (const [ig, per] of Object.entries(d.input) as [Good, number][]) {
        const have = amountOf(b, ig);
        body += `<p>Uses <b>${per} ${ig}</b> per piece · In stock here <b style="color:${have < per ? 'var(--bad)' : 'inherit'}">${Math.floor(have)} / ${d.inputKeep}</b>${have < per ? ' · <b style="color:var(--bad)">Out of ' + ig + '!</b>' : ''}</p>`;
      }
      if (d.farmStorage) {
        const full = b.food >= d.farmStorage - 0.5;
        body += `<p>Waiting ${b.kind === 'farm' ? 'at the farm' : 'here'}: <b style="color:${full ? 'var(--bad)' : 'inherit'}">${Math.floor(b.food)} / ${d.farmStorage} lb</b>${full ? ' · <b style="color:var(--bad)">Full! Build a granary</b>' : ''}</p>
          <p><b>${carrierCount(b)}</b> of the farmers carry food to the nearest granary ${CONFIG.food.deliveriesPerDay}× per workday.
          Trips cost about <b style="color:${deliveryLoss(s, b) > 0.08 ? 'var(--bad)' : 'inherit'}">${Math.round(deliveryLoss(s, b) * 100)}%</b> of this farm's output. A closer granary costs less.</p>`;
      }
    }
    if (b.kind !== 'townHall') {
      const confirm = this.confirmRemove === b.id;
      const label = b.site ? (confirm ? 'Tap again to cancel it' : 'Cancel building (full refund)')
        : confirm ? (d.foodStorage ? 'Tap again: food inside is lost' : d.storage && goodsIn(b) ? 'Tap again: goods move to other stockpiles (if there is room)' : 'Tap again to remove') : `Remove (refund ${Math.round(CONFIG.removeRefund * 100)}%)`;
      body += `<button class="btn danger" data-act="remove" data-id="${b.id}">${label}</button>`;
    }
    return `<div class="panel sheetp">${head}${body}</div>`;
  }

  private stepperHtml(b: Building, label = 'Workers'): string {
    const d = def(b.kind), s = this.s;
    return `<div class="row"><span class="lb">${label}</span><div class="stepper">
      <button data-act="sub" data-id="${b.id}" ${b.workers.length ? '' : 'disabled'}>−</button>
      <span class="n">${b.workers.length} / ${d.workers}</span>
      <button data-act="add" data-id="${b.id}" ${b.workers.length < d.workers! && idleCount(s) ? '' : 'disabled'}>+</button></div></div>`;
  }

  private villagersHtml(): string {
    const s = this.s;
    const jobs = s.buildings.filter(b => def(b.kind).workers && isBuilt(b));
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
      <p>Happiness <b>${Math.round(avgHappiness(s))}%</b> (no effect yet: taverns and chapels raise it)</p>
      <p>Population <b>${population(s)}</b> · Idle <b style="color:var(--warn)">${idleCount(s)}</b> · Homeless <b>${homeless}</b> · Born so far <b>${s.births}</b></p>
      <p>${birthBlock(s) ? `No births right now: <b style="color:var(--bad)">${birthBlock(s)}</b>` : `Births: about <b style="color:var(--good)">${fmt(birthRate(s))} per day</b>`}</p>
      ${rows || '<p>Build a Farm, Lumber Camp or Market to create jobs.</p>'}</div>`;
  }

  // ---------------- military tab ----------------

  private militaryHtml(): string {
    const nav = (p: 'overview' | 'recruit', label: string, icon: string) =>
      `<button class="mnav ${this.milPage === p ? 'on' : ''}" data-mil="${p}">${icon}<span>${label}</span></button>`;
    const body = this.milPage === 'recruit' ? this.recruitHtml() : this.overviewHtml();
    return `<div class="panel sheetp milp"><h3>Military<button class="x" data-tab="build" aria-label="Close">✕</button></h3>
      <div class="milwrap"><div class="milnav">${nav('overview', 'Overview', IC.military)}${nav('recruit', 'Recruit', IC.addPeople)}</div>
      <div class="milbody">${body}</div></div></div>`;
  }

  private armyStats(): string {
    const s = this.s;
    const army = soldiers(s), pop = population(s);
    const pct = pop ? Math.round((army / pop) * 100) : 0, cap = Math.round(CONFIG.military.armyCap * 100);
    const ready = s.squads.filter(battleReady).reduce((a, q) => a + q.members.length, 0);
    return `<div class="mstats">
      <div><b>${army}</b><span>Army</span></div>
      <div><b>${ready}</b><span>Battle-ready</span></div>
      <div><b>${army - ready}</b><span>In training</span></div>
      <div><b>${pop}</b><span>Population</span></div>
      <div><b style="color:var(--warn)">${idleCount(s)}</b><span>Idle</span></div>
      <div><b style="color:var(--bad)">−${armyUpkeep(s)}</b><span>Gold/day</span></div>
    </div>
    <div class="row" style="margin:6px 0 2px"><span class="lb" style="font-size:12.5px">Army ${pct}% of people (cap ${cap}%)</span></div>
    <div class="bar capbar"><i style="width:${Math.min(100, (pct / cap) * 100)}%;background:${pct >= cap ? 'var(--bad)' : 'var(--accent)'}"></i></div>
    <p style="font-size:12px">Barracks space <b>${soldiers(s)} / ${soldierBeds(s)}</b> · Training grounds <b>${s.buildings.filter(b => b.kind === 'trainingGrounds').length}</b></p>`;
  }

  private overviewHtml(): string {
    const s = this.s, R = CONFIG.military.ranks;
    const rows = s.squads.map(q => {
      const r = rankOf(q), next = R[r + 1];
      const prog = next ? Math.min(1, (q.trainDays - R[r].days) / (next.days - R[r].days)) : 1;
      const confirm = this.confirmDisband === q.id;
      return `<div class="sqrow">
        <img src="${unitIcon(q.unit)}" alt="">
        <div class="sqinfo"><b>${squadName(q)}</b>
          <span>${q.members.length} soldiers · <b style="color:${battleReady(q) ? 'var(--good)' : 'var(--warn)'}">${R[r].name}</b>${next ? ` · ${Math.floor(q.trainDays)}/${next.days} days to ${next.name}` : ''}</span>
          <div class="bar"><i style="width:${prog * 100}%;background:${battleReady(q) ? 'var(--good)' : 'var(--warn)'}"></i></div></div>
        <button class="mini ${confirm ? 'danger' : ''}" data-act="disband" data-id="${q.id}">${confirm ? 'Sure?' : 'Disband'}</button>
      </div>`;
    }).join('');
    return `${this.armyStats()}
      <h4>Battle formation</h4>${this.formationHtml()}
      <h4>Squads</h4>${rows || '<p>No squads yet. Build a Barracks and Training Grounds, then recruit.</p>'}`;
  }

  /** Default formation: swordsmen in front, spearmen behind, archers at the back, cavalry on the flanks. */
  private formationHtml(): string {
    const s = this.s;
    const tok = (q: Squad) => `<div class="ftok ${battleReady(q) ? '' : 'raw'}" title="${squadName(q)}"><img src="${unitIcon(q.unit)}" alt=""><span>${q.members.length}</span></div>`;
    const of = (u: UnitKind) => s.squads.filter(q => q.unit === u);
    const cav = of('cavalry');
    const left = cav.filter((_, i) => i % 2 === 0), right = cav.filter((_, i) => i % 2 === 1);
    const line = (u: UnitKind, label: string) => `<div class="fline">${of(u).map(tok).join('') || `<span class="fempty">${label}</span>`}</div>`;
    if (!s.squads.length) return `<div class="field"><span class="fempty" style="margin:auto">No squads yet</span></div>`;
    return `<div class="field"><div class="fflank">${left.map(tok).join('')}</div>
      <div class="fcenter"><div class="fenemy">▲ enemy</div>${line('heavy', 'Heavy')}${line('swordsmen', 'Swordsmen')}${line('spearmen', 'Spearmen')}${line('archers', 'Archers')}</div>
      <div class="fflank">${right.map(tok).join('')}</div></div>
      <p style="font-size:11.5px;margin-top:4px">Faded squads are still recruits (not battle-ready). Arranging comes later.</p>`;
  }

  private recruitHtml(): string {
    const s = this.s;
    const cards = (Object.keys(CONFIG.military.units) as UnitKind[]).filter(u => !CONFIG.military.units[u].noRecruit).map(u => {
      const U = CONFIG.military.units[u];
      const why = recruitBlock(s, u);
      return `<div class="ucard"><img src="${unitIcon(u)}" alt="">
        <div class="uinfo"><b>${U.name}</b>
          <span>Squad of ${U.size} · <b style="color:var(--gold)">${U.cost} gold</b> · upkeep ${U.upkeep}/day</span>
          <span>Good vs <b>${U.goodVs}</b> · weak vs <b>${U.weakVs}</b></span>
          ${why ? `<span style="color:var(--bad);font-weight:800">${why}</span>` : ''}</div>
        <button class="mini go" data-act="recruit" data-unit="${u}" ${why ? 'disabled' : ''}>Recruit</button></div>`;
    }).join('');
    return `${this.armyStats()}<h4>Recruit a squad</h4>${cards}
      <p style="font-size:12px">Recruits come from idle villagers and move into the barracks. New squads start as Recruits and need ${CONFIG.military.ranks[1].days} days at the Training Grounds to be battle-ready.</p>`;
  }

  // ---------------- tech tab ----------------

  private techHtml(): string {
    const s = this.s;
    const cur = s.research ? techDef(s.research.id) : undefined;
    const top = cur
      ? `<div class="ucard techcur"><div class="uinfo"><b>Researching: ${cur.name}</b>
          <span>${cur.desc}</span>
          <div class="bar"><i style="width:${Math.min(100, (s.research!.days / cur.days) * 100)}%;background:var(--accent)"></i></div>
          <span>${(s.research!.days).toFixed(1)} / ${cur.days} days</span></div>
          <button class="mini" data-act="cancelResearch">Stop</button></div>`
      : `<p>Pick something to research. The Town Hall works on one thing at a time; you pay gold up front.</p>`;
    const groups = [...new Set(CONFIG.tech.list.map(t => t.group))];
    const body = groups.map(gname => {
      const rows = CONFIG.tech.list.filter(t => t.group === gname).map(t => {
        const done = hasTech(s, t.id), busy = s.research?.id === t.id;
        const why = techBlock(s, t.id);
        const btn = done ? `<span class="tdone">✓ Done</span>`
          : busy ? `<span class="tbusy">${Math.round((s.research!.days / t.days) * 100)}%</span>`
          : `<button class="mini go" data-act="research" data-tech="${t.id}" ${why ? 'disabled' : ''}>Research</button>`;
        const lock = !done && !busy && why && why !== 'Busy researching' ? `<span style="color:var(--bad);font-weight:800">${why}</span>` : '';
        return `<div class="ucard tech ${done ? 'isdone' : ''}"><div class="uinfo"><b>${t.name}</b><span>${t.desc}</span>
          ${done ? '' : `<span><b style="color:var(--gold)">${t.cost} gold</b> · ${t.days} days${t.hall > 1 ? ` · Hall Lv ${t.hall}` : ''}</span>`}${lock}</div>${btn}</div>`;
      }).join('');
      return `<h4>${gname}</h4>${rows}`;
    }).join('');
    return `<div class="panel sheetp"><h3>Tech<span class="tcount">${s.techs.length}/${CONFIG.tech.list.length}</span><button class="x" data-tab="build" aria-label="Close">✕</button></h3>
      ${top}${body}
      <p style="font-size:12px">Military techs make your squads stronger in battle (try them in the Battle Lab: they apply to the red side).</p></div>`;
  }

  private soonHtml(title: string, text: string) {
    return `<div class="panel sheetp"><h3>${title}<button class="x" data-tab="build" aria-label="Close">✕</button></h3><p>${text}</p></div>`;
  }

  private menuHtml() {
    return `<div class="panel sheetp"><h3>Menu<button class="x" data-act="close" aria-label="Close">✕</button></h3>
      <p>The game saves automatically. Version ${CONFIG.version} (build ${BUILD_ID}).</p>
      <button class="btn ghost" data-act="recenter">Center on Town Hall</button>
      <button class="btn danger" data-act="newgame">${this.confirmNew ? 'Tap again: erase and start over' : 'New game'}</button></div>`;
  }
}
