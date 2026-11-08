import { rebuildDerived, SAVE_VERSION } from './sim';
import type { GameState } from './types';

const KEY = 'swords-and-spears-save';

export function saveGame(s: GameState) {
  try {
    const data = {
      ...s,
      tiles: Array.from(s.tiles).join(''),
      edgeToday: Array.from(s.edgeToday, t => Math.round(t * 10) / 10),
      edgeAvg: Array.from(s.edgeAvg, t => Math.round(t * 100) / 100),
      edgeLevel: Array.from(s.edgeLevel).join(''),
      edgeAge: Array.from(s.edgeAge),
      wear: Array.from(s.wear, t => Math.round(t * 100) / 100),
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
      edgeToday: Float32Array.from(d.edgeToday),
      edgeAvg: Float32Array.from(d.edgeAvg),
      edgeLevel: Uint8Array.from(String(d.edgeLevel), (c: string) => Number(c)),
      edgeAge: Uint8Array.from(d.edgeAge),
      wear: Float32Array.from(d.wear),
      occ: new Int32Array(0),
    };
    s.techs ??= []; s.research ??= null; // saves from before the tech tree
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
