import type { BuildingKind } from '../config';

export const GRASS = 0;
export const FOREST = 1;

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number; y: number; w: number; h: number;
  workers: number[];    // villager ids assigned to work here
  residents: number[];  // villager ids living here
}

export type Mode = 'inside' | 'walk' | 'work' | 'idle';
export type Carry = 'basket' | 'logs' | 'coins' | null;

export interface Villager {
  id: number;
  x: number; y: number;      // position in tiles (float)
  px: number; py: number;    // previous tick position (for smooth drawing)
  home: number | null;       // building id
  job: number | null;        // building id
  mode: Mode;
  inside: number | null;     // building id while hidden inside
  goalKey: string;           // what the villager is currently trying to do
  goalB: number | null;      // goal building id
  goalKind: 'home' | 'job' | 'hall' | 'wander';
  path: number[];            // remaining tile indices to walk
  dest: { x: number; y: number } | null; // final free-move point (inside work area)
  timer: number;             // seconds to wait
  lastTile: number;
  hallDay: number;           // last day this villager visited the hall
  carry: Carry;
  look: { tunic: number; hair: number; skin: number };
  jitter: number;            // personal schedule offset
  ox: number; oy: number;    // small personal drawing offset so people don't overlap
  dir: number;               // facing angle (radians)
  step: number;              // walk animation phase
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: number;
  w: number; h: number;
  tiles: Uint8Array;
  traffic: Float32Array;
  occ: Int32Array;           // building id per tile, -1 = empty (rebuilt on load)
  buildings: Building[];
  villagers: Villager[];
  nextId: number;
  tick: number;
  wood: number;
  gold: number;
  granary: number;           // lb of food stored
  hallLevel: number;         // 1-based
  hallId: number | null;
  births: number;
  version: number;           // bumps whenever buildings change (for caches)
}
