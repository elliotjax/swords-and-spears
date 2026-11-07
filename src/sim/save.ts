import { rebuildDerived, SAVE_VERSION } from './sim';
import type { GameState } from './types';

const KEY = 'swords-and-spears-save';

export function saveGame(s: GameState) {
  try {
    const data = {
      ...s,
      tiles: Array.from(s.tiles).join(''),
      traffic: Array.from(s.traffic, t => Math.round(t * 10) / 10),
      occ: undefined,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.saveVersion !== SAVE_VERSION) return null;
    const s: GameState = {
      ...d,
      tiles: Uint8Array.from(String(d.tiles), (c: string) => Number(c)),
      traffic: Float32Array.from(d.traffic),
      occ: new Int32Array(0),
    };
    rebuildDerived(s);
    return s;
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
