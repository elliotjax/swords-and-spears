import { CONFIG, type BuildingKind } from './config';
import { Renderer, type ViewState } from './render/renderer';
import { clearSave, loadGame, saveGame } from './sim/save';
import { allAsleep, canPlace, getB, newGame, place, tick } from './sim/sim';
import type { GameState } from './sim/types';
import { setupInput } from './ui/input';
import { UI } from './ui/ui';

// =====================================================================
//  Game loop: runs the simulation at a fixed rate, draws every frame.
//  Speed (pause/1x/2x/3x) = how many simulation ticks run per second.
// =====================================================================

export class Game {
  s: GameState;
  renderer: Renderer;
  ui: UI;
  view: ViewState = { ghost: null, selected: null };
  speed = 1;
  dragging = false;
  private speedBeforeHide = 1;

  constructor() {
    this.renderer = new Renderer(document.getElementById('map') as HTMLCanvasElement);
    this.s = loadGame() ?? newGame();
    this.ui = new UI(this);
    this.centerStart();
  }

  setSpeed(n: number) { this.speed = n; }

  centerStart() {
    const R = this.renderer;
    const hall = getB(this.s, this.s.hallId);
    if (hall) { R.cam.x = hall.x + hall.w / 2; R.cam.y = hall.y + hall.h / 2 + 1; }
    else { R.cam.x = this.s.w / 2; R.cam.y = this.s.h / 2 + 1; }
    R.cam.zoom = 0.8;
  }

  centerOn(id: number) {
    const b = getB(this.s, id);
    if (!b) return;
    this.renderer.cam.x = b.x + b.w / 2;
    this.renderer.cam.y = b.y + b.h / 2 + 2; // a bit lower so the bottom panel doesn't cover it
  }

  place(kind: BuildingKind, x: number, y: number) {
    const b = place(this.s, kind, x, y);
    if (!b) return;
    this.ui.placing = null;
    this.view.ghost = null;
    if (kind === 'townHall') {
      this.ui.toast('Your colony is founded!');
      this.ui.cat = 'housing';
    } else this.ui.select(b.id);
    saveGame(this.s);
  }

  confirmPlacement() {
    const g = this.view.ghost;
    if (!g) return;
    const r = canPlace(this.s, g.kind, g.x, g.y);
    if (r.ok) this.place(g.kind, g.x, g.y);
    else this.ui.toast(r.reason!);
  }

  newGame() {
    clearSave();
    this.s = newGame();
    this.view = { ghost: null, selected: null };
    this.ui.placing = null;
    this.renderer.reset();
    this.centerStart();
    this.speed = 1;
    saveGame(this.s);
  }

  start() {
    const input = setupInput(this);
    const tps = CONFIG.time.ticksPerSecond;
    let last = performance.now();
    let acc = 0;
    let saveTimer = 0, uiTimer = 0;
    let realTime = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      realTime += dt;
      // while everyone is asleep, night runs faster (2x speed becomes 4x, 3x becomes 6x...)
      const night = allAsleep(this.s) ? CONFIG.schedule.nightSpeedMultiplier : 1;
      acc += dt * tps * this.speed * night;
      let n = 0;
      while (acc >= 1 && n < 24) { tick(this.s); acc -= 1; n++; }
      if (n >= 24) acc = 0; // device too slow: drop the backlog rather than spiral
      input.frame(dt);
      this.renderer.render(this.s, this.view, this.speed ? acc : 1, realTime);
      uiTimer += dt; saveTimer += dt;
      if (uiTimer > 0.25) { uiTimer = 0; this.ui.update(); }
      if (saveTimer > CONFIG.time.autosaveSeconds) { saveTimer = 0; saveGame(this.s); }
      requestAnimationFrame(frame);
    };
    this.ui.update(true);
    requestAnimationFrame(frame);

    // pause when the app is hidden; save straight away
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.speedBeforeHide = this.speed;
        this.speed = 0;
        saveGame(this.s);
      } else {
        this.speed = this.speedBeforeHide;
        last = performance.now();
      }
      this.ui.update(true);
    });
    window.addEventListener('pagehide', () => saveGame(this.s));
    window.addEventListener('resize', () => { this.renderer.resize(); });
  }
}

const game = new Game();
game.start();
// handy for testing in the browser console
(window as unknown as { game: Game }).game = game;
