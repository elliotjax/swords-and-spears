// =====================================================================
//  ALL BALANCE NUMBERS LIVE HERE. Tune freely, then save + push.
//  (Matches README section 12. Values are starting guesses.)
// =====================================================================

export type BuildingKind =
  | 'townHall' | 'house' | 'longhouse' | 'manor'
  | 'farm' | 'granary' | 'lumberCamp' | 'market' | 'tavern' | 'chapel' | 'hunter' | 'well'
  | 'barracks' | 'trainingGrounds' | 'palisade'
  | 'stockpile' | 'wrights' | 'quarry' | 'carpenter';

export type Category = 'housing' | 'food' | 'industry' | 'town' | 'trade' | 'leisure' | 'military';
/** Goods: real things that sit somewhere (a stockpile, a work building's shelf, a building site, or someone's arms). */
export type Good = 'wood' | 'stone' | 'furniture';
export const GOODS: Good[] = ['wood', 'stone', 'furniture'];
export type Cost = Partial<Record<Good, number>> & { gold?: number };
export type TileKind = 'grass' | 'forest' | 'stone';
export type UnitKind = 'swordsmen' | 'heavy' | 'boss' | 'spearmen' | 'archers' | 'cavalry';
export type BadgeColor = 'green' | 'blue' | 'gold' | 'storage';

export interface BuildingDef {
  name: string;
  category: Category | null;      // null = not in the build menu (town hall)
  w: number; h: number;           // size in tiles
  cost: Cost;                      // goods are carried to the building site by haulers; gold is paid at once
  buildHours?: number;            // wright-hours of work to build (default: tiles x build.hoursPerTile)
  allowedTiles: TileKind[];
  beds?: number;                  // housing capacity
  workers?: number;               // job capacity
  minWorkers?: number;            // does nothing below this many present
  output?: { food?: number; wood?: number; stone?: number; furniture?: number; gold?: number }; // per day at full staff
  input?: Partial<Record<Good, number>>; // goods used up per 1 unit of output (carpenter: wood per furniture)
  inputKeep?: number;             // haulers try to keep this much input stocked here
  shelf?: number;                 // goods made here wait on a shelf (this many) until haulers collect them; full = work stops
  storage?: number;               // stockpile: how many goods it holds (all kinds together)
  grassBonus?: number;            // extra output fraction when on grassland
  isHouse?: boolean;              // counts toward the town hall house cap
  foodStorage?: number;           // lb of food this building can store (granary, town hall)
  farmStorage?: number;           // lb a farm can hold before a farmer takes it to a granary
  soldierBeds?: number;           // barracks: beds for soldiers (soldiers only live here)
  trainingSlots?: number;         // training grounds: soldiers who can train here at once
  leisure?: boolean;              // a free-time destination (tavern, chapel)
  happyRadius?: number;           // chapel: residents of houses within this many tiles are happier
  nearBonusRadius?: number;       // well: homes within this many tiles get a small happiness bonus
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
    width: 64,
    height: 64,
    forestAmount: 0.38,       // roughly the share of forest tiles
    forestScale: 8,           // bigger = larger forest blobs
    clearRadius: 7,           // grass circle kept clear at the map centre
    stoneDeposits: 8,         // grey rocky patches; quarries (2x2) go on them. They never run out.
    depositRadius: [2.6, 4.2] as [number, number], // size range of a deposit (tiles)
    nearDeposit: [11, 15] as [number, number],     // one deposit is always this far from the centre
    stoneWalkCost: 1.4,       // rocky ground is a bit slower to walk over
  },

  start: {
    villagers: 20,
    wood: 250,                // in the free starting Stockpile
    stone: 0,
    gold: 100,
    food: 150,                // lb of food stored in the Town Hall at the start
  },

  // Work: people only make things while they're actually working at their spot
  // (not while walking to it, between spots, or eating). Output numbers in the
  // buildings below are "per day at full staff" on an ordinary workday.
  work: {
    atSpotMin: 5,             // game seconds a worker works at one spot...
    atSpotMax: 10,            // ...before moving to another spot in the building
    busyShare: 0.9,           // roughly the share of a shift spent actually working (the rest is moving between spots)
  },

  // Haulers (Stockpile workers) move goods around. See README "Haulers and Wrights".
  haul: {
    carry: { wood: 20, stone: 15, furniture: 3 } as Record<Good, number>, // most a hauler carries per trip
    pickupSeconds: 1.2,       // time spent loading up
    dropSeconds: 1.2,         // time spent unloading
    thinkSeconds: 1,          // an idle hauler looks for a job this often
    // priority of each kind of job (bigger = more important). Score = priority / (trip tiles + tripPad)
    sitePriority: 3,          // building sites
    inputPriority: 2,         // workshop supplies (wood to the carpenter)
    collectPriority: 1,       // collecting from shelves...
    fullShelfPriority: 2,     // ...plus up to this much more as a shelf fills up
    tripPad: 8,               // softens distance: a far urgent job can still beat a close minor one
    minLoad: 1,               // only collect from a shelf once there's this share of a full load (or it's nearly full)
    sitePerHour: 1,           // building sites count as this many tiles closer for every game hour they've waited
  },

  // Wrights (Wright's Lodge workers) build things once haulers bring the materials.
  build: {
    hoursPerTile: 1.5,        // wright-hours of work per tile of building (house 2x2 = 6 wright-hours)
    wrightsPerTile: 0.5,      // most wrights on one site: this many per tile (at least 2)
    waitBonus: 1,             // sites count as this many tiles closer for every game hour they've waited
    thinkSeconds: 1,
  },

  // Free time (workEnd to sleepStart): villagers make a route of short errands,
  // milling around in front of each place for a few seconds, then go home.
  errands: {
    places: ['home', 'townHall', 'market', 'granary', 'tavern', 'chapel', 'well'] as string[], // more later
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
    // Upgrades: gold is paid at once; wood and stone are carried to the hall, then wrights work on it.
    levels: [
      { houseCap: 4 },
      { houseCap: 6, upgradeCost: { wood: 150, stone: 40, gold: 120 }, buildHours: 10 },
      { houseCap: 8, upgradeCost: { wood: 300, stone: 120, gold: 300 }, buildHours: 16 },
      { houseCap: 10, upgradeCost: { wood: 500, stone: 250, gold: 600 }, buildHours: 24 },
      { houseCap: 12, upgradeCost: { wood: 800, stone: 400, gold: 1000 }, buildHours: 32 },
    ] as { houseCap: number; upgradeCost?: Cost; buildHours?: number }[],
  },

  // Happiness (shown in the Villagers tab; it doesn't change anything yet)
  happiness: {
    base: 50,
    tavernVisit: 15,          // visited a tavern this evening
    chapelVisit: 10,          // visited a chapel this evening
    nearChapel: 15,           // lives within a chapel's radius
    nearWell: 5,              // lives within a well's radius
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
      heavy: { name: 'Heavy swordsmen', size: 10, cost: 450, upkeep: 10, hp: 145, attack: 21, defense: 10, goodVs: 'Spearmen', weakVs: 'Archers' },
      boss: { name: 'Warlord', size: 1, cost: 2500, upkeep: 40, hp: 600, attack: 80, defense: 20, goodVs: 'Infantry', weakVs: 'Archers', noRecruit: true },
      spearmen: { name: 'Spearmen', size: 10, cost: 200, upkeep: 5, hp: 100, attack: 10, defense: 12, goodVs: 'Cavalry', weakVs: 'Archers' },
      archers: { name: 'Archers', size: 10, cost: 225, upkeep: 6, hp: 70, attack: 11, defense: 6, goodVs: 'Spearmen', weakVs: 'Cavalry' },
      cavalry: { name: 'Cavalry', size: 5, cost: 300, upkeep: 8, hp: 160, attack: 16, defense: 9, goodVs: 'Archers', weakVs: 'Spearmen' },
    } as Record<UnitKind, { name: string; size: number; cost: number; upkeep: number; hp: number; attack: number; defense: number; goodVs: string; weakVs: string; noRecruit?: boolean }>,
  },

  // Battles (left = you, right = enemy). Every number here is a starting guess for tuning.
  battle: {
    fieldW: 26, fieldH: 15,     // smallest battlefield (tiles); it grows to fit big armies
    maxRow: 10,                 // squads side by side in one row before another row starts behind it
    rowGap: 1.4,                // tiles between rows of squads at the start
    fieldMargin: { side: 0.9, sideMin: 2, sideMax: 22, rear: 0.5, rearMax: 12 }, // open ground beside each army (x its half-width) and behind it: room to manoeuvre
    armyGap: 16,                // tiles between the two armies' front lines at the start
    bigBattleSoldiers: 1500,    // with more soldiers than this on the field, some slow bookkeeping runs less often (keeps huge battles smooth)
    soldierHp: 100,             // soldiers start with this much HP (a unit can set its own `hp` in `units`)
    spacing: 0.34,              // gap between soldiers in a formation (tiles): tight, like a real army
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
    deadliness: 0.55,           // multiplies all damage (smaller = longer battles, same amount of fighting)
    // Player orders (set on the deployment screen). Squads with no arrow hold their ground.
    orders: {
      commitAfter: 4,           // a squad on an arrow that's been in melee this long stays to finish that enemy squad...
      maxChase: 4,              // ...but won't chase it further than this from where it left the arrow
      pointReach: 0.8,          // how close counts as reaching a point on the arrow
      engageDist: 6.5,          // free squads march with the army (keeping its formation) until an enemy squad is this close...
      cavEngage: 9,             // ...cavalry escort the wings until an enemy is this close, or the infantry are fighting
      formUp: 2.5,              // in the last stretch before charging (this many tiles before charge distance) infantry square up and close ranks
    },
    // Tiredness (0 fresh .. 1 exhausted). Shown on each squad's badge as a green / yellow / red dot.
    fatigue: {
      meleePerSec: 0.007,       // gained per second of fighting (a bit over two minutes of steady fighting to exhaustion)
      pushMul: 3,               // pushing is this many times as tiring
      braceMul: 1.6,              // bracing against a push
      restPerSec: 0.02,         // lost per second while out of the fight
      damage: 0.35,             // an exhausted squad hits this much softer
      parry: 0.5,               // ...parries this much worse
      slow: 0.25,               // ...and moves this much slower
      yellowAt: 0.35, redAt: 0.7, // badge dot colours
    },
    // Pushes: a squad drives forward into the enemy, shoving them back. The enemy can brace (stand firm) while it has the legs for it.
    push: {
      lean: 0.6,                // how hard a pushing squad presses in (tiles past normal fighting distance)
      followSpeed: 0.3,         // squads next to one that's being driven back bend back with it at this share of walking speed (the line bends, it doesn't snap)
      followGap: 0.6,           // ...once it is this far behind them
      braceGiveSpeed: 0.15,     // a braced squad is still driven back, at this share of the pushers' walking speed (a slow grind)...
      shoveRange: 2.4,          // (a push drives back the squad it's aimed at while the two are this close)
      attackSpeed: 0.15,        // men in a push strike this much faster...
      exposedParry: 0.6,        // ...but are exposed: they parry only this well
      speed: 0.7,               // a push advances at this share of walking speed
      giveSpeed: 0.55,          // ...and an unbraced squad is driven back at this share of the pushers' walking speed
      weight: 2.5,              // in the shoving, a pushing soldier counts as this heavy (ordinary = 1)
      braceWeight: 2.5,         // ...and so does a braced one
      maxFatigue: 0.8,          // too tired to push beyond this
      braceMaxFatigue: 0.65,    // too tired to brace beyond this: then you get driven back
      pushedMoralePerSec: 2.5,  // courage lost per second while being driven back
      staggerChance: 0.04,      // each step, a soldier being shoved by a heavier one may be knocked off balance...
      staggerSeconds: 0.25,     // ...for this long (he can't strike or parry)
      exhaustedAt: 0.9,         // a squad this tired that's still fighting...
      exhaustedMoralePerSec: 0.8, // ...loses courage every second: exhausted men break (this is what ends a long slog)
    },
    // The army commander (one per side, same rules for both): gives every squad a mission and a reason. See src/battle/commander.ts.
    commander: {
      thinkSeconds: 1.5,        // the commander re-thinks this often
      commitSeconds: 8,         // a mission is kept at least this long (unless it becomes impossible): no flip-flopping
      contactDist: 7,           // "the lines have met" when the two infantry bodies are this close
      reserveDepth: 1,          // infantry starting more than this far behind the front row start as the reserve
      reserveBack: 2.2,         // the reserve waits this far behind the front (tiles)
      // the plan
      planWhenGap: 16,          // the commander picks its plan when the infantry lines are this close
      planJitter: 0.6,          // how much chance there is in the choice (so battles differ)
      defendBelow: 0.8,         // weaker than this share of the enemy: defend first, counter later
      envelopAbove: 1.25,       // stronger than this: go round both flanks
      centreEdge: 0.8,          // strike the centre only if it's this much better than both wings
      replanSeconds: 12,        // the plan is reviewed this often once the fight is on
      replanEdge: 1.2,          // ...and only changed if somewhere else looks this much better
      defendWait: 12,           // a defending commander whose enemy doesn't come within this many seconds advances after all
      counterAfter: 25,         // a defending commander starts pushing and committing reserves this long after contact
      // ---- battle plans (doctrines): each commander picks one by weighted chance from the situation, and its own temperament ----
      // weights before temperament; a commander's temperament (aggression, cavalry boldness, patience: 0..1 each, by chance per battle)
      // scales them, so no two battles go the same way, but the plan still fits the armies.
      doctrine: {
        envelop: 2,             // strike one wing: reserves round its end, cavalry on that side
        double: 0.8,            // both wings at once (more likely when stronger)
        centre: 1,              // hammer the centre: pushes and reserves go into the middle
        defend: 0.7,            // hold, wear them down, then counter-attack with everything at once
        feint: 0.9,             // strike one wing early, then switch: reserves and cavalry hit the other wing
        hook: 0.9,              // cavalry ride round one wing before the lines meet, reserves follow
        refuse: 0.8,            // strike one wing, hold the other wing back (it stands its ground until they come to it)
        surprise: 0.25,         // chance of striking the "wrong" (stronger) enemy wing, to keep the enemy guessing
        feintAfter: [14, 26] as [number, number], // seconds after contact when a feint switches wings
        tempo: [0.6, 1.4] as [number, number],   // reserve/push timing multiplier (aggressive commanders are fast)
        reserveShare: { envelop: 0.3, double: 0.2, centre: 0.25, defend: 0.4, feint: 0.35, hook: 0.3, refuse: 0.3 } as Record<string, number>, // share of the infantry kept back as the reserve (the rest of the rear rows become a second line)
      },
      // ---- initiative: squads with nothing to do find something ----
      shoreAfter: 8,            // seconds after contact before the commander shores up a losing part of its line...
      shoreBelow: 0.6,          // ...one where we're this much weaker than them (and not where we strike)...
      shoreEvery: 8,            // ...one reserve at a time, this often
      archerRefocus: 6,         // archers look for a new focus this often...
      archerReach: 1.8,         // ...among enemies within this many times their range (they walk up to shoot it)
      massShare: 0.6,           // this share of their cavalry (2 squads or more) near one end of our line = massing: a reserve guards that wing
      // ---- manoeuvres (maneuver.ts): the commander's bigger decisions once the fight is on ----
      man: {
        first: [18, 30] as [number, number], // seconds after the lines meet before the first one may be ordered
        every: [16, 28] as [number, number], // seconds after one ends before the next
        look: 3,                // while none is under way the commander looks at the battle this often
        sure: 4,                // total weight at which a look always leads to a manoeuvre (less = by chance)
        minSquads: 8,           // armies with fewer infantry squads than this don't manoeuvre
        weight: { contract: 3, refuse: 2, mass: 1.6, shift: 1.5 } as Record<string, number>,
        // contract: fall back and re-form a shorter, deeper line
        contractBelow: 0.65,    // ...once this share of the starting infantry squads is left...
        thin: 0.62,             // ...and the fighting line is longer than this share of "everyone side by side" (0.5 = two deep)
        contractMax: 3,         // ...at most this many times a battle
        fallBack: 5,            // tiles behind the middle of the army
        rowGap: 2.4,            // tiles between the rows of a re-formed line / a massed wing
        reformSeconds: 16,      // time allowed to get there
        arrived: 0.75,          // ...over as soon as this share has arrived
        arriveDist: 1.3,
        backSpeed: 0.9,         // ...walking backwards (facing the enemy) at this share of its speed
        breakOff: 8,            // a squad pulling out of a fight to manoeuvre keeps trying for this long at a time
        // refuse: pull a losing wing back behind the centre
        losing: 0.7, holding: 0.9, // a wing is "losing" below this strength ratio, the centre "holds" above this
        refuseBack: 3, refuseStep: 1.5, refuseSeconds: 14,
        // mass: gather the free squads behind one wing, then push from there
        massMin: 3, massShare: 0.3, massBack: 4, massSeconds: 11, massOther: 0.25,
        shiftMax: 4,            // shift: squads moved at once
      },
      // ---- army organization: front length, second line, rotation, flank budget ----
      org: {
        frontShare: 0.5,        // at most this share of the infantry fights in the front line at once
        frontStretch: { envelop: 1.3, double: 1.5, centre: 1.0, defend: 1.0, feint: 1.2, hook: 1.2, refuse: 1.1 } as Record<string, number>, // front line width = deployed width x this
        flankShare: { envelop: 0.2, double: 0.25, centre: 0.1, defend: 0.08, feint: 0.15, hook: 0.15, refuse: 0.12 } as Record<string, number>, // squads that may be off round the flanks at once
        secondEngage: 1.2,      // the second line only fights enemies this close (it doesn't join the front on its own)
        secondBack: 2.4,        // the second line stands this far behind the squad it backs
        backRange: 14,          // a spare squad backs a front squad within this distance
        relieveCohesion: 0.3,   // a front squad below this cohesion is relieved too
      },
      // ---- the push operation (pushop.ts): a managed attack on a stretch of the battle line ----
      op: {
        radius: 20,             // every free infantry squad this close to the push's start is recruited and charges
        corridor: 15,           // the push goes up a corridor this wide (7.5 tiles either side of its line)
        behind: 3,              // squads/enemies up to this far behind the start still count as in the corridor
        ahead: 10,              // enemies up to this far ahead of our foremost squad count as "in the way"
        lineReach: 8,           // squads fighting this far beside the corridor push too (the whole line leans in)
        cornerReach: 3,         // ...those this close beside it are its corners (they send half their men round after the breakthrough)
        aiCount: [2, 6] as [number, number], // the army commander starts this many pushes per battle (more for bigger armies)...
        aiPerSquads: 25,        // ...one more for every this many infantry squads...
        aiFirst: [12, 22] as [number, number], // ...the first this long after the lines meet...
        aiEvery: [28, 45] as [number, number], // ...then this long between one ending and the next
        aiBack: 5,              // the commander's own pushes start this far behind its fighting line
        tick: 0.3,              // its manager thinks this often (seconds)
        minFree: 1,             // the commander only starts one with at least this many free squads to charge
        capShare: 0.15,         // the commander's own pushes take at most this share of the army's infantry as chargers (the nearest)...
        minCap: 4,              // ...but at least this many (a player's push takes everyone in the circle)
        minAssault: 4,          // seconds before the corridor can count as cleared
        assaultSeconds: 40,     // corridor not cleared by then: the push is called off
        maxSeconds: 75,         // a push never lasts longer than this
        retarget: 5,            // a charger keeps the enemy it was sent at for at least this long
        laneWeight: 1.5,        // choosing who to charge: staying in your own lane of the corridor matters this much (per tile sideways)
        spread: 2.5,            // ...and each of our squads already sent at an enemy counts this many tiles
        wrapReach: 15,          // after breaking through, roll up their line this far each way
        wrapDepth: 2.5,         // wrapping squads go this far behind the enemy squad they turn on
        behindDepth: 15,        // enemies standing up to this far behind their line are judged...
        dangerRange: 7,         // ...those this close to our chargers (or cavalry, or attacking us) get a squad sent at them
        guardShare: 0.5,        // at most this share of the chargers go to meet enemies behind the line
        perTarget: 2,           // wrapping squads per enemy squad
        cornerDelay: 2,         // seconds after the breakthrough before the corner squads send men round
        cornerShare: 0.5,       // a corner squad sends this share of its men...
        cornerMin: 6,           // ...if it has this many standing...
        cornerCohesion: 0.3,    // ...and is in fair order
      },
      // breakthrough charges through holes in their fighting line
      gapAfter: 6,              // seconds after contact before the commander looks for holes
      gapBin: 0.5,              // the line is checked in slices this wide (tiles)
      gapWidth: 1.6,            // a stretch this wide with no enemy soldier in it is a hole
      gapWide: 3.2,             // a hole this wide gets two groups
      gapDepth: [2.5, 4.5] as [number, number], // enemy soldiers this far in front of / behind the fighting line count as "in the line"
      gapThrough: 1.6,          // the chargers run to a point this far behind the enemy squad beside the hole, then turn on it
      gapReserveRange: 14,      // a waiting reserve this close is sent first
      gapAtOnce: 2,             // holes being charged at the same time, at most
      gapEvery: 12,             // seconds before the same hole is charged again
      gapMouth: 3.6,            // chargers first line up with the hole this far in front of that point (on our side), then go straight through
      gapBand: 0.5,             // ...and while running through, only enemies this close to their path (sideways) stop them
      viaSeconds: 12,            // chargers that can't reach the point behind the line in this time go straight for the target
      rushSpeed: 0.18,          // breakthrough chargers move this much faster
      detachSize: 4,            // no reserve and nobody free: the squads beside the hole each send this many men (their rear rank)...
      detachMin: 8,             // ...if they have at least this many standing...
      detachCohesion: 0.4,      // ...are in fair order...
      detachReach: 1.5,         // ...and stand this close beside the hole
      idleSeconds: 4,           // an infantry squad not fighting this long (once the lines have met) is given a new job
      busyReach: 1.6,           // a soldier with an enemy this close is busy fighting (a quarter of a squad busy = the squad is busy)
      gapMin: 1.4,              // a hole this wide (tiles of open ground) between two enemy squads is a gap to go through
      exploitRange: 12,         // idle squads this close to a gap or the end of their line go for it
      exploitGroup: 3,          // at most this many squads sent to one opening at a time
      cavJoin: 9,               // a free cavalry squad this close joins an infantry attack through a gap (a combined attack)
      // reserves go in one at a time
      firstCommit: 6,           // seconds after the lines meet before the first waiting reserve goes round the flank
      commitEvery: 9,           // seconds between reserves
      keepReserve: 1,           // this many are kept back for a crisis...
      lastReserveAfter: 50,     // ...until this long after contact
      // tiredness and pushes
      tiredAt: 0.72,            // a front squad this tired is relieved if a reserve can take over
      restedAt: 0.4,            // a resting squad counts as fresh again below this
      pushSquads: [2, 5] as [number, number], // a push is one group of this many squads side by side (picked by chance each time), starting together
      pushWait: 10,             // ...if only one squad is able, the push waits up to this many seconds for a second one
      pushJoin: 8,              // ...and neighbours who reach the fight within this many seconds of the start join the push
      pushSpan: 5,            // ...all within this far (sideways) of the squad it's centred on
      pushFirst: [4, 10] as [number, number], // seconds after the lines meet before the first push (by chance, in this range)
      pushEvery: [14, 24] as [number, number], // seconds between one push ending and the next starting
      isolatedDist: 5,          // a squad with no friendly infantry this close (and nobody to fight) goes to rejoin friends who are fighting
      raidScore: 7.5,           // how much the commander wants the first cavalry squad on each enemy archer squad (rear charges score about 4.5 to 8)
      pushStart: 0.5,           // a squad more tired than this isn't told to start a push
      pushStop: 0.75,           // ...and one that's pushing is told to stop at this
      rollAfter: 15,            // (not before the fight has gone on this long)
      failingBalance: 0.8,      // the strike is "failing" when we're this much weaker than them there
      rollLateral: 2.5,         // "nobody in front": no enemy infantry within this sideways...
      rollDepth: 5,             // ...and this far ahead: then turn and roll up their line
      reserveRange: 2,          // a waiting reserve deals with any enemy that comes this close by itself
      relieveHp: 0.55,          // a front squad below this strength (or wavering) gets a reserve sent to help
      answerRange: 9,           // a reserve is only sent to a threat or a friend within this distance
      reserveChaseShare: 0.5,   // at most this share of the reserve is sent after flank threats (the rest stays to relieve the line)
      behindBy: 1.5,            // an enemy this far behind our nearest infantry is "behind our line"
      wrapMargin: 1.2,          // an enemy this far outside the end of our line...
      wrapDepth: 5,             // ...and no more than this far in front of it is "coming round our flank"
      closingBy: 0.4,           // ...that has come this much closer since the commander last looked (or is charging) is a threat
      maxPerTarget: 2,          // squads the commander sends against one enemy squad
      screenBack: 1.5,          // ...and this far behind our front
      screenClose: 2.5,         // a screen goes for an enemy that's charging or fighting nearby, or any enemy this close (not one standing guard opposite)
      cavAnswerRange: 16,       // enemy cavalry behind our line are answered by any of our cavalry this close...
      cavAnswerers: 2,          // ...up to this many horse squads per raider
      strikerAnswer: 5,         // cavalry with another job only break off for a flank threat this close (the screen is the one that chases)
      // breakthrough
      breachAfter: 12,          // seconds after the lines meet before the commander looks for a weak spot
      breachScore: 0.55,        // how weak a spot must be (weak, tired or wavering squad, nobody behind it, no friends beside it)
      breachWidth: 3,           // our squads within this far (sideways) of the weak spot push through it
      breachEvery: 20,          // seconds between breakthrough attempts
      rollUpSeconds: 20,        // after breaking through, the squads there roll up their line for this long
      screenOut: 1.6,           // screening cavalry stand this far outside the end of our line
      screenRange: 7,           // ...and go for anything that comes this close (infantry or cavalry)
      raidWhenGap: 13,          // cavalry raids and rear charges start when the infantry lines are this close
      badFightSeconds: 5,       // cavalry stuck this long on spearmen who aren't breaking are pulled out
      disengageHp: 0.4,         // cavalry below this strength are pulled out to rally
      rallySeconds: 7,          // ...for this long
      rallyBack: 4,             // ...this far behind our line
    },
    // Squad decisions (the battle AI every free squad uses, yours and the enemy's). Bonuses are in tiles: "counts as this much closer".
    ai: {
      fightingLatch: 3.5,       // a squad counts as "in a fight" this long after its last blow
      threatMemory: 2.5,        // hit by a squad we're not fighting within this many seconds: turn on it...
      engagedDist: 2.5,         // ...unless our own target is already this close
      protectRange: 5,          // an enemy coming at a friend's flank or rear within this range...
      protectBonus: 3,          // ...is a priority target
      waverBonus: 1.5,          // wavering enemies are worth finishing off
      cavWaverBonus: 3,         // ...especially for cavalry
      unattendedBonus: 1.5,     // an enemy fighting our friends that nobody is answering yet
      cavBusyBonus: 3,          // cavalry prefer enemies already busy fighting (rear charges)
      cavSpearFear: 3,          // cavalry avoid fresh spearmen (on top of the normal "avoid what beats us")
      reliefHp: 0.55,           // reserves wait behind a fighting friend until it's below this HP share or wavering
      archerFallBack: 3.2,      // archers fall back when enemy fighters come this close...
      archerCoverRange: 9,      // ...if friendly infantry is within this range to hide behind
      guardJoinRange: 7,        // squads holding "on guard" (enemy plans) join in when a friend this close is fighting...
      lateralWeight: 0.8,       // infantry prefer the enemy squad opposite them (sideways distance counts this much)...
      targetJitter: 1.5,        // ...but each squad sizes things up a little differently (up to this many tiles), so it's not perfect pairs
      helpHp: 0.5,              // a friend below this HP share (or wavering) and fighting...
      helpRange: 7,             // ...within this range...
      helpBonus: 2.5,           // ...makes its attacker a priority: go help
      guardRange: 12,           // cavalry guards go for enemy cavalry within this range (or attacking a friend); else wait on their wing
      raidCavAvoid: 8,          // cavalry raiders leave enemy cavalry alone (unless it attacks them)
      raidArcherBonus: 3,       // raiders love archers
      raidTurnIn: 3.5,            // a raider riding round the enemy line along the edge turns in once it is this close (sideways of the field) to its target
      archerFocus: 2.5,         // archers prefer the squad their commander told them to shoot at (tiles of distance this is worth)
      raidClearance: 2.2,       // raiders ride round enemy foot that's within this distance of their route
      rearCavRange: 7,          // infantry not fighting turn to meet enemy cavalry behind our line within this range
      rearCavBonus: 5,          // (spearmen +2)
      braceDist: 4,             // infantry stop and face cavalry charging at them from this close
      archerRearCav: 3,         // archers prefer cavalry behind our line...
      archerSpread: 0.06,       // ...but each archer already aiming at a squad makes it this much less attractive (spread the arrows)
      guardArrows: 8,           // ...or after taking this many arrow hits
    },
    tempo: 1,                   // multiplies every attack's wait (bigger = slower swings). Battles are long because most frontal blows get parried, not because people stand around
    pursuitSeconds: 6,          // after one side is beaten, the winners chase the fleeing for this long
    // Morale (courage, 0-100). A squad breaks when its HP drops to breakAt OR its morale hits 0.
    morale: {
      start: 100,
      deathLoss: 70,            // losing the whole squad costs this much (shared per soldier)
      hitRef: 25,               // hit losses below are for a hit of this much damage (smaller hits cost less courage)
      frontHitLoss: 1.2,        // each hit taken from the front...
      supportFront: [1, 0.6, 0.3] as number[], // ...times this with 0 / 1 / 2 friendly squads close beside you
      supportDeath: 0.2,        // each friendly squad beside you: losing a man costs this share less courage
      supportGap: 1.8,          // "beside you": a friendly squad's edge within this many tiles of yours...
      supportDepth: 2.5,        // ...and no more than this far ahead or behind
      flankHitLoss: 4,          // each hit taken from the side or behind (being flanked is terrifying)
      arrowHitLoss: 1,          // each arrow that hits
      chargedLoss: 2,           // each hit from a charge (less with friends beside you, unless it's from the flank)
      friendBrokeLoss: 15,      // a friendly squad nearby breaks (less when lots of other friends are close: big armies hold steadier)
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
      frayRate: 0.08,           // formations fray: soldiers may drift this much further from their place per second of melee...
      frayMax: 0.6,             // ...up to this much (now: this much at zero cohesion)
      chargeLeash: 0.8,         // in the last rush of a charge the line loosens this much (it's not a parade)
      frontHunt: 0.6,           // front-rank soldiers with nobody to fight may go looking this share as far as the back ranks
      slotWeight: 0.45,         // choosing who to fight: how much "near my place in the squad" counts (the rest is "near me")
      foeGap: 0.22,             // enemies keep this much extra room between them (two lines press against each other instead of mixing)
      huntLeash: 0.8,           // soldiers not in the front rank may go this far from their place to find someone to fight (flanking, wrapping round)
      pressForward: 0.2,        // back ranks with nobody to fight lean forward to fill gaps
      strikeRanks: 2,           // a man with this many friends between him and his enemy can't strike (only the front two ranks fight)
    },
    // Crowd pressure: men leaning forward pass on the weight of the men behind them, so pushes build up through the ranks.
    crowd: {
      on: true,
      pushing: 1,               // how hard a man in a pushing squad leans forward
      pressing: 0.55,           // ...a man in a fighting squad who isn't standing and trading blows (pressing on behind the front)
      pass: 0.75,               // share of the pressure of the men leaning on his back that he passes on
      reach: 0.6,               // "on his back" = a friend this close behind him...
      width: 0.3,               // ...and this close to straight behind
      max: 6,                   // pressure cap (about 6-7 ranks of men leaning)
      gain: 0.35,               // each point of pressure makes him this much heavier against an enemy (who gives way decides who moves)
      creepFrom: 1.2,           // above this pressure he's shoved forward...
      creep: 0.12,              // ...this many tiles a second per point of pressure above it...
      creepMax: 0.35,           // ...at most this fast
    },
    // Cohesion (0..1): how well a squad keeps together. Separate from courage: a brave squad can still come apart.
    cohesion: {
      meleePerSec: 0.012,       // lost per second of fighting...
      pushedPerSec: 0.03,       // ...more while being driven back (not braced)...
      flankHit: 0.01,           // ...and with every blow from the side or rear
      recoverPerSec: 0.05,      // regained per second out of the fight...
      lullMul: 2.5,             // ...faster in a lull (that's what the lull is for)
      blockLoss: 0.35,          // at zero cohesion, blocks/parries are this much less likely
      looseAt: 0.25,            // below this the formation dissolves: every man for himself...
      looseLeash: 0.6,          // ...stepping this much further from their place to fight
    },
    // Surges and lulls: infantry fight in bouts, then step back a pace to catch their breath, then surge in again.
    lull: {
      bout: [7, 15] as [number, number], // seconds of fighting in a bout (longer for squads with good cohesion)
      rest: [3, 5] as [number, number],  // seconds of standing back (3 s or more restores the charge)
      back: 1.3,                // tiles stepped back
      joinAfter: 2,             // when a squad surges back in, friends beside it that have rested this long come too (a line charge)
      joinRange: 3.5,
      pounceAggr: 0.6,          // a squad of an aggressive commander (aggression above this)...
      pounceCohesion: 0.7,      // ...that is still in good order...
      pounceFatigue: 0.4,       // ...and fresh, doesn't take a breather when its enemy does: it goes straight at them
    },
    // Every soldier is a little different, and fights a little differently each time.
    soldier: {
      skill: [0.8, 1.2] as [number, number], // how good they are: hit chance and blocking
      pace: [0.92, 1.08] as [number, number], // how quick on their feet
      glanceChance: 0.2,        // a hit that only glances off...
      glance: 0.45,             // ...does this share of the damage
      heavyChance: 0.08,        // a heavy blow...
      heavy: 1.6,               // ...does this much more, and knocks them off balance:
      heavyStagger: 0.35,       // seconds
      ganged: 0.3,              // each extra enemy on a soldier: they hit this much softer and block worse
      gangedHit: 0.1,           // ...and are this much easier to hit
      react: 0.5,               // chance a soldier turns on someone hitting them from the side
      busyParry: 0.35,          // parrying a blow from someone you're NOT fighting (they're busy with someone else) is this much harder
      panicPerSec: 0.03,        // a badly hurt soldier in a shaken squad may run on their own (chance per second, less for brave ones)
      hurryFrom: 0.5,           // a man further than this from where he's going hurries...
      hurry: 0.6,               // ...this much faster per tile further...
      hurryMax: 0.8,            // ...up to this much faster
      panicHp: 0.35,            // "badly hurt" = below this share of HP
    },
    charge: {
      distance: 5,              // squads charge when this close to their target
      infantryBonus: 4.5,       // first hit of an infantry charge (can't be parried)
      infantryRun: 1.0,         // tiles an infantryman must run before the hit to count as a charge
      knockback: 0.45,          // tiles an infantry charge shoves the enemy
      momentumSeconds: 4,       // after an infantry charge hits home, for this long the chargers...
      momentumDamage: 0.25,     // ...hit this much harder...
      momentumSpeed: 0.3,       // ...and this much faster
      cohesionHit: 0.015,       // every charge hit knocks this much off the enemy squad's cohesion
      cavKnockback: 0.6,
      stagger: 0.6,             // seconds a charged soldier is knocked off balance
      braceBonus: 5,            // spearmen get a free strike at this bonus on a charging horse
      cycleAfter: 5,            // cavalry stuck in melee this long pull out and charge again...
      cycleMinHp: 0.4,          // ...if they still have this much HP
      withdrawDist: 5,
    },
    archerAmmo: 30,             // arrows per archer, then they draw swords and fight
    friendlyFire: 0.5,          // chance a missed arrow hits whoever is standing where it lands
    rankDamage: 0.1,            // +10% damage per rank above Recruit
    rankDefense: 0.03,          // +3% damage reduction per rank above Recruit
    // damage per hit before defense; ~3-5 hits to kill a 100 HP soldier
    units: {
    // cooldown = seconds between swings (archers: between arrows). block = chance to parry/block a blow from the front.
    // Soldiers swing often but most frontal blows are parried: kills come from flanks, ganging up and catching people off balance.
      swordsmen: { damage: 7.5, cooldown: 2.6, reach: 0.55, speed: 0.7, defense: 0.18, block: 0.55, strongVs: ['spearmen'] },
      // heavy swordsmen: swordsmen with 1.75x the hit, 1.45x the health, plate armour that turns away 10% of every blow and twice the courage (takes twice the pressure to break; `courage` divides all morale loss)
      heavy: { damage: 7.5 * 1.75, cooldown: 2.6, reach: 0.55, speed: 0.7, defense: 0.18, armor: 0.1, courage: 2, hp: 100 * 1.45, block: 0.55, strongVs: ['spearmen'] },
      // the Warlord (boss): one giant, 3x as big (radius), 600 HP, every blow is a slam that also hits everyone near the target
      boss: { damage: 80, cooldown: 2.6, reach: 0.7, speed: 0.7, defense: 0.2, armor: 0.25, courage: 4, hp: 600, block: 0.3, radius: 0.75, mass: 6, worth: 4, splash: { radius: 2.0, share: 0.75 }, strongVs: [] },
      spearmen: { damage: 6.5, cooldown: 2.8, reach: 0.85, speed: 0.65, defense: 0.15, block: 0.42, strongVs: ['cavalry'] },
      archers: { damage: 20, cooldown: 4.0, meleeCooldown: 2.8, reach: 0.5, speed: 0.7, defense: 0.05, block: 0.15, range: 7, meleeDamage: 4, strongVs: ['spearmen'] },
      cavalry: { damage: 8, cooldown: 2.8, reach: 0.65, speed: 1.7, defense: 0.12, block: 0.3, chargeBonus: 4.5, strongVs: ['archers'] },
    } as Record<UnitKind, { damage: number; cooldown: number; reach: number; speed: number; defense: number; block: number; armor?: number; courage?: number; hp?: number; radius?: number; mass?: number; worth?: number; splash?: { radius: number; share: number }; range?: number; meleeDamage?: number; meleeCooldown?: number; chargeBonus?: number; strongVs: UnitKind[] }>,
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
  removeRefund: 0.5,          // share of cost refunded when removing a finished building (goods go to the nearest stockpile)

  buildings: {
    townHall: {
      name: 'Town Hall', category: null, w: 3, h: 3,
      cost: {}, allowedTiles: ['grass'], foodStorage: 150,
    },
    house: {
      name: 'House', category: 'housing', w: 2, h: 2, cost: { wood: 40 },
      allowedTiles: ['grass'], beds: 10, isHouse: true, badge: 'blue',
    },
    longhouse: {
      name: 'Longhouse', category: 'housing', w: 3, h: 2, cost: { wood: 80, furniture: 4 },
      allowedTiles: ['grass'], beds: 25, isHouse: true, unlockHallLevel: 2, badge: 'blue',
    },
    manor: {
      name: 'Manor', category: 'housing', w: 3, h: 3, cost: { wood: 120, stone: 40, furniture: 10, gold: 60 },
      allowedTiles: ['grass'], beds: 50, isHouse: true, unlockHallLevel: 3, badge: 'blue',
    },
    farm: {
      name: 'Farm', category: 'food', w: 3, h: 3, cost: { wood: 40 },
      allowedTiles: ['grass'], workers: 8, output: { food: 85 }, grassBonus: 0.25,
      farmStorage: 100, badge: 'green',
    },
    granary: {
      name: 'Granary', category: 'food', w: 1, h: 2, cost: { wood: 40 },
      allowedTiles: ['grass'], foodStorage: 500, workers: 1, badge: 'storage',
    },
    hunter: {
      name: "Hunter's Lodge", category: 'food', w: 2, h: 2, cost: { wood: 50 },
      allowedTiles: ['forest'], workers: 4, output: { food: 45 }, farmStorage: 60, badge: 'green',
    },
    well: {
      name: 'Well', category: 'leisure', w: 1, h: 1, cost: { wood: 10, stone: 20 },
      allowedTiles: ['grass'], leisure: true, nearBonusRadius: 4,
    },
    lumberCamp: {
      name: 'Lumber Camp', category: 'industry', w: 2, h: 2, cost: { wood: 30 },
      allowedTiles: ['forest'], workers: 6, output: { wood: 130 }, shelf: 60, badge: 'gold',
    },
    market: {
      name: 'Market', category: 'trade', w: 2, h: 2, cost: { wood: 50, furniture: 4 },
      allowedTiles: ['grass'], workers: 4, output: { gold: 50 }, badge: 'green',
    },
    tavern: {
      name: 'Tavern', category: 'leisure', w: 2, h: 2, cost: { wood: 60, furniture: 6, gold: 20 },
      allowedTiles: ['grass'], leisure: true, unlockHallLevel: 2,
    },
    chapel: {
      name: 'Chapel', category: 'leisure', w: 2, h: 2, cost: { wood: 50, stone: 60, furniture: 6, gold: 50 },
      allowedTiles: ['grass'], leisure: true, happyRadius: 7, unlockHallLevel: 3,
    },
    barracks: {
      name: 'Barracks', category: 'military', w: 2, h: 2, cost: { wood: 70, stone: 20, furniture: 6 },
      allowedTiles: ['grass'], soldierBeds: 30, unlockHallLevel: 2, badge: 'blue',
    },
    trainingGrounds: {
      name: 'Training Grounds', category: 'military', w: 3, h: 3, cost: { wood: 50, furniture: 3 },
      allowedTiles: ['grass'], trainingSlots: 50, unlockHallLevel: 2, badge: 'gold',
    },
    stockpile: {
      name: 'Stockpile', category: 'town', w: 3, h: 3, cost: { wood: 20 },
      allowedTiles: ['grass'], workers: 4, storage: 800, buildHours: 3, badge: 'storage',
    },
    wrights: {
      name: "Wright's Lodge", category: 'town', w: 2, h: 2, cost: { wood: 40 },
      allowedTiles: ['grass'], workers: 4, badge: 'gold',
    },
    quarry: {
      name: 'Quarry', category: 'industry', w: 2, h: 2, cost: { wood: 30 },
      allowedTiles: ['stone'], workers: 4, output: { stone: 80 }, shelf: 45, badge: 'gold',
    },
    carpenter: {
      name: 'Carpenter', category: 'industry', w: 2, h: 2, cost: { wood: 50, stone: 20 },
      allowedTiles: ['grass'], workers: 3, output: { furniture: 12 }, input: { wood: 8 }, inputKeep: 60, shelf: 12, badge: 'gold',
    },
    palisade: {
      name: 'Palisade', category: 'military', w: 1, h: 1, cost: { wood: 10 },
      allowedTiles: ['grass'], comingSoon: true,
    },
  } as Record<BuildingKind, BuildingDef>,

  camera: {
    tilePx: 65,               // tile size on screen at default zoom
    minZoom: 0.2,
    maxZoom: 1.7,
  },
};

export type TechEffect = 'farm' | 'wood' | 'market' | 'tax' | 'births' | 'carry' | 'roads' | 'train' | 'damage' | 'armour' | 'range' | 'charge' | 'morale';
export interface TechDef { id: string; group: string; name: string; desc: string; cost: number; days: number; hall: number; needs: string[]; effect: Partial<Record<TechEffect, number>> }

export const BUILD_MENU: { cat: Category; label: string; kinds: BuildingKind[] }[] = [
  { cat: 'housing', label: 'Housing', kinds: ['house', 'longhouse', 'manor'] },
  { cat: 'food', label: 'Food', kinds: ['farm', 'granary', 'hunter'] },
  { cat: 'town', label: 'Town', kinds: ['stockpile', 'wrights'] },
  { cat: 'industry', label: 'Industry', kinds: ['lumberCamp', 'quarry', 'carpenter'] },
  { cat: 'trade', label: 'Trade', kinds: ['market'] },
  { cat: 'leisure', label: 'Leisure', kinds: ['well', 'tavern', 'chapel'] },
  { cat: 'military', label: 'Military', kinds: ['barracks', 'trainingGrounds', 'palisade'] },
];
