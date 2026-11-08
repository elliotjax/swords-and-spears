import type { BuildingKind, UnitKind } from '../config';

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
  goalKind: 'home' | 'job' | 'hall' | 'wander' | 'deliver' | 'errand';
  errandB: number | null;    // free time: the place currently being visited
  lastErrand: number | null; // the place just visited (don't go twice in a row)
  errandDay: number;         // day the evening route was finished
  evening: number;           // day of the current evening route
  stops: number;             // stops chosen so far this evening
  ateAt: number;             // day they last stopped at a granary
  tavernDay: number;         // last evening they visited a tavern
  chapelDay: number;         // last evening they visited a chapel
  squad: number | null;      // squad id if this villager is a soldier
  unit: UnitKind | null;     // soldier type (for drawing)
  trained: boolean;          // trained at the training grounds today
  task: { to: number; lb: number } | null; // carrying food to a granary
  deliveries: number;        // food deliveries made today
  deliveryDay: number;
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

export interface Squad {
  id: number;
  unit: UnitKind;
  num: number;               // "Spearmen #2"
  members: number[];         // villager ids
  trainDays: number;         // days of training so far (decides rank)
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: number;
  w: number; h: number;
  tiles: Uint8Array;
  // Roads. Links between neighbouring tiles: 4 per tile (east, south, south-east, south-west).
  edgeToday: Float32Array;   // crossings so far today
  edgeAvg: Float32Array;     // usual crossings per day (slow average)
  edgeLevel: Uint8Array;     // 0 none, 1 faint, 2 gravel trail, 3 gravel road
  edgeAge: Uint8Array;       // days since this link last changed level
  wear: Float32Array;        // per tile 0..1 (how worn; pathfinding prefers worn tiles)
  roadDay: number;           // last day the roads were updated
  roadVersion: number;       // bumps when roads change (renderer redraws)
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
  squads: Squad[];
  nextSquadNum: Partial<Record<UnitKind, number>>;
  unlockAll: boolean;        // testing cheat: no progression locks or house limit
  version: number;           // bumps whenever buildings change (for caches)
}
