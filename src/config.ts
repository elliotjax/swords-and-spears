// =====================================================================
//  ALL BALANCE NUMBERS LIVE HERE. Tune freely, then save + push.
//  (Matches README section 12. Values are starting guesses.)
// =====================================================================

export type BuildingKind =
  | 'townHall' | 'house' | 'longhouse' | 'manor'
  | 'farm' | 'granary' | 'lumberCamp' | 'market' | 'tavern' | 'chapel'
  | 'barracks' | 'trainingGrounds' | 'palisade';

export type Category = 'housing' | 'food' | 'wood' | 'trade' | 'leisure' | 'military';
export type UnitKind = 'swordsmen' | 'spearmen' | 'archers' | 'cavalry';
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
  soldierBeds?: number;           // barracks: beds for soldiers (soldiers only live here)
  trainingSlots?: number;         // training grounds: soldiers who can train here at once
  leisure?: boolean;              // a free-time destination (tavern, chapel)
  happyRadius?: number;           // chapel: residents of houses within this many tiles are happier
  unlockHallLevel?: number;       // locked until this town hall level
  comingSoon?: boolean;           // shows a locked card, cannot be built in v1
  badge?: BadgeColor;
}

export const CONFIG = {
  version: '0.8.0',

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
    places: ['home', 'townHall', 'market', 'granary', 'tavern', 'chapel'] as string[], // more later
    granaryFirstOrSecond: true, // the granary is always the 1st or 2nd stop (randomly) when one exists
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
    walkTilesPerSecond: 3.0,  // game seconds (1x real time)
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
    // index 0 = level 1. Unlocks are set on each building (unlockHallLevel).
    levels: [
      { houseCap: 4 },
      { houseCap: 6, upgradeCost: { wood: 150, gold: 120 } },
      { houseCap: 8, upgradeCost: { wood: 300, gold: 300 } },
      { houseCap: 10, upgradeCost: { wood: 500, gold: 600 } },
      { houseCap: 12, upgradeCost: { wood: 800, gold: 1000 } },
    ] as { houseCap: number; upgradeCost?: { wood: number; gold: number } }[],
  },

  // Happiness (shown in the Villagers tab; it doesn't change anything yet)
  happiness: {
    base: 50,
    tavernVisit: 15,          // visited a tavern this evening
    chapelVisit: 10,          // visited a chapel this evening
    nearChapel: 15,           // lives within a chapel's radius
  },

  military: {
    armyCap: 0.3,             // soldiers can be at most this share of the population
    // Ranks: days of training needed (in total). Battle-ready from "Trained" on.
    ranks: [
      { name: 'Recruit', days: 0 },
      { name: 'Trained', days: 7 },
      { name: 'Veteran', days: 37 },      // 30 more days
      { name: 'Sergeant', days: 77 },     // (placeholder: between Veteran and Elite)
      { name: 'Elite', days: 157 },       // 120 more days after Veteran
    ],
    // Placeholder battle stats, to be designed with battles.
    units: {
      swordsmen: { name: 'Swordsmen', size: 10, cost: 225, upkeep: 6, hp: 100, attack: 12, defense: 10, goodVs: 'Spearmen', weakVs: 'Cavalry' },
      spearmen: { name: 'Spearmen', size: 10, cost: 200, upkeep: 5, hp: 100, attack: 10, defense: 12, goodVs: 'Cavalry', weakVs: 'Archers' },
      archers: { name: 'Archers', size: 10, cost: 225, upkeep: 6, hp: 70, attack: 11, defense: 6, goodVs: 'Spearmen', weakVs: 'Cavalry' },
      cavalry: { name: 'Cavalry', size: 5, cost: 300, upkeep: 8, hp: 160, attack: 16, defense: 9, goodVs: 'Archers', weakVs: 'Spearmen' },
    } as Record<UnitKind, { name: string; size: number; cost: number; upkeep: number; hp: number; attack: number; defense: number; goodVs: string; weakVs: string }>,
  },

  // Battles (left = you, right = enemy). Every number here is a starting guess for tuning.
  battle: {
    fieldW: 26, fieldH: 15,     // battlefield size in tiles
    soldierHp: 100,             // every soldier starts with this much HP
    spacing: 0.4,               // gap between soldiers in a formation (tiles) — tight, like a real army
    squadGap: 2.3,              // gap between squad centres standing in the same line (tiles)
    aggroRange: 2.2,            // soldiers start fighting enemies this close (tiles)
    breakAt: 0.2,               // a squad breaks at this share of its total HP...
    fightAfterBreakSeconds: 20, // ...fights on this long, then flees off its own side
    fleeSpeed: 1.4,             // fleeing speed multiplier
    maxSeconds: 900,            // a battle with no winner after this long is a draw
    hitChance: 0.72,            // melee swings that land
    arrowHitChance: 0.7,        // arrows that land
    arrowSpeed: 9,              // tiles per second
    counterBonus: 1.5,
    flankBonus: 1.4,            // melee damage multiplier when hitting a squad from the side or behind
    pursuitSeconds: 6,          // after one side is beaten, the winners chase the fleeing for this long
    // Morale (courage, 0-100). A squad breaks when its HP drops to breakAt OR its morale hits 0.
    morale: {
      start: 100,
      deathLoss: 70,            // losing the whole squad costs this much (shared per soldier)
      frontHitLoss: 1.2,        // each hit taken from the front
      flankHitLoss: 4,          // each hit taken from the side or behind (being flanked is terrifying)
      arrowHitLoss: 1,          // each arrow that hits
      chargedLoss: 4,           // each hit from a charge
      friendBrokeLoss: 15,      // a friendly squad nearby breaks
      enemyBrokeGain: 8,        // an enemy squad nearby breaks
      nearbyRange: 6,           // tiles
      outnumberedPerSec: 2,     // per extra enemy squad fighting us at once
      recoverPerSec: 3,         // when nobody has hit us for recoverAfter seconds
      recoverAfter: 3,
      waverAt: 30,              // below this the squad shows as "Wavering"
      rankResist: 0.1,          // each rank above Recruit loses 10% less morale
    },
    // Melee lines: soldiers hold their place in the formation and fight what is in front of them.
    melee: {
      frontLeash: 0.55,         // how far a front-rank soldier may step out of formation (tiles)
      edgeLeash: 1.0,           // soldiers at the ends of the line wrap round further
      backLeash: 0.3,
      cavLeash: 1.2,
      brokenLeash: 1.0,         // broken squads get ragged
      pressGap: 0.25,           // the stronger squad leans in and pushes the weaker one back
    },
    charge: {
      distance: 5,              // squads charge when this close to their target
      infantryBonus: 1.25,      // first hit of an infantry charge
      knockback: 0.3,           // tiles an infantry charge shoves the enemy
      cavKnockback: 0.6,
      stagger: 0.6,             // seconds a charged soldier is knocked off balance
      braceBonus: 1.5,          // spearmen get a free strike at this bonus on a charging horse
      cycleAfter: 5,            // cavalry stuck in melee this long pull out and charge again...
      cycleMinHp: 0.4,          // ...if they still have this much HP
      withdrawDist: 5,
    },
    archerAmmo: 15,             // volleys per archer squad, then they draw swords and fight
    friendlyFire: 0.5,          // chance a missed arrow hits whoever is standing where it lands
    rankDamage: 0.1,            // +10% damage per rank above Recruit
    rankDefense: 0.03,          // +3% damage reduction per rank above Recruit
    // damage per hit before defense; ~3-5 hits to kill a 100 HP soldier
    units: {
      swordsmen: { damage: 30, cooldown: 7.5, reach: 0.55, speed: 0.7, defense: 0.18, strongVs: ['spearmen'] },
      spearmen: { damage: 27, cooldown: 7.0, reach: 0.85, speed: 0.65, defense: 0.15, strongVs: ['cavalry'] },
      archers: { damage: 26, cooldown: 7.0, reach: 0.5, speed: 0.7, defense: 0.05, range: 7, meleeDamage: 12, strongVs: ['spearmen'] },
      cavalry: { damage: 32, cooldown: 7.0, reach: 0.65, speed: 1.7, defense: 0.12, chargeBonus: 1.8, strongVs: ['archers'] },
    } as Record<UnitKind, { damage: number; cooldown: number; reach: number; speed: number; defense: number; range?: number; meleeDamage?: number; chargeBonus?: number; strongVs: UnitKind[] }>,
  },

  // Tech tree: researched at the Town Hall with gold, one at a time, takes a few days.
  // effect keys: farm/wood/market/tax/births = +share output; carry = less delivery time lost;
  // roads = faster on full roads; train = faster training;
  // battle: damage/armour/range/charge/morale (your squads in battle).
  tech: {
    list: [
      { id: 'plough', group: 'Farming', name: 'Iron Plough', desc: 'Farms grow 15% more food.', cost: 150, days: 2, hall: 1, needs: [], effect: { farm: 0.15 } },
      { id: 'wheelbarrows', group: 'Farming', name: 'Wheelbarrows', desc: 'Food carriers lose half as much work time on deliveries.', cost: 160, days: 2, hall: 1, needs: ['plough'], effect: { carry: 0.5 } },
      { id: 'rotation', group: 'Farming', name: 'Crop Rotation', desc: 'Farms grow another 15% more food.', cost: 350, days: 3, hall: 2, needs: ['plough'], effect: { farm: 0.15 } },
      { id: 'windmills', group: 'Farming', name: 'Windmills', desc: 'Farms grow another 20% more food.', cost: 650, days: 4, hall: 3, needs: ['rotation'], effect: { farm: 0.2 } },
      { id: 'axes', group: 'Wood', name: 'Sharp Axes', desc: 'Lumber camps cut 20% more wood.', cost: 120, days: 2, hall: 1, needs: [], effect: { wood: 0.2 } },
      { id: 'saws', group: 'Wood', name: 'Two-man Saws', desc: 'Lumber camps cut another 25% more wood.', cost: 320, days: 3, hall: 2, needs: ['axes'], effect: { wood: 0.25 } },
      { id: 'coinage', group: 'Gold', name: 'Coinage', desc: 'Taxes bring in 25% more gold.', cost: 200, days: 2, hall: 1, needs: [], effect: { tax: 0.25 } },
      { id: 'guilds', group: 'Gold', name: 'Guilds', desc: 'Markets make 30% more gold.', cost: 320, days: 3, hall: 2, needs: ['coinage'], effect: { market: 0.3 } },
      { id: 'banking', group: 'Gold', name: 'Banking', desc: 'Taxes bring in another 25% more gold.', cost: 700, days: 4, hall: 3, needs: ['guilds'], effect: { tax: 0.25 } },
      { id: 'midwives', group: 'People', name: 'Midwives', desc: 'Babies are born 30% more often.', cost: 180, days: 2, hall: 1, needs: [], effect: { births: 0.3 } },
      { id: 'paved', group: 'People', name: 'Paved Roads', desc: 'Villagers walk 25% faster on full gravel roads.', cost: 300, days: 3, hall: 2, needs: [], effect: { roads: 0.25 } },
      { id: 'herbs', group: 'People', name: 'Herbal Medicine', desc: 'Babies are born another 30% more often.', cost: 500, days: 3, hall: 3, needs: ['midwives'], effect: { births: 0.3 } },
      { id: 'drill', group: 'Military', name: 'Drill Yards', desc: 'Squads train 30% faster (rank up sooner).', cost: 250, days: 2, hall: 2, needs: [], effect: { train: 0.3 } },
      { id: 'banners', group: 'Military', name: 'War Banners', desc: 'Your squads lose courage 20% slower in battle.', cost: 300, days: 2, hall: 2, needs: [], effect: { morale: 0.2 } },
      { id: 'longbows', group: 'Military', name: 'Longbows', desc: 'Your archers shoot 20% further.', cost: 350, days: 3, hall: 2, needs: [], effect: { range: 0.2 } },
      { id: 'stirrups', group: 'Military', name: 'Stirrups', desc: 'Your cavalry charges hit 25% harder.', cost: 350, days: 3, hall: 2, needs: [], effect: { charge: 0.25 } },
      { id: 'steel', group: 'Military', name: 'Steel Weapons', desc: 'Your soldiers hit 10% harder.', cost: 500, days: 3, hall: 3, needs: ['drill'], effect: { damage: 0.1 } },
      { id: 'mail', group: 'Military', name: 'Chain Mail', desc: 'Your soldiers take 12% less damage.', cost: 650, days: 4, hall: 4, needs: ['steel'], effect: { armour: 0.12 } },
    ] as TechDef[],
  },

  showTestTools: true,        // the testing sidebar on the right (10x, +villagers, +gold, +wood, unlock)
  testSpeed: 10,              // speed of the sidebar's fast button

  autoFillWorkers: true,      // new buildings start with idle villagers assigned, up to capacity
  removeRefund: 0.5,          // share of cost refunded when removing a building

  buildings: {
    townHall: {
      name: 'Town Hall', category: null, w: 3, h: 3,
      cost: { wood: 0, gold: 0 }, allowedTiles: ['grass'], foodStorage: 150,
    },
    house: {
      name: 'House', category: 'housing', w: 2, h: 2, cost: { wood: 40, gold: 0 },
      allowedTiles: ['grass'], beds: 10, isHouse: true, badge: 'blue',
    },
    longhouse: {
      name: 'Longhouse', category: 'housing', w: 3, h: 2, cost: { wood: 90, gold: 0 },
      allowedTiles: ['grass'], beds: 25, isHouse: true, unlockHallLevel: 2, badge: 'blue',
    },
    manor: {
      name: 'Manor', category: 'housing', w: 3, h: 3, cost: { wood: 160, gold: 60 },
      allowedTiles: ['grass'], beds: 50, isHouse: true, unlockHallLevel: 3, badge: 'blue',
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
    tavern: {
      name: 'Tavern', category: 'leisure', w: 2, h: 2, cost: { wood: 70, gold: 20 },
      allowedTiles: ['grass'], leisure: true, unlockHallLevel: 2,
    },
    chapel: {
      name: 'Chapel', category: 'leisure', w: 2, h: 2, cost: { wood: 90, gold: 50 },
      allowedTiles: ['grass'], leisure: true, happyRadius: 7, unlockHallLevel: 3,
    },
    barracks: {
      name: 'Barracks', category: 'military', w: 2, h: 2, cost: { wood: 80, gold: 0 },
      allowedTiles: ['grass'], soldierBeds: 30, unlockHallLevel: 2, badge: 'blue',
    },
    trainingGrounds: {
      name: 'Training Grounds', category: 'military', w: 3, h: 3, cost: { wood: 60, gold: 0 },
      allowedTiles: ['grass'], trainingSlots: 50, unlockHallLevel: 2, badge: 'gold',
    },
    palisade: {
      name: 'Palisade', category: 'military', w: 1, h: 1, cost: { wood: 10, gold: 0 },
      allowedTiles: ['grass'], comingSoon: true,
    },
  } as Record<BuildingKind, BuildingDef>,

  camera: {
    tilePx: 65,               // tile size on screen at default zoom
    minZoom: 0.35,
    maxZoom: 1.7,
  },
};

export type TechEffect = 'farm' | 'wood' | 'market' | 'tax' | 'births' | 'carry' | 'roads' | 'train' | 'damage' | 'armour' | 'range' | 'charge' | 'morale';
export interface TechDef { id: string; group: string; name: string; desc: string; cost: number; days: number; hall: number; needs: string[]; effect: Partial<Record<TechEffect, number>> }

export const BUILD_MENU: { cat: Category; label: string; kinds: BuildingKind[] }[] = [
  { cat: 'housing', label: 'Housing', kinds: ['house', 'longhouse', 'manor'] },
  { cat: 'food', label: 'Food', kinds: ['farm', 'granary'] },
  { cat: 'wood', label: 'Wood', kinds: ['lumberCamp'] },
  { cat: 'trade', label: 'Trade', kinds: ['market'] },
  { cat: 'leisure', label: 'Leisure', kinds: ['tavern', 'chapel'] },
  { cat: 'military', label: 'Military', kinds: ['barracks', 'trainingGrounds', 'palisade'] },
];
