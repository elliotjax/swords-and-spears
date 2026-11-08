import type { BuildingKind } from '../config';

export const GRASS = 0;
export const FOREST = 1;

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number; y: number; w: number; h: number;
  workers: number[];    // villager ids assigned to work here
  residents: number[];  // villager ids living here
  food: number;         // lb stored here (farm waiting to be delivered, granary, town hall)
}

export type Mode = 'inside' | 'walk' | 'work' | 'idle';
export type Carry = 'basket' | 'logs' | 'coins' | null;
export interface Pt { x: number; y: number }

export interface Villager {
  id: number;
  x: number; y: number;      // position in tiles (float)
  px: number; py: number;    // previous tick position (for smooth drawing)
  home: number | null;       // building id
  job: number | null;        // building id
  mode: Mode;
  inside: number | null;     // building id while inside (or entering)
  goalKey: string;           // what the villager is currently trying to do
  goalB: number | null;      // goal building id
  goalKind: 'home' | 'job' | 'hall' | 'wander' | 'deliver';
  task: { to: number; lb: number } | null; // carrying food to a granary
  deliveries: number;        // food deliveries made today
  deliveryDay: number;
  backToWork: boolean;       // walking back to work after a delivery (still counts as working)
  way: Pt[];                 // free-walk points (around a building, to/from its door)
  path: number[];            // tiles to walk along
  approach: boolean;         // after the path, walk along the building to its door
  dest: Pt | null;           // work spot inside a work area
  timer: number;             // seconds to wait
  vis: number;               // 0..1 how visible (fades at doorways)
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
  traffic: Float32Array;     // foot traffic per tile (pathfinding prefers worn tiles)
  edges: Float32Array;       // foot traffic between neighbouring tiles (drawn as roads), 4 per tile
  occ: Int32Array;           // building id per tile, -1 = empty (rebuilt on load)
  buildings: Building[];
  villagers: Villager[];
  nextId: number;
  tick: number;
  wood: number;
  gold: number;
  // (food is stored in buildings: see Building.food)
  hallLevel: number;         // 1-based
  hallId: number | null;
  births: number;
  version: number;           // bumps whenever buildings change (for caches)
}
