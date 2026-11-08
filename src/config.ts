// =====================================================================
//  ALL BALANCE NUMBERS LIVE HERE. Tune freely, then save + push.
//  (Matches README section 12. Values are starting guesses.)
// =====================================================================

export type BuildingKind =
  | 'townHall' | 'hut' | 'house' | 'cottage' | 'longhouse' | 'manor'
  | 'farm' | 'granary' | 'lumberCamp' | 'market' | 'barracks' | 'palisade';

export type Category = 'housing' | 'food' | 'wood' | 'trade' | 'defense';
export type BadgeColor = 'green' | 'blue' | 'gold' | 'storage';

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
  foodStorage?: number;           // lb of food this building can store (granary, town hall)
  farmStorage?: number;           // lb a farm can hold before a farmer takes it to a granary
  unlockHallLevel?: number;       // locked until this town hall level
  comingSoon?: boolean;           // shows a locked card, cannot be built in v1
  badge?: BadgeColor;
}

export const CONFIG = {
  version: '0.7.0',

  time: {
    dayLengthSeconds: 300,    // real seconds per game day at 1x (5 minutes)
    ticksPerSecond: 20,       // simulation steps per real second at 1x
    speeds: [0, 1, 2, 3],
    autosaveSeconds: 15,      // real seconds between autosaves
  },

  // Daily schedule in hours (24-hour clock). The day starts at midnight.
  //  work 5-17, free time 17-20, sleep 20 until each worker's wake-up time
  //  (workers wake just early enough to walk to work by workStart)
  schedule: {
    workStart: 5,             // work begins (workers are already there)
    workEnd: 17,              // work ends (free time until sleep)
    sleepStart: 20,           // everyone heads home to sleep
    wakeBufferHours: 0.3,     // extra margin added to each worker's walk to work
    startHour: 6,             // time of day when a new colony is founded
    personalJitter: 0.2,      // hours each villager may be later going home in the evening
    nightSpeedMultiplier: 2,  // while everyone is asleep, time runs this many times faster
    daysPerYear: 24,          // "Day 1, Year 0" ... day 25 starts Year 1
    hallVisitSeconds: 6,      // (unused for now)
    nightTint: 0.24,          // how dark the night gets (0 = off)
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
    food: 100,                // lb of food stored in the Town Hall at the start
  },

  // Free time (workEnd to sleepStart): villagers make a route of short errands,
  // milling around in front of each place for a few seconds, then go home.
  errands: {
    places: ['home', 'townHall', 'market', 'granary'] as string[], // more later
    stayMinSeconds: 4,        // game seconds spent milling around at each stop...
    stayMaxSeconds: 8,        // ...up to this long
    millRange: 1,             // how far (tiles) they drift around in front of a place
    nearbyPreference: 3,      // bigger = less preference for nearby places (weight 1/(distance+this))
  },

  food: {
    perVillagerPerDay: 4,     // lb eaten per villager per day (eaten slowly during free time only)
    deliveriesPerDay: 4,      // trips each carrier makes to a granary per workday
    carrierShare: 0.25,       // share of a farm's workers who carry food (rounded up, at least 1)
                              // carriers take everything waiting at the farm; while they are away
                              // they don't farm, so far-away granaries cost output
  },

  tax: {
    goldPerVillagerPerDay: 1.5,
  },

  births: {
    chancePerHousePerDay: 1.2, // per house with a free bed, while food is going up
  },

  villagers: {
    walkTilesPerSecond: 2.0,  // game seconds (1x real time)
    forestWalkCost: 1.8,      // forest tiles are slower to path through
    wanderRadius: 3,          // idle villagers wander this far from the hall
    idlePauseMin: 4,          // idle villagers stand around this long (seconds)...
    idlePauseMax: 10,         // ...up to this long, then stroll somewhere else
    doorFadeSeconds: 0.4,     // how quickly villagers fade in/out at doorways
    dropOffSeconds: 1.5,      // time spent inside a granary dropping off food
  },

  // Desire paths: foot traffic wears roads into the ground.
  // Every step between two tiles is counted during the day. Roads only change
  // once per night (at updateHour), and slowly: at most one level every few days.
  paths: {
    trafficPerStep: 1,        // added each time a villager walks from one tile to the next
    updateHour: 2,            // roads update once a night at this hour (everyone's asleep)
    dailyAverage: 0.35,       // how quickly the "usual traffic" follows recent days (0..1)
    faint: 2,                 // usual crossings per day for a faint worn path
    trail: 6,                 // ...for a thin gravel trail
    road: 15,                 // ...for a wide gravel road
    downFactor: 0.5,          // a road drops a level when traffic falls below this share of its level
    upgradeDays: 2,           // a road can go up one level at most every this many days
    downgradeDays: 3,         // ...and down one level at most every this many days
    fadeInSeconds: 3,         // real seconds for overnight road changes to fade in
    preferWorn: 0.35,         // 0..1, how much pathfinding prefers worn paths
    roadSpeedBonus: 0,        // e.g. 0.3 = 30% faster on full roads (off for now)
  },

  townHall: {
    // index 0 = level 1
    levels: [
      { houseCap: 4 },
      { houseCap: 8, upgradeCost: { wood: 150, gold: 120 } },
      { houseCap: 14, upgradeCost: { wood: 300, gold: 300 } },
    ] as { houseCap: number; upgradeCost?: { wood: number; gold: number } }[],
  },

  showTestTools: true,        // the testing sidebar on the right (10x, +villagers, +gold, +wood)
  testSpeed: 10,              // speed of the sidebar's fast button

  autoFillWorkers: true,      // new buildings start with idle villagers assigned, up to capacity
  removeRefund: 0.5,          // share of cost refunded when removing a building

  buildings: {
    townHall: {
      name: 'Town Hall', category: null, w: 3, h: 3,
      cost: { wood: 0, gold: 0 }, allowedTiles: ['grass'], foodStorage: 150,
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
      allowedTiles: ['grass'], workers: 8, output: { food: 85 }, grassBonus: 0.25,
      farmStorage: 100, badge: 'green',
    },
    granary: {
      name: 'Granary', category: 'food', w: 1, h: 2, cost: { wood: 40, gold: 0 },
      allowedTiles: ['grass'], foodStorage: 500, workers: 1, badge: 'storage',
    },
    lumberCamp: {
      name: 'Lumber Camp', category: 'wood', w: 2, h: 2, cost: { wood: 30, gold: 0 },
      allowedTiles: ['forest'], workers: 6, output: { wood: 130 }, badge: 'gold',
    },
    market: {
      name: 'Market', category: 'trade', w: 2, h: 2, cost: { wood: 60, gold: 0 },
      allowedTiles: ['grass'], workers: 4, output: { gold: 50 }, badge: 'green',
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
  { cat: 'food', label: 'Food', kinds: ['farm', 'granary'] },
  { cat: 'wood', label: 'Wood', kinds: ['lumberCamp'] },
  { cat: 'trade', label: 'Trade', kinds: ['market'] },
  { cat: 'defense', label: 'Defense', kinds: ['barracks', 'palisade'] },
];
