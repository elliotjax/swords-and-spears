// =====================================================================
//  ALL BALANCE NUMBERS LIVE HERE. Tune freely, then save + push.
//  (Matches README section 12. Values are starting guesses.)
// =====================================================================

export type BuildingKind =
  | 'townHall' | 'hut' | 'house' | 'cottage' | 'longhouse' | 'manor'
  | 'farm' | 'lumberCamp' | 'market' | 'barracks' | 'palisade';

export type Category = 'housing' | 'food' | 'wood' | 'trade' | 'defense';
export type BadgeColor = 'green' | 'blue' | 'gold';

export interface BuildingDef {
  name: string;
  category: Category | null;      // null = not in the build menu (town hall)
  w: number; h: number;           // size in tiles
  cost: { wood: number; gold: number };
  allowedTiles: ('grass' | 'forest')[];
  beds?: number;                  // housing capacity
  workers?: number;               // job capacity
  minWorkers?: number;            // does nothing below this many present
  output?: { food?: number; wood?: number; gold?: number }; // per day at full staff
  grassBonus?: number;            // extra output fraction when on grassland
  isHouse?: boolean;              // counts toward the town hall house cap
  unlockHallLevel?: number;       // locked until this town hall level
  comingSoon?: boolean;           // shows a locked card, cannot be built in v1
  badge?: BadgeColor;
}

export const CONFIG = {
  version: '0.2.0',

  time: {
    dayLengthSeconds: 45,     // real seconds per game day at 1x
    ticksPerSecond: 20,       // simulation steps per real second at 1x
    speeds: [0, 1, 2, 3],
    autosaveSeconds: 15,      // real seconds between autosaves
  },

  // Daily schedule, as fractions of a day (0 = dawn, 1 = next dawn)
  schedule: {
    workStart: 0.06,          // villagers leave home for work
    workEnd: 0.66,            // villagers leave work
    sleepStart: 0.86,         // everyone heads home to sleep
    personalJitter: 0.05,     // each villager varies by up to this much
    hallVisitChance: 0.4,     // chance per evening to visit the town hall
    hallVisitSeconds: 3,      // game seconds spent inside the hall
    nightTint: 0.22,          // how dark the night gets (0 = off)
  },

  map: {
    width: 40,
    height: 40,
    forestAmount: 0.38,       // roughly the share of forest tiles
    forestScale: 7,           // bigger = larger forest blobs
    clearRadius: 5,           // grass circle kept clear at the map centre
  },

  start: {
    villagers: 12,
    wood: 200,
    gold: 100,
    granaryDays: 3,           // food in the granary at the start, in days of use
  },

  food: {
    perVillagerPerDay: 2,     // lb eaten per villager per day
    granaryDays: 5,           // granary holds this many days of food use
  },

  tax: {
    goldPerVillagerPerDay: 0.25,
  },

  births: {
    chancePerHousePerDay: 0.1, // per house with a free bed, while food surplus > 0
  },

  villagers: {
    walkTilesPerSecond: 2.0,  // game seconds (1x real time)
    forestWalkCost: 1.8,      // forest tiles are slower to path through
    wanderRadius: 3,          // idle villagers wander this far from the hall
  },

  // Desire paths: foot traffic wears roads into the ground
  paths: {
    trafficPerStep: 1,        // added each time a villager enters a tile
    decayPerDay: 0.12,        // share of traffic that fades each day
    faint: 4,                 // traffic needed to look faintly worn
    trail: 14,                // ...to look like a dirt trail
    road: 40,                 // ...to look like a well-worn road
    maxTraffic: 120,          // cap so roads fade in reasonable time
    preferWorn: 0.35,         // 0..1, how much pathfinding prefers worn tiles
    roadSpeedBonus: 0,        // e.g. 0.3 = 30% faster on roads (off for now)
  },

  townHall: {
    // index 0 = level 1
    levels: [
      { houseCap: 4 },
      { houseCap: 8, upgradeCost: { wood: 150, gold: 120 } },
      { houseCap: 14, upgradeCost: { wood: 300, gold: 300 } },
    ] as { houseCap: number; upgradeCost?: { wood: number; gold: number } }[],
  },

  removeRefund: 0.5,          // share of cost refunded when removing a building

  buildings: {
    townHall: {
      name: 'Town Hall', category: null, w: 3, h: 3,
      cost: { wood: 0, gold: 0 }, allowedTiles: ['grass'],
    },
    hut: {
      name: 'Hut', category: 'housing', w: 1, h: 1, cost: { wood: 15, gold: 0 },
      allowedTiles: ['grass'], beds: 2, isHouse: true, badge: 'blue',
    },
    house: {
      name: 'House', category: 'housing', w: 2, h: 2, cost: { wood: 25, gold: 0 },
      allowedTiles: ['grass'], beds: 4, isHouse: true, badge: 'blue',
    },
    cottage: {
      name: 'Cottage', category: 'housing', w: 2, h: 2, cost: { wood: 45, gold: 0 },
      allowedTiles: ['grass'], beds: 6, isHouse: true, unlockHallLevel: 2, badge: 'blue',
    },
    longhouse: {
      name: 'Longhouse', category: 'housing', w: 3, h: 2, cost: { wood: 70, gold: 0 },
      allowedTiles: ['grass'], beds: 8, isHouse: true, unlockHallLevel: 2, badge: 'blue',
    },
    manor: {
      name: 'Manor', category: 'housing', w: 3, h: 3, cost: { wood: 110, gold: 40 },
      allowedTiles: ['grass'], beds: 12, isHouse: true, unlockHallLevel: 3, badge: 'blue',
    },
    farm: {
      name: 'Farm', category: 'food', w: 3, h: 3, cost: { wood: 40, gold: 0 },
      allowedTiles: ['grass'], workers: 8, output: { food: 35 }, grassBonus: 0.25,
      badge: 'green',
    },
    lumberCamp: {
      name: 'Lumber Camp', category: 'wood', w: 2, h: 2, cost: { wood: 30, gold: 0 },
      allowedTiles: ['forest'], workers: 6, output: { wood: 20 }, badge: 'gold',
    },
    market: {
      name: 'Market', category: 'trade', w: 2, h: 2, cost: { wood: 60, gold: 0 },
      allowedTiles: ['grass'], workers: 4, output: { gold: 8 }, badge: 'green',
    },
    barracks: {
      name: 'Barracks', category: 'defense', w: 3, h: 2, cost: { wood: 80, gold: 0 },
      allowedTiles: ['grass'], comingSoon: true,
    },
    palisade: {
      name: 'Palisade', category: 'defense', w: 1, h: 1, cost: { wood: 10, gold: 0 },
      allowedTiles: ['grass'], comingSoon: true,
    },
  } as Record<BuildingKind, BuildingDef>,

  camera: {
    tilePx: 65,               // tile size on screen at default zoom
    minZoom: 0.35,
    maxZoom: 2.2,
  },
};

export const BUILD_MENU: { cat: Category; label: string; kinds: BuildingKind[] }[] = [
  { cat: 'housing', label: 'Housing', kinds: ['hut', 'house', 'cottage', 'longhouse', 'manor'] },
  { cat: 'food', label: 'Food', kinds: ['farm'] },
  { cat: 'wood', label: 'Wood', kinds: ['lumberCamp'] },
  { cat: 'trade', label: 'Trade', kinds: ['market'] },
  { cat: 'defense', label: 'Defense', kinds: ['barracks', 'palisade'] },
];
