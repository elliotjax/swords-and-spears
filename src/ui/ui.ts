import { BUILD_MENU, CONFIG, type BuildingKind, type Category, type UnitKind } from '../config';
import { buildingCanvas, drawPawn } from '../render/pixel';
import {
  addWorker, allAsleep, beds, carrierCount, deliveryLoss, birthBlock, birthRate, canPlace, canUpgradeHall, dayNumber, def, foodCap, foodStored, getB, hourOf,
  houseCap, houseCount, idleCount, lockReason, population, presentWorkers, rates, remove,
  removeWorker, spawnVillagers, upgradeHall, soldiers, soldierBeds, armyUpkeep, battleReady, rankOf,
  squadName, recruitBlock, recruit, disband, quickTown, avgHappiness, nearChapel, civilians,
  techBlock, techDef, startResearch, cancelResearch, hasTech,
} from '../sim/sim';
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
  drawPawn(c, v, 0, 0, 8, u === 'cavalry' ? 34 : 30, 54, false);
  url = cv.toDataURL();
  unitCache.set(u, url);
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
  private techsSeen = -1;
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
        <button data-act="testWood" aria-label="Add 100 wood">${IC.wood}<span>+100</span></button>
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
      case 'testVillagers': this.toast(spawnVillagers(s, 10) ? '+10 villagers' : 'Place the Town Hall first'); break;
      case 'testGold': s.gold += 100; this.toast('+100 gold'); break;
      case 'testWood': s.wood += 100; this.toast('+100 wood'); break;
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
    if (!has('farm')) return { title: 'Build a Farm', sub: 'Your people need food', level: r.food < 0 && foodStored(s) <= 0.01 ? 'bad' : 'warn', go: 'food' };
    if (!has('granary')) return { title: 'Build a Granary', sub: 'Farmers need somewhere to store food', level: 'warn', go: 'food' };
    const noKeeper = s.buildings.find(b => b.kind === 'granary' && !b.workers.length);
    if (noKeeper) return { title: 'Granary has no keeper', sub: 'It can\'t take food. Assign 1 worker', level: 'warn', go: 'villagers' };
    if (foodStored(s) <= 0.01 && r.food < 0) return { title: 'Starving!', sub: 'Granary empty. Assign farmers', level: 'bad', go: 'villagers' };
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
      <div class="srow"><span class="ic">${IC.wood}</span><span class="lb">Wood</span><span class="vl">${Math.floor(s.wood)}${r.wood ? `<small>+${fmt(r.wood)}/d</small>` : ''}</span></div>
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
    hc.textContent = `Town Hall Lv ${s.hallLevel}`;
    hc.classList.toggle('hidden', s.hallId == null);

    if (s.techs.length > this.techsSeen) { const t = techDef(s.techs[s.techs.length - 1]); if (t && this.techsSeen >= 0) this.toast(`Research done: ${t.name}!`); }
    this.techsSeen = s.techs.length;

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
        <p>Food stored here <b>${Math.floor(b.food)} / ${d.foodStorage} lb</b></p>
        <p>Villagers visit the hall in the evening. Homeless villagers sleep here.</p>`;
      if (next?.upgradeCost) {
        const unlocks = Object.values(CONFIG.buildings).filter(x => x.unlockHallLevel === s.hallLevel + 1).map(x => x.name);
        body += `<p>Next level: house limit <b>${next.houseCap}</b>${unlocks.length ? `, unlocks <b>${unlocks.join(', ')}</b>` : ''}.</p>
          <button class="btn" data-act="upgrade" ${can.ok ? '' : 'disabled'}>Upgrade to Lv ${s.hallLevel + 1} · ${next.upgradeCost.wood} wood, ${next.upgradeCost.gold} gold</button>`;
      } else body += `<p><b>Max level for now.</b></p>`;
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
      const [res, unit] = out.food ? [out.food, 'lb food'] : out.wood ? [out.wood, 'wood'] : [out.gold!, 'gold'];
      const bonus = d.grassBonus ? ` (+${Math.round(d.grassBonus * 100)}% on grassland)` : '';
      const eff = Math.min(1, b.workers.length / d.workers);
      body = `${this.stepperHtml(b)}
        <div class="bar"><i style="width:${eff * 100}%"></i></div>
        <p>At work right now: <b>${here}</b> · Idle villagers: <b>${idleCount(s)}</b></p>
        <p>Full staff makes <b>${res} ${unit}/day</b>${bonus}. Each worker adds an equal share.</p>`;
      if (d.farmStorage) {
        const full = b.food >= d.farmStorage - 0.5;
        body += `<p>Waiting at the farm: <b style="color:${full ? 'var(--bad)' : 'inherit'}">${Math.floor(b.food)} / ${d.farmStorage} lb</b>${full ? ' · <b style="color:var(--bad)">Full! Build a granary</b>' : ''}</p>
          <p><b>${carrierCount(b)}</b> of the farmers carry food to the nearest granary ${CONFIG.food.deliveriesPerDay}× per workday.
          Trips cost about <b style="color:${deliveryLoss(s, b) > 0.08 ? 'var(--bad)' : 'inherit'}">${Math.round(deliveryLoss(s, b) * 100)}%</b> of this farm's output. A closer granary costs less.</p>`;
      }
    }
    if (b.kind !== 'townHall') {
      const confirm = this.confirmRemove === b.id;
      body += `<button class="btn danger" data-act="remove" data-id="${b.id}">${confirm ? (d.foodStorage ? 'Tap again: food inside is lost' : 'Tap again to remove') : `Remove (refund ${Math.round(CONFIG.removeRefund * 100)}%)`}</button>`;
    }
    return `<div class="panel sheetp">${head}${body}</div>`;
  }

  private stepperHtml(b: Building): string {
    const d = def(b.kind), s = this.s;
    return `<div class="row"><span class="lb">Workers</span><div class="stepper">
      <button data-act="sub" data-id="${b.id}" ${b.workers.length ? '' : 'disabled'}>−</button>
      <span class="n">${b.workers.length} / ${d.workers}</span>
      <button data-act="add" data-id="${b.id}" ${b.workers.length < d.workers! && idleCount(s) ? '' : 'disabled'}>+</button></div></div>`;
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
      <div class="fcenter"><div class="fenemy">▲ enemy</div>${line('swordsmen', 'Swordsmen')}${line('spearmen', 'Spearmen')}${line('archers', 'Archers')}</div>
      <div class="fflank">${right.map(tok).join('')}</div></div>
      <p style="font-size:11.5px;margin-top:4px">Faded squads are still recruits (not battle-ready). Arranging comes later.</p>`;
  }

  private recruitHtml(): string {
    const s = this.s;
    const cards = (Object.keys(CONFIG.military.units) as UnitKind[]).map(u => {
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
