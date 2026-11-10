# Medieval Colony Game (working title)

A phone-first, real-time **colony builder** set in an **alternate medieval world**. You grow a colony on a fixed grid, manage a limited pool of **villagers who double as soldiers**, and conquer your way across a **grand map** to defeat the final kingdom. It is one long campaign (about **20 hours**).

The feel to aim for: the readable, satisfying colony-watching of **RimWorld** and **Songs of Syx**, with the clean, friendly flat UI of **Prison Architect** and **Cities: Skylines**. Not gritty. Not realistic. Easy to read on a phone.

**Status:** design is done enough to start building. Nothing is built yet. This file is the single source of truth. Update it whenever a decision is made.

---

## 1. Instructions for Claude Code (read this first)

**About the owner**
- The owner designs the game but **does not code**. Explain changes in short, plain language. Say what you built, how to try it, and what is next.
- The owner is on a **phone** a lot. Keep summaries short.
- The owner will playtest and give feedback like "too slow" or "feels off." Turn that into tuning changes.

**How to work**
1. Treat everything marked **Decided** as settled. Do not change it without asking.
2. Anything marked **TBD**, **Proposal**, or listed under **Open questions** is not decided. Either ask, or implement the simplest option behind a config value and note it.
3. Keep **all balance numbers in one config file** (costs, rates, capacities, caps, speeds). The owner will tune these a lot. See section 12 for starting guesses.
4. Keep the **simulation separate from rendering** (see section 3). This matters for speed controls, saving, and later battles.
5. Work in **small milestones** (section 13). Finish one, make sure it runs, then update the **Progress log** at the bottom of this file and move on.
6. Commit often with clear messages so the owner can undo anything that breaks.
7. When the owner gives a new design decision, **write it into this README** in the right section.
8. Test on a **phone-sized screen** (portrait, about 390x844) first. Touch controls come first; mouse is a bonus.

---

## 2. Design pillars

1. **Villagers are the heart of everything.** One limited pool of people works the economy, pays taxes, and also becomes the army. Every soldier is a worker you lose.
2. **Watch it live.** Buildings only produce when villagers actually walk there and work. Seeing people go to jobs, houses, and the town hall is the point, and it should be satisfying to watch.
3. **The colony writes its own roads.** You never build roads. The paths villagers walk most get worn into visible roads over time.
4. **Simple to read, deep to master.** Rates instead of exact inventories for food. Flat clean art. Few resources to start.
5. **A long campaign.** Many hours, many sittings. Pausing, saving, and speed control matter.

---

## 3. Technology (Decided: web game)

The owner does not care about the tech, only that it works well on a phone and is easy to share.

- **Recommended:** a **web game** in **TypeScript** with **HTML5 canvas** (Canvas2D to start; PixiJS or similar only if performance needs it), built with **Vite**. Mobile-first, installable as a PWA, playable from a link. Can be wrapped for app stores later (for example with Capacitor).
- **Architecture:**
  - A **fixed-timestep simulation** (the "game logic") that does not know about drawing.
  - A **renderer** that reads simulation state and draws it.
  - A **UI layer** (HTML/CSS on top of the canvas is fine) for panels and menus.
  - **Data-driven content:** buildings, units, techs, and balance values in JSON or TypeScript config files, not hard-coded.
- **Speed control:** pause, 1x, 2x, 3x change how many simulation ticks run per second. Never speed up by skewing delta time.
- **Saving:** serialize the whole simulation state. Autosave regularly and when the app is hidden or closed. See section 4.

---

## 4. Platform, pacing, and saving (Decided)

- **Phone first**, touch controls, portrait layout.
- **Real time**, with **pause, 1x, 2x, 3x** speed.
- **One long campaign**, about **20 hours**, played over many sittings.
- **When the app is closed or hidden, the game pauses.** There is **no offline progress.**
- **Auto-save** and resume exactly where the player left off. *(Assumed, confirm with the owner.)*

---

## 5. Setting and tone (Decided)

- An **alternate medieval world.** It is **not Earth** and not based on real history, but it is **not very exotic either**. Think medieval kingdoms, villages, and armies with its own names and places.
- **Not gritty.** Friendly, clean, readable.
- Enemy kingdoms are medieval too (not 100% locked in).

---

## 6. Art direction and UI

### 6.0 Map art: ROOFLESS PIXEL (Decided, replaces 6.2 for the map)
The owner picked **"B · Roofless Pixel"** from the art-style mockups (`public/art-styles.html`, live at `/art-styles.html`).
- The map is **pixel art at 16 art-pixels per tile**, scaled up crisply (no blur). Earthy, muted colors.
- **No roofs:** every building shows its walls, floor and furniture (beds, tables, sacks, pews, bar counter...). Doors are gaps in the front wall.
- **Villagers are tiny pixel people: "Taller figures" (Decided), 3 wide × 5 tall, seen from the front** (hair, face, tunic, legs that step when walking; they face left/right with their direction). Soldiers: red uniform + steel helmet; **swordsmen** shield + sword, **spearmen** a spear taller than them, **archers** green hood + bow + quiver, **cavalry** on a horse. Options page: `/pawn-styles.html`.
- **People are visible inside buildings**, e.g. asleep in their own beds at night.
- Roads are crisp pixel gravel; the granary shows sacks filling up as food is stored.
- The **UI panels stay in the mockup E style** (6.3).
- Max zoom is capped (1.7) so pixels don't get too chunky.

### 6.1 Chosen direction (original; the UI part still applies)
The owner **likes the "Prison Architect" style UI from mockup E (Flat vector)** and wants the game to feel like it. Art style is **top-down**, **flat vector**, with **more detail than a basic shapes look** (the owner found the first round too simple). Treat mockup E as the target and mockups D and F as references for mood only.

A visual reference file is included: **`design/design-mockups.html`** (three phone-size mockups side by side: D muted top-down, E flat vector, F dusk). Open it in a browser. **E is the one to match.**

### 6.2 Map art spec (match mockup E)
- **Top-down view**, light from the **top-left**, so shadows fall to the **bottom-right** as **hard, flat, offset shadows** (no blur).
- **Bold dark outlines** on buildings, thin and consistent.
- **Bright, friendly flat colors.** Ground has soft color patches, grass tufts, tiny flowers, and a few pebbles for life, but no realism.
- **Buildings** are drawn as roofs from above: two roof planes (one lit, one shaded) with a ridge, shingle lines, a chimney, and light smoke. Detail through small props: barrels, crates, log piles, fences, a scarecrow, hay bales, banners.
- **Trees:** dense clusters of rounded canopy blobs in several greens with highlights and a drop shadow.
- **Farms:** tilled soil with furrow lines, crop rows, and a fence.
- **Villagers:** small figures seen from above: shoulders in a tunic color, a head, hair, and a shadow. Some carry baskets or tools. Vary tunic colors.
- **Worker-count badges** float over buildings: a white pill with a colored border, like `6/8` (workers / capacity). Green for production, blue for housing, gold for gathering.
- **Scale:** at default zoom roughly **6 tiles across the phone width** (a tile is about 65 px in the mockup). Player can pan and zoom.
- **Map fills the whole screen.** UI floats on top.

**Palette (mockup E)**

| Use | Color |
|---|---|
| Grass | `#8bc77a`, `#7dbd6e` |
| Ground patches | `#a1d68f` (light), `#74b266` (dark) |
| Dirt | `#c6a779` |
| Tree greens | `#2f7d4f`, `#3f9a5f`, `#5bb877`, highlight `#9be0a9` |
| Wall (cream) | `#f2e6cf` |
| Stone | `#d9d3c4`, `#aaa393` |
| Roof lit / shaded / highlight | `#e0584c`, `#c0463c`, `#f08a7e` |
| Slate roof (barracks) | `#8392b6`, `#64739a` |
| Wood | `#b07a4c`, `#8a5c36` |
| Soil / furrow | `#9c6b42`, `#b07c52` |
| Crops | `#58b04c`, `#7ccb5d` |
| Banner red | `#d6453d` |
| Gold | `#f0b93e` |
| Outline | `#3a3342` (about 1.6 px) |
| Villager tunics | `#4f7fc4`, `#b3323a`, `#d9a441`, `#5a8f5a`, `#8a5aa8` |

Color roles: **red = player**, **blue = enemy kingdoms** (match the earlier prototype's red vs. blue idea).

### 6.3 UI spec (match mockup E)
Phone portrait. The map is full-bleed. The UI floats over it.

**Top left: status panel** (about 166 px wide). Rows, each with a small icon, a label, and a value:
- **Food:** the amount stored in pounds plus the change per day, for example `262 lb +83/d` (change green when going up, red when going down), with a thin **granary bar** underneath labelled as a **percentage full** (for example `Granary 68% full`). *(Decided, replaces the earlier rate-only idea.)*
- **Wood:** stockpile.
- **Gold:** stockpile plus daily income, for example `180 +6/d`.
- **Villagers:** current / housing capacity, for example `28 / 36`.
- **Births:** expected births per day right now, for example `1.2/day` (0 when blocked; the Villagers tab says why).
- **Idle:** villagers without a job (amber).
- **Army:** military percentage of population against the cap, for example `12% / 30%`.

**Top right (stacked):**
1. **Time and speed panel (Decided):** one simple panel. Top row: a small round clock dial (light face by day, dark face at night), **Day N**, the time (for example `2:45 PM`, in 15-minute steps) and a small label for what villagers are doing (**Work / Free time / Sleep**). Bottom row: pause, 1x, 2x, 3x. Active speed highlighted with the accent color. Each button at least 42 px.
2. **Alert card:** for example "Raiders sighted, arrive in 3 days," with a warning icon and accent border. Tapping jumps to the grand map.
3. **Town hall level chip:** for example `Town Hall Lv 2`, with the menu button next to it.

**Bottom (stacked, bottom-anchored):**
1. **Category chips:** for the Build tab: Housing, Food, Wood, Trade, Defense (scrollable).
2. **Building cards** (about 76x92 px): a small roof-from-above icon, name, and cost. The selected/dragged card lifts up with an accent border. **Locked** cards are dimmed with a lock and a requirement like "Hall Lv 3". The row scrolls sideways.
3. **Main bar** (64 px tall, the primary navigation). Five tabs with icon plus label: **Build, Villagers, Military, Tech, Grand Map**. The active tab has a tinted background and a 3 px accent line on top.

**Interactions:** the player **drags a building card from the build menu onto the grid** to place it. While dragging, the **building sits centred under the finger**. A translucent green ghost with a dashed outline shows a valid tile; red when invalid. (Tapping a card instead gives a Place / Cancel bar; tap the map to move the building.)

**Skin tokens (mockup E)**

| Token | Value |
|---|---|
| Font | **Nunito**, weights 600 to 800 |
| Panel background | `rgba(255,255,255,.95)` |
| Panel border | `1px solid rgba(40,45,60,.12)` |
| Panel shadow | `0 3px 10px rgba(30,40,60,.22)` |
| Corner radius | 14 px |
| Text / muted | `#262b38` / `#667086` |
| Accent (red) | `#d6453d`, text on accent `#ffffff` |
| Bar tracks | `#dfe3ea` |
| Good / wood / gold / warn | `#2f9d58` / `#a8703d` / `#d9a21e` / `#d98a1d` |
| Bottom bar | `rgba(255,255,255,.97)` with a soft upward shadow |
| Active tab tint | `#fdecea` |

**Touch rules:** buttons at least about 40 to 44 px. Nothing important in the very top or bottom edge safe areas. Respect device safe areas.

*Other mockup styles (D, F)* are for mood only: D is earthy and soft-shadowed like RimWorld, F is a darker evening mood with warm glows. The owner may later pull ideas from them (for example a night lighting mode).

---

## 7. Core systems

### 7.1 Colony map (Decided)
- A **fixed grid map** (not an open build area). Tiles never change type.
- **Map size (Decided): 64×64** (was 40×40). You can zoom out further to see more of it.
- **Tile types:**
  - **Grassland:** neutral. **Farms get a production bonus on grassland.**
  - **Forest:** holds wood-gathering buildings. Forest tiles stay forest forever.
  - **Stone deposit (Decided):** grey rocky patches with boulders, about **8 per map** (one always 11–15 tiles from the centre). A **Quarry (2×2) must sit fully on stone**, and a deposit is big enough for **several quarries**. **Deposits never run out.** Rocky ground is a bit slower to walk over.
- The game **opens with the player placing the Town Hall.**
- Pan and zoom the map. *(Assumed.)*

### 7.2 Buildings (Decided unless marked TBD)
Buildings are placed by dragging from the build menu onto grid tiles. **Building is instant** once placed and paid for. **New buildings start full of workers** (idle villagers are assigned automatically, up to capacity; nobody is taken from another job).

Every building has:
- A **capacity** (max villagers).
- Sometimes a **minimum** (it will not work below this).
- **Efficiency that scales evenly with the number of working villagers**, up to **100% at full capacity**. Each villager adds an equal share. Example: capacity 8, 6 working gives 75%.
- Villagers must **physically walk to and be at** the building to work (see 7.6).

Starting building types:

| Building | Purpose | Notes |
|---|---|---|
| **Town Hall** | Center of the colony. Placed first. | Its **level gates progression** (7.5). Villagers walk here (7.6). Losing it ends the game. **Stores a little food (150 lb)** so the colony can start before a granary exists. |
| **Houses** *(Decided, updated)* | Houses villagers (civilians only). | Only three kinds: **House (10 people, 2×2)**, **Longhouse (25, 3×2, Hall Lv 2)**, **Manor (50, 3×3, Hall Lv 3)**. No Hut or Cottage. The **number of houses is capped by Town Hall level.** |
| **Tavern** *(Decided)* | Happiness. | A free-time destination. Visiting raises happiness (Hall Lv 2). |
| **Chapel** *(Decided)* | Happiness. | A free-time destination, **and** residents of houses within its **radius (7 tiles to start)** get bonus happiness. The radius circle shows while placing it or when it's selected (Hall Lv 3). |
| **Farm** | Produces food. | Better output on grassland. Two kinds of "farm" exist: **food farm** and **wood farm** (below). **Food made at a farm is stored at the farm first** and doesn't count until a farmer carries it to a granary. |
| **Granary** *(Decided)* | Stores food. | **1×2 tiles**, holds **500 lb**, **1 worker (keeper)**. A granary only accepts food while a keeper is **assigned** (they don't need to be standing there, so deliveries never get held up); with no keeper, carriers use the next open granary or the Town Hall. Only **25% of a farm's workers (rounded up, at least 1) are carriers**. Carriers take **everything waiting at the farm** to the **nearest granary** (or Town Hall) **4 times per workday**. **While a carrier is away they don't farm**, so a far-away granary costs output (the farm panel shows the % lost). Your food stockpile = all food in granaries + Town Hall. |
| **Hunter's Lodge** *(new, first draft)* | Produces food from the forest. | **2×2, forest only, 4 hunters, about 45 lb/day** (about the same per worker as a farm). Like a farm, the food waits at the lodge until a hunter carries it to a granary. Gives forest land a food use. |
| **Well** *(new, first draft)* | A gathering place. | **1×1, 20 wood.** An evening stop for villagers; homes within **4 tiles** get **+5 happiness**. |
| **Lumber Camp** (working name for the "wood farm") | Produces wood. | Placed on **forest** tiles. **Harvests existing trees; trees never run out.** Must **not look like farming**. |
| **Commerce buildings** (for example **Market**) | Produce gold. | TBD which and how many in v1. |
| **Barracks** *(Decided)* | Housing for soldiers. | **2×2, holds 30 soldiers.** Soldiers only live in barracks (they leave their house when recruited). You can't recruit without free barracks space. Hall Lv 2. |
| **Training Grounds** *(Decided)* | Where soldiers "work". | **3×3, 50 soldiers.** Soldiers train here 5 AM–5 PM; in free time they do errands like everyone else. Training here is what raises a squad's rank. Hall Lv 2. |
| **Stockpile** *(Decided, first draft)* | Stores wood, stone and furniture. | **3×3, holds 800 goods**, **4 haulers**. All goods live in stockpiles (tap one to see exactly what's in it). Its workers are the **haulers** who move everything around (7.4b). The colony starts with one, free, holding the starting wood. |
| **Wright's Lodge** *(Decided, first draft; name can change)* | Home of the **wrights**, the building specialists. | **2×2, 4 wrights.** Wrights build everything you place, and Town Hall upgrades (7.4b). The colony starts with one, free. ("Wright" is an old word for a builder, as in wheelwright or shipwright.) |
| **Quarry** *(Decided)* | Produces stone. | **2×2, must be fully on a stone deposit, 4 workers, about 80 stone/day.** Several quarries fit on one deposit. |
| **Carpenter** *(Decided)* | Makes furniture from wood. | **2×2, 3 workers, about 12 furniture/day, uses 8 wood per piece.** Haulers bring it wood from the stockpiles. No sawmill/planks (Decided: dropped). |
| **Defensive buildings** | Modify how battles work. | TBD. Not in v1. |

### 7.3 Population, jobs, and housing (Decided)
- A set pool of villagers. **Growth comes mainly from a birth rate.**
- **Births require both a food surplus and free beds** (housing space).
- Villagers also join through **conquest** (section 10).
- The player **assigns villagers to buildings** (for example a +/- control on the building panel, or tapping "Villagers" tab). Unassigned villagers are **idle**.
- Villagers **pay taxes** (a main source of gold).
- A percentage of the population can be recruited as soldiers (section 9).

### 7.4 Resources (Decided)
Food, wood, stone, furniture and gold. More can come later.

| Resource | How it works |
|---|---|
| **Food** | **(Decided, changed)** A **stockpile in pounds** with a **change per day** (production minus what the population eats). Food is stored in **granary buildings** (500 lb each) plus a little in the Town Hall (150 lb); the total is shown as **% full**. Villagers eat straight from storage (no walking to eat, for now). If the daily change is negative, the stock drains. When empty, the population suffers (exact effects TBD; for now births stop). Tributary colonies add a fixed amount per day. |
| **Wood** | **(Decided, changed)** A real good (7.4b): cut at lumber camps, carried to stockpiles by haulers, carried to building sites to build with. |
| **Stone** | **(Decided, new)** A real good from quarries. Used for bigger buildings and Town Hall upgrades. |
| **Furniture** | **(Decided, new)** A real good made by carpenters from wood. Needed for advanced buildings: Longhouse and up, Market, leisure (Tavern, Chapel) and military buildings. Not for hall upgrades. |
| **Gold** | A normal stockpile. Spent on **buildings, technology, army upkeep, and purchases.** (Full list TBD.) |

**Gold income:** mainly **taxes on villagers**, plus **commerce buildings**, plus **tribute** from conquered colonies.

### 7.4b Goods, haulers and wrights (Decided, first draft built)
**Everything is real.** Every bit of wood, stone and furniture is always in exactly one place: in a **stockpile**, on a **work building's shelf**, at a **building site**, or in a **hauler's arms**. The top panel shows what's in all your stockpiles (goods still sitting at a lumber camp don't count until they're hauled in).

**Work only while working (Decided):** people only produce while they're actually working at their spot. Walking to work, moving between spots, carrying, eating and sleeping make nothing. (Output numbers are still "per day at full staff on a normal workday".)

**Shelves:** lumber camps, quarries and carpenters put what they make on a small shelf (60 wood / 45 stone / 12 furniture). **When the shelf is full, work stops** until a hauler collects it (an alert tells you). Farms and hunters still carry their own food to granaries (Decided: unchanged for now).

**Building sites (Decided):** placing a building creates a **building site** (gold is paid straight away). Haulers bring the materials from the stockpiles, then **wrights** build it. Wrights can only build as far as the materials that have arrived allow (half the wood delivered = can build half way). Work needed: **1.5 wright-hours per tile** (a house is 6, a farm 13.5). The building rises from the front edge as they work. Cancelling a site gives everything back. You can only place a building if the stockpiles hold its materials (not counting materials already promised to other sites).

**Town Hall upgrades** work the same way: gold now, wood + stone hauled in, wrights do the work (10/16/24/32 wright-hours). The hall keeps working meanwhile.

**How haulers choose a job (prototype, Decided to start with this):** an idle hauler looks at every job and scores it **priority ÷ (trip length in tiles + 8)**. The trip is hauler → pick-up → drop-off, so nearby jobs win unless something far away is more urgent.
1. **Building sites** (priority 3): materials from the nearest stockpile that has them. A site counts as **1 tile closer for every game hour it has waited**, so old sites never get forgotten.
2. **Workshop supplies** (priority 2): keeps up to 60 wood at each carpenter (only once it's down by half a load).
3. **Collecting** (priority 1, rising to 3 as a shelf fills up): takes goods from a shelf to the nearest stockpile with room. Only full loads, unless the shelf is nearly full.

Haulers carry **20 wood, 15 stone or 3 furniture** per trip. Goods already promised to another hauler are left out, so two haulers never go for the same load. After a delivery a hauler picks the next job **from where they are** (no walk back to the stockpile first). Haulers only start trips during work hours, but they always finish a delivery they're carrying. If a drop-off disappears (removed) they take the goods to the nearest stockpile instead.

**How wrights choose a site (prototype):** the nearest site that has materials waiting, with the same "older counts as closer" rule (1 tile per hour waited). At most **½ wright per tile** on one site (2 on a house, 4–5 on a farm or manor). A wright **stays on a site until it's done** or runs out of materials, then moves to the next site (or back to the lodge if there's nothing).

**Removing:** a finished building gives back 50% of its goods cost (into the nearest stockpile); anything stored in it also goes to other stockpiles if there's room (otherwise it's lost).

All of these numbers are in `src/config.ts` (`haul`, `build`, `work`).

### 7.5 Town hall levels and technology (Decided in outline)
- **5 Town Hall levels (Decided).** Lv 1 → 2: 150 wood + 40 stone + 120 gold (house limit 6; unlocks Longhouse, Tavern, Barracks, Training Grounds). Lv 3: 300 wood + 120 stone + 300 gold (limit 8; Manor, Chapel). Lv 4: 500 + 250 + 600 (limit 10). Lv 5: 800 + 400 + 1000 (limit 12). Upgrades are built by wrights (7.4b). Lv 1 limit is 4 houses. Conquered-territory requirements come with the grand map.
- **Testing cheat (Decided):** an **Unlock** button on the testing sidebar turns progression off (no level locks, no house limit) so everything can be tested.
- **Town hall levels are the spine of progression.** Upgrading costs **gold, wood, and conquered territories.**
- Town hall level **sets how many houses you can place**, and is intended to gate building unlocks, army cap upgrades, and more. (Level count and exact gates TBD.)
- **Tech tree is bought with gold only.** Techs unlock **new units** and **better efficiencies** and can raise the army cap.

### 7.6 Villager movement and "desire paths" (Decided: the idea. Details are Proposal.)
This is a signature feature. It is also what makes the colony satisfying to watch.

**Villagers are real agents on the map.** Stuff happens because they move.
- Each villager has a **house** (home), and may have a **job** (a building).
- Their regular trips:
  - **Home to job, and job back to home.**
  - **To the town hall** (and from it).
  - Later: to **happiness destinations** (for example tavern, chapel, market for leisure). **Happiness is NOT in v1**, but the movement system should be built so these destinations can be added easily.
- **Work happens when a villager is at their building.** Output depends on how many assigned villagers are present.
- **Visuals while moving:** walk animation, and carried items where it makes sense (a basket from the farm, logs from the camp).

**Beaten paths become roads (no road building):**
- The player **never builds roads.**
- The map tracks **foot traffic per tile.** Each time a villager walks over a tile, that tile's traffic goes up. Traffic **slowly decays** over time so unused paths fade.
- Traffic is **painted visually** in levels:
  1. Untouched grass.
  2. Faintly worn.
  3. Dirt trail.
  4. Well-worn road (the most beaten paths).
- Painting should look **soft and organic**, blended into the ground, not blocky tile squares.
- **Proposal:** pathfinding slightly **prefers already-worn tiles**, so paths reinforce themselves into visible roads. Tune this so it does not lock the colony into one ugly path.
- **Open:** do roads give a gameplay benefit (villagers walk faster on worn roads)? Start as **visual only**, with a config flag for a speed bonus later.

**Pathfinding:** tile-based (A* or flow fields), walking around buildings. Must stay fast with hundreds of villagers.

**Doors (Decided):** every building has a **door on its front (bottom) side**. Villagers walk right up to the doorway and only disappear (fade out) once they reach it, and come back out of it when leaving. To get to a door they walk along the narrow gap around the building; buildings are drawn slightly smaller than their tiles so there is visual room to walk between them. **The game does not stop you from building in front of another building's door**; villagers then go around to it.

**Road timing (Decided):** roads are steady, not a constant road-watching show. **Any foot traffic counts** (commutes, deliveries, errands, wandering, milling). Roads **only change once a night** (about 2 AM, while everyone sleeps) and the change fades in gently. They **build slowly**: a route in regular use becomes a faint path after about **2 days**, a gravel trail after about **4**, and a full road after about **6** (only the busiest routes become full roads). Unused roads **fade slowly**, about **one level every 3 days**. A road needs much more traffic to go up a level than to stay, so it doesn't flicker.

**Road look (Decided):** roads are **thin paths through the middle of the tiles**, not full tile squares, with a **gravel** look (grey-beige with small stones). They **join up naturally**: straight, diagonal, curving where they bend or branch. Levels: faint worn line → thin gravel trail → wider gravel road. Villagers walk along the middle of them.

---

## 8. Game flow and time

- **Hours of the day (Decided, updated):** 24-hour clock (1 game hour ≈ 12.5 real seconds at 1x):
  - **5 AM – 5 PM: work.** Each worker **wakes up just early enough to walk to work by 5 AM** (worked out from the distance between their home and job). Work only counts from 5 to 5.
  - **5 PM – 8 PM: free time — errands (Decided).** Each villager makes a route of short trips to random places: **their house, the Town Hall, a Market, a Granary, a Tavern, a Chapel** (more places will be added later). **Eating is the priority: the granary is always the 1st or 2nd stop** (random which). Walking speed is 3 tiles/second so villagers fit in 3–4 stops. The next stop is random but **nearer places are more likely** (so they chain short hops, not one long trip), never the same place twice in a row and never their own workplace, and only while there's still time to get home by bedtime. Usually **2–4 stops**. At each stop they **mill around in front of the building for 4–8 seconds**, then move on. Last stop is always home. Visits have no effect yet (later: happiness, shopping...).
  - **Villagers without a job** wander in front of the Town Hall during work hours, and do errands in free time like everyone else.
  - **Eating (Decided):** food is only eaten during free time, a little at a time spread evenly over 5–8 PM (so storage rises during work hours and dips in the evening). Where villagers eat (e.g. visiting a granary) will be decided later.
  - **8 PM until each worker's wake-up time: sleep** (the screen gets darker). Villagers without a job get up at 5 AM.
  - **Night fast-forward:** while everyone is indoors asleep, time runs **2× faster than the chosen speed** (1x → 2x, 2x → 4x, 3x → 6x). The clock shows "Sleep ⏩".
- **Calendar (Decided):** shown as **"Day 1, Year 0"**. A year is **24 days** for now (config); day 25 is "Day 1, Year 1".
- **Day length (Decided):** 1 game day = **5 minutes** of real time at 1x. The game's pace in real time stays the same as the first version, so per-day numbers are bigger (for example a full farm makes about 85 lb/day).
- Rates in the UI are shown **per day** (for example lb/day, gold/day).
- Possible later: **seasons** (planting, harvest, winter) to give long sessions a rhythm. **Not decided. Not in v1.**

---

## 9. Military (Decided; first version built)

**Built so far:** recruiting, squads, barracks, training grounds, ranks, upkeep, disband, the Military tab, soldier art (first sketch). **Next priorities (owner):** (1) battle stats and how fighting works, (2) battles.

- **Squad types (Decided):** **Swordsmen, Spearmen, Archers: squads of 10. Cavalry: squads of 5.**
- **Recruiting (Decided):** takes **idle villagers only**. Cost (gold, expensive on purpose): **Spearmen 200, Swordsmen 225, Archers 225, Cavalry 300.** Upkeep per day (Claude's pick, tune later): Spearmen 5, Swordsmen 6, Archers 6, Cavalry 8. Soldiers don't pay tax, but eat.
- **Ranks (Decided):** **Recruit → Trained after 7 days of training → Veteran after another 30 → Sergeant → Elite after another 120.** Sergeant's timing wasn't specified; placeholder is day 77 (between Veteran and Elite). A day counts for a squad by the share of its soldiers who trained that day. **Battle-ready = Trained or better.**
- **Disband (Decided):** soldiers become idle villagers again.
- **Military tab (Decided):** a column of page buttons on the left. **Overview:** army size, battle-ready, in training, population, idle, upkeep, army % vs cap, barracks space, list of squads (rank + progress to next rank, Disband), and a **battle formation preview**: **swordsmen in front, spearmen behind, archers at the back, cavalry on the flanks** (view only for now; arranging comes later). **Recruit:** the same counts and a card per squad type with cost, upkeep, good/weak against, and a Recruit button that says why when you can't.
- **Soldier look (first sketch):** red tunics, steel helmets; swordsmen with sword + round shield, spearmen with a long spear, archers with bow + quiver, cavalry riding brown horses with a lance.

**Earlier notes (still the plan):**

The army is **squad-based**; the player never micromanages individual soldiers.

- **One squad = one recruited unit.** Starting squad size: **10 soldiers.**
- A squad appears as **one icon on the map with an HP bar.**
- **Starting unit types:** **spearmen, archers, cavalry.** Later techs may add more.
- **Counter triangle (planned):** spearmen beat cavalry, cavalry beat archers, archers beat spearmen. Exact numbers TBD.
- **Population cap:** only a percentage of the population can be recruited. **Starting cap: 30%.** A **bar shows the current military percentage** against the cap. You can recruit while below the cap. Upgrades can raise it.
- **Soldiers eat the same as villagers.**
- **Upkeep:** each squad costs **gold per day.** **No other economic penalty** (soldiers stop working, but there is no extra malus).
- **Training takes time**, so you cannot recruit right before a fight. **The longer a squad is kept, the better trained it becomes.** A standing army is rewarded but costs constant gold.
- **Casualties:** once a squad takes a **certain amount of casualties** (threshold TBD, about 50% as a starting idea), it **keeps fighting for the rest of that battle**, but is **disbanded after the battle.** The **percentage of HP the squad has left decides how many of its villagers survive.** For a squad of 10, 40% HP left means 4 survive and return to the population as villagers; the rest are dead. You then recruit a new squad if you want one.

---

## 10. Battles, conquest, and enemies

### Battles: first version (Decided, built in the Battle Lab)
- **Left (you, red) vs right (enemy, blue)** on a **flat** field. Same unit types on both sides.
- **Every soldier has 100 HP**, tracked individually; an average hit kills in **3–5 hits**. Each squad shows **one HP bar = the average HP of its soldiers**.
- **Squads move together; each soldier picks their own target** (prefers their squad's target and what they're good against), closes in and swings; archers shoot arrows that fly in an arc; cavalry get a **charge bonus** on their first hit after a run. Hit soldiers flash white; the fallen stay on the field.
- **Breaking:** at **20% squad HP** a squad is broken; it fights on (same stats) for **20 seconds**, then **flees off its own side** of the field and is gone.
- **Battle lines (Decided):** infantry squads march until their front rank meets the enemy front, then hold a line; soldiers fight the enemy in front of their own place in the line; when a front-rank soldier falls, the one behind steps up; spearmen can jab from the second rank. Idle soldiers look for targets often and walk to the nearest fight once their squad is engaged.
- **Battle research (findings, not built yet; owner asked for research before a possible engine overhaul):**
  - **How pre-modern battles went (historians):** losses were low while the lines fought (often 5% or less) and the slaughter came when one side broke and was chased (Sabin, "The Face of Roman Battle", 2000). Lines mostly stood a little apart: fighting came in short, local surges, then a pull-back and a lull, again and again. Morale (willingness to be there) and cohesion (staying together) are different things; units often broke before contact, or after a short clash (Devereaux, ACOUP "Total Generalship" IIIc).
  - **How games do it:** Total War simulates each soldier (collision as cylinders, mass and speed in the charge, a hit-point pool per soldier, morale states that change who fights), Medieval II added pike "cohesion" (formation fighting until casualties pass a threshold, then every man for himself). Tabletop rules (Hail Caesar, Field of Glory) count "hits" as lost fighting ability, not dead men, and only the front of a unit fights. Battle AI in games is usually layered: commander, squad, soldier, with influence maps for "where are the gaps / flanks".
  - **Measured on our engine (`tools/battle-shape.ts`):** winners lose 38-62% of their men (history: about 5-15%); about a quarter of the soldiers in a fight stand among more enemies than friends (the lines mix into a blob); the fighting is one long grind with about one surge per battle, no real lulls.
  - **Quick experiment (half the damage, morale losses up, `battle-shape.ts a`):** winners lose 7-16%, battle length the same: battles are decided by courage, not by killing everyone. Mixing and the rhythm don't change: those need engine work (lines that hold apart, surges and lulls, cohesion).
- **Commander v2: battle plans, character and initiative (Decided, built; owner: "no two battles should go the same, but not completely random"):**
  - **Battle plans (doctrines):** when the armies close in, each commander picks one plan by weighted chance from the situation (strength ratio, cavalry, infantry, which enemy wing is weaker), shaped by its **character** for that battle (aggression, cavalry boldness, patience, each 0..1 by chance from the seed). Plans: **Envelop a wing** (reserves round its end, cavalry that side), **Double envelopment** (both wings, mostly when stronger), **Hammer the centre** (reserves into the middle, bigger pushes), **Hold, then counter** (the line stands its ground and lets them come; after a while every waiting reserve goes in at once with a push; if the enemy never comes it advances after `defendWait`), **Feint, then switch** (strikes one wing first; 14-26 s after contact the real blow lands on the other wing with 3 reserves at once and a push), **Cavalry hook** (cavalry ride round one wing before the lines meet and hit infantry from behind; only one screen, on the other wing). **Refuse a flank** (strike one wing hard while the other wing stands its ground and lets the enemy come to it). 1 in 4 plans strikes the enemy's stronger wing (surprise). Weights and timings: `CONFIG.battle.commander.doctrine`. The Lab shows the plan name, then what the commander is doing now.
  - **Character:** aggression sets the tempo (reserves and pushes 0.6x to 1.4x as often) and how many reserves are kept for a crisis (0-2); patience sets how big the reserve is and how long a defender waits; boldness makes cavalry raid more or less.
  - **Reserve size by plan** (`doctrine.reserveShare`, 20-40% of the infantry): the rest of the rear rows become a **second line** that follows the front.
  - **Initiative:** an infantry squad with nobody to fight for 4 s (fewer than a quarter of its men have an enemy within reach) is sent **through a gap in their line** or **round the end of their line** to hit an enemy squad from the side (`idleSeconds`, `gapMin`, `exploitRange`, up to 3 per opening). A free cavalry squad nearby joins the attack (`cavJoin`).
  - **Shoring up:** a part of our line that is clearly losing (not where we strike) gets a waiting reserve (`shoreAfter/Below/Every`).
  - **Archers focus:** archers are given a focus every 6 s: the enemy we're pushing or breaking through, or the enemy beating our weakest squad; they walk up to shoot it (`archerRefocus`, `archerReach`, `ai.archerFocus`).
  - **Reading the enemy:** if most of their cavalry mass near one end of our line, a reserve (spearmen first) moves behind that wing (`massShare`).
  - Measured (`tools/battle-ai.ts`): plans in mirror battles spread over all seven; fairness 82/160 red wins, 74/160 left side wins (mirror 2/2/2/2); 7 of 10 battles had a different pair of plans; the first line squad broke in the centre in 6/10, on a wing in 4/10; ~8 squads per mixed battle (18 in big ones) sent through gaps / round the ends; soldiers with nobody to fight 12-14% of the time (cavalry ~30%, mostly riding).
- **Cavalry fixes: no more stuck raiders, and cavalry answer raiders (Decided, built):**
  - **Stuck raiders:** a raider that had to ride round the enemy line kept re-testing "is the line in my way?" at the edge and went back and forth at the edge of the map for a minute or more (dozens of squads, 300+ squad-seconds per test battle). Now it commits to the edge ride (`viaEdge`) until it is level with its target (`ai.raidTurnIn`), then goes straight in.
  - **Answering raiders:** enemy cavalry behind our line are now answered by any of our cavalry within 16 tiles (`commander.cavAnswerRange`), up to 2 squads per raider (`cavAnswerers`), with a score that beats going off to raid.
  - Measured (24 cavalry squads, ~170 s battles): cavalry fighting time 25% -> about 50%; cavalry standing still and not fighting far from the enemy 8% -> 1-2%; about half the cavalry's time is spent answering raiders, a quarter raiding.
- **The Warlord (boss) (Decided, built):** unit `boss`, a squad of ONE giant: **3x as big** (body radius 0.75 vs 0.13, a 3x sprite), **600 HP**, defense 20% + armor 25%, courage 4, mass 6 (it shoves ordinary soldiers aside, they can't shove it). Every blow is a **slam**: 80 damage (about 37 on the target) and everyone within 2 tiles of the target takes 75% of it and is knocked off balance (`splash` in `CONFIG.battle.units`; only when the blow lands). Being swarmed neither weakens its blows nor makes it easier to hit (the "ganged up" rules skip units with mass > 1). Reach and spacing now use body radius (`bodyR`, `ext`). It stands in the middle of the front row; the commander counts it as 4 squads of strength (`worth`). Measured: beats 2 swordsmen squads, about even with 4, beats 3 cavalry, loses to 3 archers (arrows). Lab only for now (not recruitable in the colony: `noRecruit`).
- **Cinematic view (Decided, built):** a 🎬 button in the Lab's top bar (while fighting) hides everything drawn over the units (badges, mission words, squad blocks) and the bottom panel, so you just watch the battle; tap again to bring them back. Team colours are brighter (red `#e6402e`, blue `#3f78ee`) so armies are easy to tell apart from far away.
- **Squad footprints in the Lab (Decided, built):** each squad is drawn as a soft block in its team colour under its soldiers (`drawFootprints` in `lab.ts`), so a big fight reads as blocks and the gaps in a line show. Squads in melee are stronger, others faint; a **pushing** squad has a strong block with chevrons marching ahead of it; a **bracing** squad has a white bar along its front; broken squads go grey. Only drawn while fighting (not in deployment).
- **Heavy swordsmen (Decided, built):** a fifth unit, squad of 10. Same as swordsmen but **1.75x the hit** (13.1), **1.45x the health** (145) and **armor**: a new unit stat `armor` (`CONFIG.battle.units`) that turns away a share of every blow (heavy: 10%), multiplied on top of `defense`, rank and the Chain Mail tech. A unit can now set its own `hp` (default `soldierHp`). Front row of the automatic formation: heavies in the middle, swordsmen on both sides. Recruitable in the colony too (450 gold, upkeep 10; placeholder price). **Courage 2** (`courage` unit stat: all morale loss is divided by it, so twice the pressure to break). Dark plate sprite, bigger sword. Counters: strong vs spearmen like swordsmen; archers and cavalry beat them only by numbers.
- **Lab army editing (Decided, built):** changing YOUR army resets your squads to the automatic formation; changing the ENEMY army leaves your formation and arrows alone (your squads are only kept on your half if the field grows).
- **Big pushes together, bending lines, regrouping (Decided, built; supersedes the push rules below where they differ):**
  - **The commander thinks every 1.5 s** (was 2.5).
  - **A push is one big event:** 2 to 5 squads side by side (size picked by chance, `pushSquads`), all starting in the same moment, at the weak spot if one was found, otherwise where most fresh squads stand on the striking wing. Neighbours reaching the fight in the first 8 s join (`pushJoin`). First push 4 to 10 s after the lines meet, then 14 to 24 s between pushes (`pushFirst`, `pushEvery`): about 2 to 3 big pushes per army per battle. Any squad may still push alone to finish a wavering enemy. Nobody pushes cavalry.
  - **The line bends, it doesn't snap:** squads beside one that is being driven back step back with it while still fighting (`push.followSpeed`, `followGap`).
  - **Plugging the gap:** when a squad of ours is being pushed, the nearest reserve (or a free squad close by) is sent at the pushers ("plugging the gap").
  - **Regrouping:** an infantry squad left on its own with nobody to fight goes to join the nearest friends who are fighting (`isolatedDist`), so fights gather into a few places.
  - Measured (12 mixed battles): 2.3 big pushes per army, 2.4 squads on average (up to 5), line moved 2.1 tiles on average (best 5.5); counters and fairness in the progress log.
- **Visible pushes and archer raids (Decided, built; supersedes the push rules below where they differ):**
  - **A push is one concentrated effort:** at most **3 squads** side by side per army (`pushGroup`), at the commander's chosen spot (the weak spot it is breaking through, otherwise the wing its plan strikes at). Elsewhere a squad only pushes to finish off a wavering enemy. Nobody is ordered to push into a squad that is already pushing them; if two start at the same moment the stronger keeps going (a fair coin flip on a tie).
  - **A push really moves the line:** the pushers drive forward exactly as fast as the enemy is forced back: fast against a squad that can't brace (55% of walking speed), a slow grind against a braced one (15%). The squad being pushed is driven back even if it was fighting someone else, and can't step forward again while pushed. Measured in the main part of the battle (first 75 s after contact): a push lasts about 18 s and moves the line **1.7 tiles** on average, up to about 6 (before these fixes: 0.4).
  - **Men in a push** strike **15% faster**, tire 3× as fast, and are **exposed** (they parry only 60% as well). Dust kicks up under a pushing squad.
  - **Cavalry go for the archers first:** the first cavalry squad sent at each enemy archer squad now outranks rear charges. Main part of the battle: cavalry fighting time against archers 13% → 34% (cavalry 30%, spearmen 22%, swordsmen 14%); cavalry reached the archers in 12 of 12 test battles, about 6 s after the lines met.
  - **Test tool for the main part of the battle:** `tools/battle-main.ts` (run line is in the file).
  - **Fairness after these changes:** mixed 8 squads 32/60 for red (left side 30), 400 soldiers 17/30 (left 14), 1000 soldiers 8/14 (left 7). All counters hold in the full check.
- **Breakthroughs and cavalry priorities (Decided, prototype built; numbers in `CONFIG.battle.commander`, `.push`):**
  - **Breakthrough.** From 12 s after the lines meet (and at most every 20 s) the commander looks for a **weak spot**: an enemy squad that is weak, tired or wavering, with nobody standing behind it and no friends beside it. If it finds one, its plan becomes "breaking through a weak spot": our squads within 3 tiles sideways of it **push** (to 75% tired), one fresh reserve is sent straight in, and one cavalry squad charges it. When that enemy squad breaks, the plan becomes "broke through their line: rolling it up": for 20 s the squads there turn up and down the enemy line and hit the next squads from the side (at most 2 per target, so they spread both ways).
  - **Shoving physics:** soldiers being shoved by heavier ones (pushing or braced) may be knocked off balance for a quarter of a second (4% chance per step), so pushes open gaps.
  - **Cavalry priorities.** Only **one** chaser goes after each flank threat (the wing's screen first; a striker only breaks off if the threat is within 5 tiles), so the whole team no longer chases one raider. Screens stand 1.5 tiles behind the front and only go for enemies that are charging, fighting nearby or within 2.5 tiles, not ones standing guard opposite. Raiders and chargers ride past enemy cavalry on the way to their target. Taking on enemy cavalry is now the last choice.
  - **Measured (10 mixed battles):** cavalry fighting time against other cavalry 56% → 30%; now swordsmen 27%, spearmen 25%, archers 17%. Cavalry missions by time: charge from behind 35%, raid 20%, screen 18%, rally 13%, intercept 12%. About 3 breakthrough attempts per side per battle. Full check: all counters hold; mirror mixed 20–20; 400 soldiers 17–13 over 30 (left side 15); 1000 soldiers 2–4.
- **Battle dynamics: fatigue, pushes, plans (Decided, prototype built; numbers in `CONFIG.battle.fatigue`, `.push`, `.commander`):**
  - **Fatigue.** Every squad has tiredness from 0 (fresh) to 1 (exhausted). It rises while fighting (about 2.4 minutes of steady fighting to exhaustion; pushing is 3× as tiring, bracing 1.6×) and falls while out of the fight. A tired squad hits up to 35% softer, parries up to 50% worse and moves up to 25% slower. A squad at 90%+ that is still fighting loses courage every second, so exhausted squads eventually break (no endless slog). **Badge dot:** green (fresh), yellow (35%+), red (70%+).
  - **Pushes and bracing (the shoving physics).** A pushing squad drives forward into the enemy in front (word "PUSH" under its badge): its soldiers count 2.5× as heavy in the shoving, so they force the enemy back. The enemy squad **braces** ("brace") if it isn't too tired (under 65%) or wavering: then it stands firm and both sides burn energy. If it can't brace it is **driven back**, loses courage every second, and the line bends or breaks there. Too tired to push beyond 80%.
  - **When the commander orders a push:** on the wing its plan strikes at, any squad fresh enough (under 50% tired) pushes, until 75%; anywhere else a squad pushes when the enemy in front is 15% more tired, wavering, or clearly weaker in numbers. Fresh squads sent in (reserves, relief) push too.
  - **The battle plan.** When the lines are 16 tiles apart each commander picks a plan from how the two armies compare in each third of the field (with some chance, so battles differ): **strike on one wing and hold the other**, **break through the centre**, **go round both flanks** (25%+ stronger), or **defend first and counter-attack after 25 s** (under 80% of the enemy's strength). It reviews the plan every 12 s and shifts the attack only if the strike is failing and another place is clearly better. The Battle Lab shows both commanders' plans under the score during the fight.
  - **Reserves go in one at a time** (first one 6 s after contact, then every 9 s), **round the flank the plan strikes at**; one is kept back for a crisis until 50 s. Threats and relief are still answered at once.
  - **Relief and rest:** a front squad that's 72%+ tired is relieved if a reserve can take over; it pulls back to rest and becomes the reserve again once under 40%.
  - **Rolling up the line:** a front squad with no enemy left in front (after 15 s of fighting) turns and attacks the nearest enemy squad from the side.
  - **Cavalry** prefer targets on the wing the plan strikes at and tired enemies; a badly hurt squad is pulled out to rally only once.
  - **Longer battles:** all damage ×0.55 (was 0.8); arrows 20 (was 14) so archers still beat spearmen. Mixed battle about 2.8 min, 400 soldiers 3.2–3.5 min, 1000 soldiers about 4 min.
  - **Measured:** all counters still hold in the full check; mirror mixed 17–23, 400 soldiers 5–5, 1000 soldiers 3–3; no idle squads. Share of squads pushing over a battle (10 mixed battles, by time after contact): 15% at 0 s, 32% at 20 s, 16% at 40 s, 6% at 60 s, about 0 from 80–100 s, then a second phase 27–41% from 120–160 s. 1000 soldiers 1.8–1.9 ms per step.
  - **Limits:** between about 80 and 120 s after contact little changes (everyone is tired and nobody has an edge yet); in armies with few reserves there's little relief; the roll-up is squad by squad, not a wing wheeling together; plans change rarely (0.5 changes per battle).
- **Army commander, first version (Decided, built; code in `src/battle/commander.ts`, numbers in `CONFIG.battle.commander`):**
  - **Three levels of intelligence.** The **commander** (one per side, same rules for both) decides WHAT and WHY: every 2.5 s it looks at the field and gives every squad a **mission with a reason**. The **squad** decides HOW: route, position, target, with short emergency exceptions (turn on a flank attacker, brace against a charge) and then back to its mission. The **soldier** handles the fight in front of them (unchanged).
  - **In this version the commander is the only one giving orders.** In the Battle Lab your army is led by the commander by default ("Command myself" switches back to your arrows, holds and Advance, which all still work). The enemy is always commander-led; its "plan" is now only its starting formation.
  - **Missions:** advance (march with the line, fight the enemy opposite), attack, flank, reinforce ("help"), intercept, reserve, screen, raid, shock ("charge": hit from behind, pull back, charge again), pursue, disengage ("rally"), support (archers). During a fight each squad's mission shows as a small word under its badge (ordinary advance/support show nothing).
  - **Opening orders:** the front row advances; rows behind it are the **reserve** (waiting 2.2 tiles behind the front); archers support; cavalry: one **screen** per wing while the enemy has cavalry (4+ squads: one per wing; 2–3: one, on the wing most enemy cavalry is on), the rest wait **in reserve until the lines are 13 tiles apart**, then go.
  - **Reserves are committed for a reason:** to stop an enemy coming round the flank or behind the line (spearmen first against cavalry; at most half the reserve chases threats), to relieve a front squad that's wavering or below 55%, and after 12 s of fighting any reserve still waiting is sent to turn the weaker end of the enemy line.
  - **Threats are judged by what the enemy does:** an enemy outside the end of our line only counts if it's closing in or charging (cavalry just standing guard on their own wing are ignored); anything behind our line counts.
  - **Cavalry missions are dynamic** (re-chosen when a mission ends, by score): intercept a flank threat (infantry or cavalry; never head-on into fresh spearmen), screen, raid archers, charge busy infantry from behind (wavering ones first), take on their cavalry, pursue broken squads; pulled out to **rally** when stuck 5 s on spearmen or below 40% strength. Once the fight is on, almost anything beats waiting.
  - **No flip-flopping:** a mission is kept at least 8 s unless its target is gone. Measured about 1 mission change per squad per minute.
  - **No fog of war yet:** the commander sees everything, but through one function (`observe`) so fog can be added later.
  - **Measured (full `npm run battle:check`, commanders on both sides):** all counters hold (10/10 each); mirror mixed 21–19; 400 soldiers 6–4; 1000 soldiers 2–4; squads standing with no reason 0–1%; waiting on purpose 0–3%; 1000 soldiers 1.6 ms per step (was 1.7 without commanders). Commander vs the old AI with the same army: 24/40 (mixed 12 squads) and 9/20 (400 soldiers): about as strong as before, not clearly stronger yet. Left/right fairness swings a lot in small samples (seen from 10/20 up to 14/16 for the left side in 1000-soldier battles; 14/24 at 400 with every commander feature switched off in turn making no difference): no proven bias, but worth re-checking with bigger samples after future changes.
  - **Limits / next steps:** the commander reacts but doesn't yet plan ahead (no "attack on the left, hold on the right" intent, no deliberate refusing of a wing); reserves all end up committed by 12 s; infantry don't wheel as a line; `npm run battle:check -- legacy` runs the old no-commander AI for comparison.
- **Courage and cavalry jobs (Decided, prototype built; numbers in `CONFIG.battle.morale` and `CONFIG.battle.ai`):**
  - **Friends beside you steady you:** a squad with a friendly squad close on one side loses 40% less courage from blows from the front, from charges into it, and from being attacked by several squads; with friends on **both** sides, 70% less. It also loses less courage per man lost and recovers faster between blows. Blows from the flank or rear are not softened. So wavering now happens at the **ends of the line** and where squads are actually **surrounded**. Charges now cost 2 courage per hit (was 4). Measured: squads wavering in the first 30 s after contact dropped from 12% to 1%.
  - **Cavalry jobs (picked automatically):** if the enemy has cavalry, some of yours become **guards**: 1 cavalry squad = guard only if the enemy has 2+; 2–3 squads = one guard; 4+ = one guard per wing. Guards march with the army, then wait on their wing level with the infantry front and only go for enemy cavalry within 12 tiles (or one attacking a friend). Everyone else **raids**: they leave enemy cavalry to the guards (riding past any that brush them), go for **archers** first and for the **rear of enemy infantry** that's already fighting, ride **round** the enemy line by the edge instead of through it, and keep charging, pulling back and charging again. When the enemy cavalry is beaten, guards go raiding too. No enemy cavalry: all raid.
  - **Archers vs raiders:** archers prefer enemy cavalry behind your line, but each archer already aiming at a squad makes it less attractive, so the arrows spread out.
  - **Infantry meet raiders:** infantry not already fighting turn to meet enemy cavalry behind your line within 7 tiles (spearmen most of all), and when cavalry charges at them from close, they **stop, close ranks and face it** (spearmen brace).
  - Tested: cavalry-vs-cavalry fighting dropped from 59% to 48% of cavalry fighting time (now mostly guards meeting guards); full `battle:check` all counters hold; 80 mirror battles 44–36.
- **Advance and smarter arrows (Decided, built):**
  - **Advance all** (replaces "All ➜"): every squad without an arrow **advances with the army**: the same AI the enemy uses. The army marches as one formation (even front line) until an enemy squad is about 6.5 tiles away; then each squad picks a nearby enemy, forms up and charges. Selected squads get an **Advance / Hold** button. Advancing squads show a short yellow arrow. Tap the button again (**All hold**) to switch back.
  - **Arrows are routes, not "walk to the end no matter what":** **infantry** leave their arrow when an enemy squad comes within ~6.5 tiles and fight like a free squad (and stay free after: they pick the next job themselves). **Archers** stop walking to shoot while anything is in range, and fall back behind friendly infantry when enemy fighters get close. **Cavalry** stick to their arrow (so flank hooks work), only fighting when blocked or charged; free at the end.
  - **Less lane-like, more chaotic near contact:** each squad sizes up targets a little differently (no perfect one-to-one pairing); soldiers pick opponents more by what's near *them* (55%) than by their place in the squad (45%); lines loosen in the last rush of a charge; formations fray further in a long melee (up to 1 tile); front-rank soldiers with nobody to fight also go looking (60% as far as the back ranks).
  - **Helping friends:** an enemy fighting a friendly squad that's losing (below 50% or wavering) within 7 tiles becomes a priority.
  - Tested: Advance all marches with a perfectly even front; full `battle:check` still fair (mixed mirror 21–19) with all counters holding.
- **Battle AI v6: smarter squads (built; numbers in `CONFIG.battle.ai`):**
  - **Don't get flanked for free:** a squad hit by an enemy squad it isn't fighting, while its own target is still out of reach, turns on the attacker.
  - **Protect friends:** an enemy coming at a friend's flank or rear becomes a priority target for nearby squads. An enemy fighting your squads that nobody is answering yet also gets priority.
  - **Finish the weak:** wavering enemy squads are worth going for (more so for cavalry).
  - **Cavalry pick their moment:** they prefer enemies already busy fighting (rear charges) and avoid fresh spearmen who can brace.
  - **Reserves:** a squad waiting behind a fighting friend steps in when that friend is below 55% strength **or wavering**.
  - **Archers fall back:** when enemy fighters come within about 3 tiles, free archers move behind the nearest friendly infantry and keep shooting (only if there is infantry to hide behind).
  - **On guard:** enemy plans that hold ground (Defensive, the held wing of Oblique) hold only until a friend within 7 tiles is fighting or they've taken 8 arrow hits, then join in. Your own squads without an arrow still hold strictly.
  - **The enemy picks its plan from the armies** (it can't see your arrows): outnumbered → Defensive; clearly more cavalry → Cavalry hook or Crescent; clearly more infantry → Wide line; much bigger army → Crescent; otherwise Line (sometimes Oblique). 🎲 still picks a random one.
  - **Test tool:** `npm run battle:check` (see CLAUDE.md). Latest full run: mixed mirror 20–20 (left side won 22/40), 6 v 6 swords 12–8, spears beat cavalry 9/10, cavalry beat archers 10/10, archers beat spears 9/10, swords beat spears 10/10, 400 soldiers 5–5, 1000 soldiers 2–4; no idle squads, 10–18% of hits come from the flank; 1000 soldiers ≈ 1.7 ms per step.
  - **Not built yet (ideas):** an army "commander" with explicit centre, wings and reserve; squads wheeling to face several attackers; one-on-one duel animations.
- **Battle AI v5: armies march as one, form up, wrap round (Decided, first version built; to be made smarter later):**
  - **Same AI for both sides:** every squad follows one of the same three orders: **free** (battle AI), **hold** (stand and fight what comes), **path** (follow an arrow, then free). Your squads get theirs from the deployment screen; the enemy's from its plan.
  - **Marching in formation:** free squads march **as one army that keeps its shape**: everyone faces straight ahead (no angling), each squad keeps its place behind the front, and the army walks at the pace of its slowest squad (nobody runs ahead, nobody lags). Tested: front line perfectly even and every squad facing straight until contact, in small and 1000-soldier battles.
  - **Leaving the line:** infantry leave the army's march when an enemy squad is **6.5 tiles** away; cavalry escort the wings until an enemy is **9 tiles** away or their infantry are fighting.
  - **Forming up before contact:** in the last stretch before the charge, infantry **square up to face their enemy, close ranks quickly and raise their weapons** (a new braced pose), then charge (weapons stay raised in the charge).
  - **Keeping the line, covering flanks, wrapping round:** infantry pick the **enemy squad opposite them** (sideways distance counts more than forward distance), so the line meets the line. A squad that's **outside the enemy's frontage** (your line is longer) swings round to **hit the end of their line from the side**; a second squad on the same enemy goes for its flank. **Cavalry go round behind** an enemy that's already fighting.
  - **Enemy plans (🎲 New plan in the Battle Lab):** **Line** (default: marches forward as one line), **Wide line** (one long front line to overlap yours), **Crescent** (wings forward, cavalry wrap round both flanks), **Defensive** (infantry and archers hold, cavalry counter-attack), **Cavalry hook** (all cavalry ride round one flank, infantry advance), **Oblique** (one wing attacks, the other holds back).
  - **Badges:** the weapon symbol on each squad's badge is in **team colour** (red/blue), so friend and foe are always clear, even when a badge is wavering (yellow) or broken (orange).
  - Numbers: `CONFIG.battle.orders` (`engageDist`, `cavEngage`, `formUp`).
- **Deployment and orders (Decided, first version built in the Battle Lab):** the **only control is the deployment screen before the battle** (no orders once it starts, no pause).
  - Your squads start in the **automatic formation**. **Drag a squad** to move it (your half of the field only, shaded red). **Clear** sends every squad to the **tray**; **drag a card** from the tray onto the field to place it there (a tap puts it in its usual spot). **Auto** puts everyone back in the automatic formation. **⚙ Armies** changes the armies (this resets the formation).
  - **Arrows:** tap a squad, then drag its round **➜ knob** to draw its path: straight, or curved (e.g. cavalry up the flank and hooking in behind). Tap the **✕** at the end of an arrow to delete it. **All ➜** gives every squad without an arrow a straight one toward the enemy.
  - **No arrow = the squad holds its ground:** it stands still, turns to face what's coming, and fights whatever reaches it (archers shoot anything in range). That's how you set up a defensive formation.
  - **Following an arrow:** the squad marches along it. A quick clash (e.g. a cavalry charge that passes) doesn't stop it: it fights back, then carries on. If it's caught in a **real fight (4+ seconds of melee)** it stays to **finish that enemy squad**, but goes back to its arrow once that squad breaks or flees, or if it has chased more than **4 tiles** from where it left the arrow. **At the end of its arrow it's free:** it charges the nearest enemy (normal battle AI). The rest of each arrow shows faintly during the fight.
  - The enemy (blue) still uses its automatic formation and battle AI. Numbers: `CONFIG.battle.orders`.
  - **Selecting several squads (Decided, built):** tap squads to add them to the selection (as many as you like; a number on the knob shows how many). Tap a selected squad again to unselect just that one. Tapping empty ground keeps the selection; the **✕ in the panel** clears it. **Select all** selects every squad. **Drag any selected squad to move the whole group** (it keeps its shape). The **➜ knob sits in front of the whole group**: the arrow you draw is given to every selected squad, starting from each squad's own spot, so the formation keeps its shape as it follows it. The group's arrowhead (drag to extend) and ✕ (delete the arrows) work the same way. A tiny scribble doesn't wipe existing arrows. **Drawing an arrow unselects** the squad(s) it was given to (tapping the knob without drawing keeps the selection). **Easy tapping (after owner feedback):** a tap picks the squad whose **soldier or badge** is nearest your fingertip (within 30 px), working the same whether the field is turned or not. Tested every squad in the default, 400 and 1000-soldier battles fully zoomed out: 100% picked correctly by tapping a soldier and 100% by tapping its badge (cavalry included).
  - **Phone-friendly (after owner feedback):** when the field is wider than tall (most battles), it's shown **turned**: your army at the **bottom**, the enemy at the **top**, so it fills the phone screen (about 1.5× bigger). While you drag a squad or draw an arrow, **holding your finger near a screen edge scrolls the field**, so arrows can go anywhere. The knob, the arrowhead and ✕ are **fingertip-sized and stay the same size at any zoom**; squads are easy to tap even fully zoomed out (tested 6/6 in a 1000-soldier battle). **Drag the arrowhead to keep drawing** (extend or reshape an arrow). Drawn arrows are **smoothed** (no finger wobble). Moving a squad is smooth (only that squad moves, nothing is rebuilt). The bottom panel fades out of the way while you drag. Pinch-zoom zooms around your fingers.
- **Battles v4: organic fighting and big armies (Decided, built):**
  - **Squads and soldiers both think.** Each squad picks an enemy squad and pushes it (the stronger side leans in); a second squad on the same enemy swings round its flank. Each soldier picks their own opponent near their place in the line.
  - **Formations fray:** the longer a melee goes on, the further soldiers drift from their places (up to 0.6 tiles more), so lines bend and blur instead of staying neat lanes. They tighten up again once the fighting stops. Formations are tighter (0.34 tiles apart).
  - **Wrapping round, but not too much:** the front rank holds the line. Soldiers further back with nobody to fight go looking up to about 1.3 tiles from their place (braver ones further): they prefer an enemy who is **already busy fighting someone, from the side**, and avoid piling onto one man. Back ranks with nothing to do lean forward to fill gaps.
  - **Fight to the death:** once a soldier is locked in a fight, they stay on that opponent, unless someone else hits them from the side (then 50% chance they turn on them).
  - **Ganged up on:** a soldier fighting several enemies hits 30% softer per extra enemy, blocks worse, and is 10% easier to hit per extra enemy.
  - **Every soldier is different:** skill (0.8–1.2: hit chance and blocking), nerve (bravery) and pace. **Every blow is different:** 20% glance off (45% damage), 8% are heavy blows (×1.6, knocks them off balance), the rest vary ±15%. **Blocking:** blows from the front can be blocked (swordsmen 22% with shields, spearmen 12%, cavalry 10%, archers 4%).
  - **Losing their nerve:** a badly hurt soldier (under 35% HP) in a shaken squad may run on their own before the squad breaks (brave ones rarely do).
  - **Reserves:** a squad stuck behind a friendly squad that's already fighting waits just behind it, ready to step in (and pushes up once that squad is worn down).
  - **Big armies:** squads deploy in rows of up to **10**, rows stacking back (swordsmen in front, spearmen, archers; cavalry on both wings). The field grows to fit. Battle Lab allows **up to 50 squads of each type per side** (+5 button), with presets "Huge (400)" and "Epic (1000)". Big armies hold their nerve better (a squad breaking shakes its neighbours less when lots of other friends are close). Zoomed far out, squad badges drop their words.
  - **Constant fighting (v4.1, after owner feedback "they spend a lot of time doing nothing"):** measured, soldiers next to an enemy only swung ~7 times a minute and archers shot ~3 arrows a minute (the earlier "slow every attack" setting). Now soldiers swing every ~2.6 s (~23 a minute) and each archer shoots at their own pace every ~4 s (no more waiting for the squad's volley; moving doesn't reset it). Battles stay long because **most blows from the front get parried** (swordsmen 55% with shields, spearmen 42%, cavalry 30%, archers 15%), parrying is much harder against someone you're not fighting (35%) or while mid-swing or off balance, and each hit is smaller (wounds, not one-hit kills). So kills come mostly from **flanks, ganging up and catching people off balance**. Fighters plant their feet (no shuffling while fighting; visible movement while in reach dropped from 65% to ~24%). Archers stand and shoot until the enemy is well out of range (no constant repositioning). Courage lost per hit grows with how hard the hit was. Charges and spear-bracing hit proportionally harder (cavalry ×4.5, infantry ×3, brace ×5). `deadliness` (0.8) scales all damage. Tested: mixed 8-squad battle ~2.2 min (fighting the whole time), 400 soldiers ~2.3 min, 1000 soldiers ~3.5 min; counters hold (spear beats cav 10/0, cav beats archers 10/0, archers beat spears 8/2, swords beat spears 10/0); no side bias (mirror 16/14).
- **Army feel (v3, realistic — like Total War and real medieval battles):**
  - **Formations** are tight blocks (0.4 tiles apart) that **rotate to face their enemy**. While far away, the **army marches as one line**, keeping its place (infantry at the slowest infantry pace), then each squad **charges** its target when close (5 tiles).
  - **Fighting lines, not blobs:** when two squads meet they **hold a line**. Each soldier keeps their place in the formation and fights the enemy in front of them; the **ends of the line wrap round**; when a front soldier falls, the one behind steps up; spearmen jab from the second rank. Enemy soldiers shove each other, so the lines press against each other instead of mixing. The **stronger squad leans in and pushes the weaker one back**.
  - **Charges hit hard:** the first blow of a charge does bonus damage (cavalry ×1.8, infantry ×1.25), **knocks the enemy back** and leaves them off balance for a moment. **Spearmen brace:** cavalry get no charge bonus on them, and a spearman gets a free strike (×1.5) on a charging horse.
  - **Cavalry cycle-charge:** stuck in a grinding melee for 5 s (and still above 40% HP), cavalry **pull out, ride back ~5 tiles and charge again**. They also **run down routing enemies**.
  - **Spreading out and flanking:** squads don't pile onto one enemy; if a friend is already fighting a squad, the next one **swings round to its flank**. **Hits from the side or behind do +40% damage** (and hurt morale much more).
  - **Archers shoot in volleys** (the whole squad looses together), have **15 volleys**, then draw swords and fight. Archers **always fight**: they never retreat, walk up until the enemy is well within range and fight hand-to-hand if reached. They avoid shooting into a melee where their own men are; a missed arrow can still hit **whoever is standing where it lands — friend or foe**.
  - **Morale (courage, 0–100):** drops when soldiers are hit (about 3× more from the flank/rear), when soldiers die, when charged, when a **friendly squad nearby breaks** (−15), and when **ganged up on** by several squads at once; recovers slowly when nobody is hitting them; veterans lose less. Below 30 the squad is **"Wavering"** (badge flashes yellow). A squad **breaks at 0 morale OR 20% HP**, whichever comes first, then fights 20 s and flees as before. An enemy squad breaking nearby **cheers** the winners (+8), so routs can **spread down the line**.
  - **After the battle is won** the winners chase the fleeing for 6 seconds.
  - **Looks:** blood on the ground, fallen soldiers lie in different poses with their weapon dropped beside them (fallen horses for cavalry), dust behind charging horses, sparks when a blow is blocked.
  - **Every squad joins the fight** (tested: no squad ever sat out).
- **Squad badge (Decided):** each squad shows a small badge with its symbol (sword, spear, bow, horse) that **fills from the bottom with team colour by the squad's average HP**; it turns orange with a countdown when broken, then "Fleeing!". The badge follows the middle of the squad (stragglers ignored).
- **No control yet:** armies start in the default formation (swordsmen front, spearmen behind, archers back, cavalry flanks) and you press play.
- **Length:** a balanced 8-squads-a-side battle takes ~2 minutes at 1×, a big one ~2.3 (attack speed is `cooldown` in `CONFIG.battle.units`).
- **Fairness:** a battle and its mirror image play out the same (tested), and the same army wins about equally often on the left or the right (tested 120 battles each way).
- **Battle Lab** (⚔️ on the testing sidebar): pick each side's squads and rank, presets, Fight with pause/1×/2×/3×/10×, an automatic battle camera (🎯; pan/pinch to take over), results per squad, and **Run 50 battles** for win rates.
- Balance check (20 battles each): mirror matches ~50/50; spearmen beat cavalry 20/0, cavalry beat archers 20/0, archers beat spearmen 19/1, swordsmen beat spearmen ~14/6; higher ranks beat recruits 20/0; 3 squads beat 2 every time (the outnumbered side breaks from morale).
- All numbers in `CONFIG.battle` (damage, cooldowns, reach, speed, defense, range, counter bonus, rank bonuses, break point, flee time, morale, melee lines, charges, archer volleys, friendly fire).

### Battles (original outline)
- Battles are **field battles between armies**, not fought on the colony map.
- If the attacker wins, **they conquer the colony.**
- The owner wants to **watch the battle play out live.** How much control during the battle is **undecided** (none, a few orders, formation changes).
- **When defending,** you see the **enemy formation** and can **arrange your own army** to respond.
- **Defensive buildings** in a colony can modify how battles work. (TBD.)
- The owner wants **battles to be the main strategic part of the game**, so this is a priority design topic once the colony works.

### Conquest (Decided)
- **Conquered colonies are not controlled by you.** They become **tributaries** and give **gold per day.**
- **Conquered villagers:** on conquest you get a **one-time, optional offer of villagers.** You choose **how many to take in** (they still need beds and food). First version only; the owner wants to expand it later.
- Conquering more territory is required to upgrade the town hall.

### Enemy kingdoms and the grand map (Decided in outline)
- The **grand map** is a larger map where each location holds a colony. **Each map location is one colony.**
- Colony types: **capital** (hardest), **cities, towns, villages.** The **final kingdom** is the last target.
- You see **parties** (armies) **travelling** on the grand map, including **enemy armies marching toward you,** so you have time to prepare.
- You send **attack parties** to enemy colonies. (Other party uses, like visiting friendly colonies, are TBD.)
- **Enemy kingdoms attack you.**

---

## 10b. Tech tree (first draft, built — change anything)
- Opened from the **Tech** tab. Researched **at the Town Hall with gold**, paid up front, **one at a time**, each takes **2–4 game days**. **Stop** gives the gold back. Some need an earlier tech or a Town Hall level.
- **Farming:** Iron Plough (+15% food) → Wheelbarrows (carriers lose half as much work time) · Crop Rotation (+15%, Hall 2) → Windmills (+20%, Hall 3).
- **Wood:** Sharp Axes (+20% wood) → Two-man Saws (+25%, Hall 2).
- **Gold:** Coinage (+25% taxes) → Guilds (+30% market gold, Hall 2) → Banking (+25% taxes, Hall 3).
- **People:** Midwives (+30% births) → Herbal Medicine (+30%, Hall 3) · Paved Roads (+25% walking speed on full roads, Hall 2).
- **Military:** Drill Yards (train 30% faster, Hall 2) → Steel Weapons (+10% damage, Hall 3) → Chain Mail (−12% damage taken, Hall 4) · War Banners (lose courage 20% slower) · Longbows (+20% archer range) · Stirrups (+25% cavalry charge).
- Battle techs apply to **your squads in battle**; in the Battle Lab they help the red side.
- All in `CONFIG.tech` (cost, days, hall level, needs, effect). Gold sink for open question 5.

## 11. Win and lose (Decided)

- **Lose:** your **town hall in your capital** is destroyed.
- **Win:** **defeat the final kingdom.**

---

## 12. Starting balance values (all are guesses, put every one in a config file)

These are only starting points for the first playable. The owner will tune them by playing.

| Setting | Starting value |
|---|---|
| Day length | 5 min real time at 1x |
| Starting villagers | 20 (8 of them start as haulers and wrights) |
| Starting resources | 250 wood (in a free Stockpile), 100 gold, 150 lb food; a free Wright's Lodge |
| Villager food need | 4 lb/day each |
| House capacity | House 10, Longhouse 25, Manor 50 |
| House costs | House 40 wood, Longhouse 80 wood + 4 furniture, Manor 120 wood + 40 stone + 10 furniture + 60 gold |
| Farm | capacity 8, full output 85 lb/day (about 106 on grassland), cost 40 wood, grassland bonus +25%, holds 100 lb before it must be delivered |
| Granary | 1×2, cost 40 wood, holds 500 lb; 25% of farmers carry, 4 trips per workday each, carrying everything waiting |
| Town Hall food storage | 150 lb; colony starts with 100 lb |
| **Food balance target (Decided)** | about **30% of the population farming** feeds everyone (soldiers eat but don't work). Planned split: ~30% farmers, 30–40% soldiers, ~30% everything else. Each farmer makes about 13.3 lb/day on grassland; each villager eats **4 lb/day** (Decided). |
| Lumber Camp | capacity 6, full output about 130 wood/day, cost 30 wood, forest tile only |
| Market | capacity 4, about 50 gold/day at full staff, cost 50 wood + 4 furniture |
| Barracks | 2×2, 70 wood + 20 stone + 6 furniture, 30 soldiers |
| Training Grounds | 3×3, 50 wood + 3 furniture, 50 soldiers |
| Tavern / Chapel | 60 wood + 6 furniture + 20 gold / 50 wood + 60 stone + 6 furniture + 50 gold; chapel radius 7 tiles |
| Hunter's Lodge | 2×2, 50 wood, forest only, 4 workers, about 45 lb/day, holds 60 lb |
| Well | 1×1, 10 wood + 20 stone, homes within 4 tiles +5 happiness, evening stop |
| Stockpile | 3×3, 20 wood, holds 800 goods, 4 haulers |
| Wright's Lodge | 2×2, 40 wood, 4 wrights; 1.5 wright-hours of work per building tile |
| Quarry | 2×2 on stone, 30 wood, 4 workers, about 80 stone/day, shelf 45 |
| Carpenter | 2×2, 50 wood + 20 stone, 3 workers, about 12 furniture/day from 8 wood each, shelf 12, keeps 60 wood |
| Lumber Camp shelf | 60 wood |
| Walking speed | 3 tiles per second |
| Tax | about 1.5 gold/day per villager |
| Births | with food going up, food in store, and a free bed: about 1.2 births per day per house with a free bed |
| Town Hall Lv 1 house cap | 4 houses (Lv 2: 8, Lv 3: 14: placeholders) |
| Army cap | 30% of population |
| Squad size | 10 (cavalry 5) |
| Squad cost / upkeep | Spearmen 200/5, Swordsmen 225/6, Archers 225/6, Cavalry 300/8 gold |

Mockup numbers (28/36 villagers, +14 lb/day, 240 wood, 180 gold) are only illustrative.

---

## 13. Milestones

### Milestone 1 (first version): "Living colony"
Goal: a playable colony you can watch and tune.
- Full-screen map with **grassland and forest** tiles, pan and zoom.
- **Place the Town Hall** at the start.
- Build menu with categories, **drag a card onto the grid** to place. Valid/invalid ghost.
- Buildings: **Town Hall, House (at least House and Hut), Farm, Lumber Camp, Market.**
- **Villagers** spawn, live in houses, and **walk** to their job, house, and town hall.
- **Assign villagers** to buildings; efficiency scales evenly with workers present. Idle count shown.
- **Food as a rate** with a **granary** bar; **wood** and **gold** stockpiles; **taxes**.
- **Births** (food surplus plus free beds).
- **Desire paths:** foot traffic painted into worn paths and roads, soft and organic, decaying over time.
- **Day cycle, pause, 1x/2x/3x**, speed via simulation ticks.
- **Top-left status panel, top-right speed and alert area, bottom category chips, card row, and main bar** (Build tab working; other tabs can show a "coming soon" panel).
- **Town Hall level display** and the **house cap** tied to it (upgrading can be a simple button for now).
- **Autosave** and resume.
- Art matching **mockup E**: flat vector, hard shadows, bold outlines, detailed buildings, worker-count badges.
- All numbers from a **config file** (section 12).

**Done when:** the owner can start a game, place a town hall, build a few houses, farms, and a lumber camp, watch villagers walk to work and see roads form, watch food and gold rates change, pause, speed up, close the app, and resume.

### Milestone 2
Town hall levels and requirements, **tech tree (gold)**, more buildings, taxes tuning, more house variants.

### Milestone 3
**Grand map**, parties travelling, tributary colonies, alerts.

### Milestone 4
**Military:** squads, barracks, recruiting, upkeep, training.

### Milestone 5
**Battles** (after the open design questions are answered), conquest payoff, enemy attacks.

### Milestone 6
Art pass, polish, sound, balancing across the 20-hour campaign.

---

## 14. Open questions

1. **Battles:** how much control during a live battle? What do defensive buildings change?
2. **Squad casualties:** exact "broken squad" threshold. Does a broken squad fight at reduced strength?
3. **Conquered colonies:** can they rebel or be retaken? Should the villager intake grow into something richer later?
4. **Starvation:** exact effects when the granary is empty (population loss, slower births, unrest).
5. **Gold sinks:** what else is bought with gold beyond buildings, tech, and upkeep?
6. **Parties:** other uses besides attacking? Can enemy armies be intercepted?
7. **Town hall:** how many levels? What does each unlock?
8. **Campaign size:** how many grand map colonies and town hall levels fill about 20 hours? (Needs playtesting.)
9. **Unit and counter numbers**, training time, and how fast squads improve.
10. **Villager destinations and happiness:** which places, and what does happiness do? (Not in v1, but plan for it.)
11. **Desire paths:** do worn roads speed villagers up? Do they affect anything else?
12. **Farm placement:** can farms be built on forest tiles at reduced output, or grassland only?
13. **Seasons and night:** wanted or not? (Mockup F shows a possible dusk look.)
14. **Art:** confirm E as the final art style (the owner said they like E's UI; the art could still get more detail).
15. **Tech choice:** confirm the web (TypeScript + canvas) recommendation.
16. **Game name.**

---

## 15. Progress log

- Design brainstorm complete through colony systems, villager movement and desire paths, military, conquest, and UI direction.
- UI and art direction chosen: **mockup E (flat vector, Prison Architect style UI).**
- Repo made public. Hosting: **GitHub Pages**. Every push builds the game automatically (`.github/workflows/deploy.yml`) and publishes it to the `gh-pages` branch. Play link: https://elliotjax.github.io/swords-and-spears/
- **M1 step 1 done:** project setup (Vite + TypeScript + canvas), config file `src/config.ts`, auto-deploy.
- **M1 steps 2–5 done (first playable):** grass/forest map with pan + pinch zoom; drag-a-card building placement with green/red ghost (or tap a card, then Place); Town Hall first; Hut, House, Farm, Lumber Camp, Market (Cottage/Longhouse unlock at Hall Lv 2, Manor at Lv 3, Defense cards locked); villagers walk home → work → town hall → home on a day schedule; jobs assigned with +/− (building panel or Villagers tab); food rate + granary, wood, gold + taxes; births; worn desire paths; night tint; status panel, speed buttons, alerts, Town Hall chip and upgrade; autosave.
- **M1 polish:** game starts on a fresh morning; first alert says "Build a Farm"; softer, rounder worn paths; faster drawing (off-screen buildings skipped). Tested: drag-to-place, tap-to-place, tapping buildings, save + reload, 300 villagers (game logic 0.16 ms per step).
- Defaults chosen (owner OK'd): v1 houses are Hut + House; Town Hall upgrade is a simple button (wood + gold); farms grassland only; empty granary = births stop + alert (nothing worse yet); roads are looks only (speed bonus setting exists, off); map 40×40 (now 64×64), random each new game.

- **Owner playtest 1 feedback (all built):** phone feel good. Food is now a stockpile in lb with a per-day change; granary shown as % full; Births/day row added to the status panel (Villagers tab explains when births are blocked); births faster; day length 5 min with the same real-time pace; villagers walk to the actual doorway (front side) and fade in/out there, walking along building edges to reach it; thin, connected gravel roads with diagonals and curves; dragged building sits under the finger. Old saves from the first version can't be loaded (start a new game).
- **Granary + clock update (built):** Granary building (1×1, 500 lb); farm food waits at the farm until farmers carry it to the nearest granary 4× per workday (production continues while they're away); Town Hall stores 150 lb; food balanced so ~30% farmers feeds everyone; 24-hour day (5–8 free, 8–17 work, 17–20 free, 20–5 sleep); one combined time + speed panel with a clock dial; "Build a Granary" alert. Villagers no longer cut through buildings when they change plans mid-walk. Old saves can't be loaded (start a new game).
- **Schedule + carriers update (built):** granary is 1×2; only 25% of farmers carry food (everything waiting, 4 trips/day); carriers don't farm while away (delivery penalty shown on the farm panel, and included in the food rate); work 5 AM–5 PM with personal wake-up times so everyone is at work by 5; free time 5–8 PM; sleep from 8 PM; night runs 2× faster while everyone is asleep; clock shows "Day N, Year Y" (24-day years). Tested: all workers at work at 5:00, shown food rate matches real output (302 vs 305 lb/day). Old saves can't be loaded (start a new game).
- **Free-time errands (built):** evening routes (house / Town Hall / Market / Granary), milling around at each stop, nearer stops preferred, home by bedtime; food eaten only during free time. Tested: 2–4 stops per villager, everyone home by bedtime, food never drops outside free time.
- **Roads + keeper update (built):** roads update once a night and fade in, build over ~2/4/6 days, fade ~1 level per 3 days, all traffic counts; new buildings start full of idle workers; granary needs 1 keeper assigned to accept food ("Granary has no keeper" alert). Old saves can't be loaded (start a new game).
- **Food numbers (Decided):** villagers eat 4 lb/day; farms rescaled to 85 lb/day (106 on grassland) so ~30% farmers still feeds everyone; granary still 500 lb (now about 125 villager-days); farm holds 100 lb.
- **Military + town update (built):** Swordsmen/Spearmen/Archers (10) and Cavalry (5) squads; recruiting from idle villagers; Barracks (2×2, 30) and Training Grounds (3×3, 50); ranks Recruit → Trained (7 days) → Veteran (+30) → Sergeant → Elite (+120); upkeep; disband; Military tab (Overview with formation preview, Recruit); soldier art sketch. Houses are now House 10 / Longhouse 25 / Manor 50. Tavern and Chapel (with radius) as free-time places; happiness shown (no effect yet). 5 Town Hall levels. Unlock cheat. Walking 3 tiles/s. Granary is the 1st or 2nd evening stop. Old saves can't be loaded.
- **Pixel art (built):** whole map redrawn in the roofless pixel style; tiny pixel villagers and soldiers; people visible inside buildings (asleep in beds at night); pixel build-menu pictures. Much faster to draw (60 fps with 300 villagers in the stress test).
- **Battles v1 (built):** Battle Lab with individual soldiers (100 HP, 3–5 hits), squad HP bars, targeting, melee/arrows/cavalry charges, breaking at 20% → 20 s → flee, left-vs-right, auto camera, results, 50-battle balance runs. Taller 3×5 figures. Easier building taps.
- **Battles v3 (built):** realistic battles modelled on Total War and real medieval fighting: fighting lines that hold and push instead of blobs, morale with wavering and spreading routs, hard-hitting charges with knockback, spearmen bracing, cavalry cycle-charges and pursuit, archer volleys with limited arrows and friendly fire, the army marching as one line, blood/bodies/dust/sparks. Battles ~2 minutes.
- **Living town (built):** hearth fires flicker and smoke rises from homes when people are in or cooking; chickens peck by farms and granaries, sheep graze beside farms, flocks of birds fly over; warm firelight glows at night.
- **New buildings (built):** Hunter's Lodge (food from the forest) and Well (evening gathering spot, small happiness bonus nearby). The starter-town button now builds them too.
- **Tech tree v1 (built):** 18 techs in the Tech tab (farming, wood, gold, people, military), bought with gold at the Town Hall, one at a time. Old saves keep working.
- **Goods + bigger map (built, first draft):** map is now 64×64 with stone deposits. New real goods: **stone** (Quarry, on deposits; deposits never run out) and **furniture** (Carpenter, from wood). New **Stockpile** (holds goods, its workers are haulers) and **Wright's Lodge** (wrights build things); you start with one of each, free. Every good is somewhere real and is carried by haulers; placing a building makes a building site that haulers supply and wrights build (it rises as they work); Town Hall upgrades are built the same way. People only produce while actually working; full shelves stop work. Advanced buildings need furniture; bigger ones and hall upgrades need stone. Hauler/wright priorities explained in 7.4b. Tested with a headless simulation (early game from scratch, the big test town for 6 days, hall upgrade, removing a full stockpile) and screenshots. Old saves can't be loaded (start a new game).
- **Battles v4 (built):** organic fighting (fraying formations, wrapping round, fight to the death, turning on attackers, ganging up penalties), every soldier and every blow different (skill, nerve, glancing/heavy blows, blocking, soldiers running on their own), reserves, armies up to 1000 soldiers on a field that grows, longer battles. Details in section 10.
- **Battle deployment (built):** deployment screen in the Battle Lab: drag squads, tray of cards (drag onto the field), Clear/Auto, draw arrows (paths) from a squad's ➜ knob; no arrow = hold ground; squads on arrows fight back but only stay for real fights and don't chase far; at the end of the arrow they attack freely. Tested by simulated taps and drags on a phone-sized screen.
- **Battle AI v6 (built):** flank reactions, protecting friends, cavalry timing, archers falling back, reserves relieving wavering squads, enemy plans chosen from the armies, `npm run battle:check` test tool, CLAUDE.md notes for future sessions.
- **Advance all + smarter arrows (built):** Advance all/Advance/Hold buttons; infantry leave arrows near the enemy, archers stop to shoot, cavalry keep to arrows; less lane-like fighting; squads help losing friends.
- **Fix: enemy rank in the Battle Lab** (owner noticed): changing the enemy's rank didn't reach its squads (they were built earlier and kept their old rank). Fixed. With it working, training matters a lot: in even mixed battles the better-trained side won 20/20 (Recruit vs Trained, keeping 65% of its men; vs Sergeant 78%; vs Elite 83%). `battle:check` now includes a sergeants-vs-recruits line.
- **Courage + cavalry jobs (built):** friends beside you steady you (early wavering 12% → 1%); cavalry guards and raiders; archers shoot raiders behind the line (spread out); infantry turn and brace against raiders.
- **Visible pushes + archer raids (built):** pushes limited to one group of up to 3 squads that really drives the line back (1.7 tiles on average), +15% attack speed and exposed while pushing; cavalry raid archers first (13% → 34% of their main-battle fighting).
- **Big pushes together (built):** commander thinks every 1.5 s; pushes are events of 2 to 5 squads starting together (about 2 to 3 per army per battle); neighbours of a pushed squad bend back with it; reserves plug the gap; lone squads regroup with friends. `tools/battle-main.ts` now also prints push sizes, gap-plugging and regroup orders.
- **Heavy swordsmen + Lab fix (built):** new unit (1.75x damage, 1.45x HP, 10% armor, new `armor` stat and per-unit `hp`); Lab no longer resets your formation when you change the enemy army; Lab unit rows use short names so they fit.
- **Squad footprints (built):** readable pushes and gaps in big battles (blocks, push chevrons, brace bar). Checked with a 860-soldier battle: infantry squads were fighting ~90-100% of the time and ~80-90% of their soldiers were in a fight; archers on 'support' stand back by design (shooting).
- **Cinematic button + brighter team colours (built).**
- **Warlord boss (built):** giant with 600 HP and slam splash damage; Lab row 'Boss'; see section 10.
- **Cavalry fixes (built):** raiders no longer dither at the map edge; cavalry now go after enemy cavalry raiding behind their line.
- **Commander v2 (built):** seven battle plans picked by chance + character, idle squads go through gaps / round the ends, shoring up, feints, counter-attacks, archer focus, guarding a wing against massed horse; new test `tools/battle-ai.ts` (idle time and variety).
- **Breakthroughs + cavalry priorities (built, prototype):** the commander finds a weak spot, pushes through it with a reserve and a cavalry charge, then rolls up the line; one chaser per flank threat; cavalry-vs-cavalry time 56% → 30%.
- **Battle dynamics (built, prototype):** fatigue with a green/yellow/red badge dot, pushes and bracing with shoving physics, commander battle plans (strike a wing, centre, both flanks, defend then counter) shown in the Lab, reserves one at a time round the flank, relief and rest of tired squads, rolling up the line, longer battles.
- **Army commander v1 (built):** baseline before it (old AI, full check): all counters 10/10, mirror mixed 15–25, 400 soldiers 3–7, 1000 soldiers 4–2, 0% idle, 1.67 ms/step at 1000. Then: `commander.ts` (missions with reasons for every squad, reserves, screens, raids, rear charges, rally), squads follow missions with emergency exceptions, Lab switch "The commander / You", mission words under badges, `battle:check` runs with commanders by default and reports idle-without-reason, deliberate waiting, mission changes and reserve commits. A separate later task: making individual fights readable on a phone.
- **Next:** owner tests battles in the Battle Lab; then decide battle control, connect battles to the colony (real squads), grand map + enemy kingdoms + AI. Also still open: tech tree, happiness effects, where people eat.
- Then: owner playtests again. Then Milestone 2 (town hall levels, tech tree, more buildings). Placement feel ("a tiny bit weird") to revisit later.

- **Testing sidebar (built):** a small vertical bar on the right edge with **10× speed**, **+10 villagers**, **+100 gold**, **+Goods** (100 wood, 50 stone, 10 furniture into the stockpiles). Also **Town** (one tap builds a free starter town: Town Hall if needed, 2 Manors, Longhouse, 2 Houses, 4 Farms, 2 stocked Granaries, 2 Lumber Camps, Market, Tavern, Chapel, Barracks, Training Grounds, ~85 villagers with every job filled and spare idle ones) and **Unlock** (no progression locks). Turn it off with `showTestTools: false` in `src/config.ts` (the fast speed is `testSpeed`).

### Getting the newest version on the phone
The game checks for a newer version whenever it's opened (and every 2 minutes). If there is one, a green **"New version: tap to update"** button appears; tapping it saves the game and loads the new version. The Menu (☰) shows the build number. The button also shows inside the Battle Lab (just under its top bar), so you don't have to leave it.

### How to go back to an earlier version
Every step is saved as a commit. Ask Claude: "go back to before <step>" and it will undo it. You can also see all checkpoints on GitHub under **Commits**.
