import type { BuildingKind } from '../config';
import { buildCheck, canPlace, def, lockReason } from '../sim/sim';
import type { Game } from '../main';
import { buildingIcon } from './ui';

// Touch + mouse controls:
//  - one finger drag on the map: pan
//  - two fingers: pinch zoom
//  - tap a building: open its panel
//  - drag a building card up onto the map: place it (ghost shows valid/invalid)
//  - tap a card: placement mode with Place / Cancel buttons

const TAP_REACH_PX = 22; // a tap this close to a building (in screen px) still selects it
const TAP_SLOP_PX = 14;  // a finger can wobble this much and still count as a tap
const DRAG_LIFT = 0; // px the ghost sits above the finger (0 = building centred under the finger)

export function setupInput(game: Game) {
  const canvas = game.renderer.canvas;
  const R = game.renderer;
  const pts = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number; t: number } | null = null;
  let moved = false;
  let pinch: { d: number; zoom: number; wx: number; wy: number } | null = null;
  let movingGhost = false;

  const ghostAt = (kind: BuildingKind, sx: number, sy: number) => {
    const d = def(kind);
    const w = R.screenToWorld(sx, sy);
    return { kind, x: Math.round(w.x - d.w / 2), y: Math.round(w.y - d.h / 2) };
  };

  // ---------------- map gestures ----------------
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      moved = false;
      // in tap-placement mode, dragging that starts on the ghost moves it
      const g = game.view.ghost;
      if (game.ui.placing && g) {
        const w = R.screenToWorld(e.clientX, e.clientY), d = def(g.kind);
        movingGhost = w.x >= g.x - 0.5 && w.x <= g.x + d.w + 0.5 && w.y >= g.y - 0.5 && w.y <= g.y + d.h + 0.5;
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const w = R.screenToWorld(mx, my);
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: R.cam.zoom, wx: w.x, wy: w.y };
      moved = true; movingGhost = false;
    }
  });

  canvas.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > TAP_SLOP_PX) moved = true;
      if (!moved) return;
      if (movingGhost && game.view.ghost) {
        game.view.ghost = ghostAt(game.view.ghost.kind, e.clientX, e.clientY);
        return;
      }
      R.cam.x -= dx / R.ppt; R.cam.y -= dy / R.ppt;
      R.clampCam(game.s);
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      R.cam.zoom = pinch.zoom * (d / pinch.d);
      R.clampCam(game.s);
      // keep the world point under the fingers' midpoint fixed
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      R.cam.x = pinch.wx - (mx - R.vw / 2) / R.ppt;
      R.cam.y = pinch.wy - (my - R.vh / 2) / R.ppt;
      R.clampCam(game.s);
    }
  });

  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (!moved && downAt && e.type === 'pointerup') tap(e.clientX, e.clientY);
      downAt = null; movingGhost = false;
      game.ui.update(true);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const before = R.screenToWorld(e.clientX, e.clientY);
    R.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
    R.clampCam(game.s);
    const after = R.screenToWorld(e.clientX, e.clientY);
    R.cam.x += before.x - after.x; R.cam.y += before.y - after.y;
  }, { passive: false });

  function tap(sx: number, sy: number) {
    if (game.ui.placing && game.view.ghost) {
      game.view.ghost = ghostAt(game.view.ghost.kind, sx, sy);
      return;
    }
    // pick the nearest building within a fingertip's reach (easy to hit when zoomed out)
    const w = R.screenToWorld(sx, sy);
    const reach = TAP_REACH_PX / R.ppt; // in tiles
    let best: number | null = null, bd = Infinity;
    for (const b of game.s.buildings) {
      const dx = Math.max(b.x - w.x, 0, w.x - (b.x + b.w));
      const dy = Math.max(b.y - w.y, 0, w.y - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d <= reach && d < bd) { bd = d; best = b.id; }
    }
    game.ui.select(best);
  }

  // ---------------- dragging cards from the build menu ----------------
  const drag = document.createElement('img');
  drag.id = 'dragcard'; drag.className = 'hidden';
  document.body.appendChild(drag);
  let card: { kind: BuildingKind; id: number; x: number; y: number; el: HTMLElement } | null = null;
  let edgePan: { x: number; y: number } | null = null;

  document.getElementById('ui')!.addEventListener('pointerdown', e => {
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    card = { kind: el.dataset.kind as BuildingKind, id: e.pointerId, x: e.clientX, y: e.clientY, el };
  });

  window.addEventListener('pointermove', e => {
    if (!card || e.pointerId !== card.id) return;
    const dx = e.clientX - card.x, dy = e.clientY - card.y;
    if (!game.dragging) {
      if (dy < -12 && Math.abs(dy) > Math.abs(dx)) {
        const lock = lockReason(game.s, card.kind);
        if (lock) { game.ui.toast(lock === 'Coming soon' ? 'Coming in a later version' : `Unlocks at ${lock}`); card = null; return; }
        game.dragging = true;
        game.ui.placing = null;
        game.view.selected = null;
        try { card.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        drag.src = buildingIcon(card.kind);
        drag.classList.remove('hidden');
      } else return;
    }
    drag.style.left = e.clientX + 'px'; drag.style.top = e.clientY + 'px';
    const overMap = e.clientY < (document.getElementById('bottom')!.getBoundingClientRect().top);
    drag.style.opacity = overMap ? '0' : '.9';
    game.view.ghost = overMap ? ghostAt(card.kind, e.clientX, e.clientY - DRAG_LIFT) : null;
    // pan when the finger is near a screen edge
    const m = 36;
    edgePan = {
      x: e.clientX < m ? -1 : e.clientX > R.vw - m ? 1 : 0,
      y: e.clientY < 120 ? -1 : 0,
    };
    if (!edgePan.x && !edgePan.y) edgePan = null;
  });

  const cardUp = (e: PointerEvent) => {
    if (!card || e.pointerId !== card.id) return;
    const kind = card.kind;
    card = null; edgePan = null;
    if (!game.dragging) {
      if (e.type === 'pointerup') tapCard(kind);
      return;
    }
    game.dragging = false;
    drag.classList.add('hidden');
    const g = game.view.ghost;
    game.view.ghost = null;
    if (e.type === 'pointerup' && g) {
      const r = canPlace(game.s, g.kind, g.x, g.y);
      if (r.ok) game.place(g.kind, g.x, g.y);
      else game.ui.toast(r.reason!);
    }
    game.ui.update(true);
  };
  window.addEventListener('pointerup', cardUp);
  window.addEventListener('pointercancel', cardUp);

  function tapCard(kind: BuildingKind) {
    const lock = lockReason(game.s, kind);
    if (lock) { game.ui.toast(lock === 'Coming soon' ? 'Coming in a later version' : `Unlocks at ${lock}`); return; }
    const r = buildCheck(game.s, kind);
    if (!r.ok) { game.ui.toast(r.reason!); return; }
    game.ui.placing = kind;
    game.view.selected = null;
    game.view.ghost = ghostAt(kind, R.vw / 2, R.vh * 0.42);
    game.ui.update(true);
  }

  return {
    frame(dt: number) {
      if (edgePan && game.dragging) {
        R.cam.x += edgePan.x * dt * 8; R.cam.y += edgePan.y * dt * 8;
        R.clampCam(game.s);
      }
    },
  };
}
