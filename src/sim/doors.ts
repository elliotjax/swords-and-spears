import type { BuildingKind } from '../config';

// Where each building's doorway is, in tiles from the building's top-left corner.
// Every door is on the front (bottom) side. Villagers walk right up to it before
// going inside, and come out of it when they leave.
export const DOORS: Record<BuildingKind, { x: number; y: number }> = {
  townHall: { x: 1.5, y: 2.74 },
  house: { x: 1, y: 1.78 },
  longhouse: { x: 1.5, y: 1.76 },
  manor: { x: 0.75, y: 2.74 },
  farm: { x: 1.5, y: 2.94 },       // the field gate
  granary: { x: 0.5, y: 1.88 },
  lumberCamp: { x: 1, y: 1.9 },
  market: { x: 1, y: 1.86 },
  tavern: { x: 1, y: 1.8 },
  chapel: { x: 1, y: 1.84 },
  barracks: { x: 1, y: 1.8 },
  trainingGrounds: { x: 1.5, y: 2.94 },
  palisade: { x: 0.5, y: 0.9 },
};
