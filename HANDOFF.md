# HANDOFF: everything from the long battle-engine session (temporary file)

Written so a new chat (for example inside a Claude project) can pick up exactly where this one stopped, with nothing lost.
**Read order for a new session:** this file, then `README.md` (single source of truth: section 1 owner rules, section 10 battles, section 15 progress log), then `CLAUDE.md` (where things are, how to test).
Delete this file once its contents live in README/CLAUDE.md and the new chat is going (the owner can say "delete the handoff").

Branch: `claude/vigilant-maxwell-ov022y` (every push auto-deploys to GitHub Pages: https://elliotjax.github.io/swords-and-spears/ , the game shows a green "New version" button). Repo: `elliotjax/swords-and-spears`. Last commit at the time of writing: "Push v2 (rarer, bigger ...), crowd pressure physics, only front two ranks strike, soldiers hurry". All work is committed and pushed.

---

## 1. The owner and how to work with them

- Designs the game, **does not code**, plays on an **iPhone** (portrait, about 390x844). Explain in **short, plain language**: what you built, how to try it, what is next. They send phone screenshots, often with hand-drawn circles/arrows on them; treat those as the real bug report.
- **Limited usage:** plan briefly, don't re-read big files you don't need, don't write essays; spend effort on code and tests.
- **Do not start building until they say "go"** (unless they've given freedom for a task). In this session they said "go", "Just do whatever you want and we can tweak it", "Take your time, do a bunch of tests", "Let's get a prototype going" for most battle work. For vague asks, propose a short plan and ask for "go" first.
- **Don't create a pull request** unless asked.
- **No model names** in commit messages or code. The commit trailer is added by the session's attribution reminder (a `Co-Authored-By: ... ` line and a `Claude-Session: https://claude.ai/code/session_0161MiCgN1Mwg3A7xRHpFDzr` line): follow whatever the current reminder says.
- **Every balance number lives in `src/config.ts`.** `npm run build` must pass (it type-checks). Commit after each working step and push. A Stop hook complains if there are uncommitted/untracked files: commit and push, delete scratch files.
- Keep README.md updated with every decision and add to the progress log (README section 15). CLAUDE.md has the testing and architecture notes.
- Models used in this session changed several times (the owner switches with /model); behaviour rules above stay the same.

## 2. What the project is

"Swords and Spears": a phone-first medieval colony sim (Vite + TypeScript + Canvas2D, fixed-step sim at 20 ticks/s, pixel art, saves in localStorage, `SAVE_VERSION` 7) with a **Battle Lab** (`src/battle/lab.ts`) for fighting battles between armies of squads of individual soldiers. Colony side (goods, haulers, 64x64 map, tech tree, barracks/training) is built and was not touched in the later part of the session. **This whole session's focus was the battle engine and AI.** Eventually battles connect to the colony and a grand map (not built).

## 3. Code map (battle side)

- `src/config.ts`: all numbers. `CONFIG.battle` holds `units` (per-unit stats: damage, cooldown, reach, speed, defense, `armor`, `courage`, `hp`, `block`, `radius`, `mass`, `worth`, `splash`, `strongVs`), `morale`, `fatigue`, `push`, `crowd`, `cohesion`, `lull`, `charge`, `melee`, `soldier`, `ai`, and `commander` (with `doctrine`, `org`, `op`, many more). `CONFIG.military.units` is the colony-side unit list (sizes, costs; `noRecruit` hides the boss).
- `src/battle/battle.ts` (about 1250 lines): the engine, no drawing. `createBattle`, `stepBattle` (line + commander call, squad loop, soldier loop, separation/crowd step, arrows, end), `detach()` (splits a detachment off a squad mid-battle), exports used by tools/lab.
- `src/battle/commander.ts` (about 770 lines): the army commander (WHAT and WHY), `commanderThink`, missions, plans/doctrines, army organization, breakthrough charges through gaps, shoring up, archers focus, cavalry options, `postOf`.
- `src/battle/pushop.ts` (about 280 lines): the **push operation** with its own 0.3 s manager (`startPushOp`, `pushOpTick`, `endPushOp`).
- `src/battle/lab.ts` (about 1150 lines): Battle Lab screen: deployment (drag squads, tray, arrows, multi-select), enemy plans (`PLANS`), presets, drawing (soldiers, footprints, badges, push bars/arrows), cinematic button, Push button, touch.
- `src/render/pixel.ts` (sprites: `SPRITES`, `SP_COL`, `big3` for the boss), `src/render/draw.ts`, `src/ui/ui.ts` (`unitIcon`, recruit cards).
- Tools (`npm run battle:check` plus esbuild-bundled scripts, see section 6): `tools/battle-check.ts`, `battle-main.ts`, `battle-ai.ts`, `battle-shape.ts`.

**Three levels of intelligence** (design brief in `COMMANDER_TASK.md` and `PROJECT_COLLABORATION.md`, the latter written with ChatGPT: only build from it what the owner authorizes):
1. Commander (every 1.5 s per side): gives every squad a `mission` with a reason (advance, attack, flank, reinforce, intercept, reserve, screen, raid, shock, pursue, disengage, support, second). Shown in the Lab under the badges.
2. Squad (in `stepBattle`): carries the mission out (route, position, target), emergency exceptions (turn on a flank attacker, brace vs cavalry, pull out), posted missions (reserve/screen/second) stand at `postOf`.
3. Soldier: picks a nearby opponent, parries, morale, nerve, etc.

Owner decisions that still stand: **rout counts as defeat**; **no fog of war / personalities / difficulty / learning yet** (read the enemy through `observe()` so fog can be added later); **the commander is the only one giving orders in v1** (Lab has "Command myself" switch; deployment arrows/hold/advance code still works); individual-fight readability on phone is a separate later task (don't change soldier spacing 0.34, owner wants tight formations); the commander never leaves a squad idle without a reason.

## 4. What was built this session (newest last; details in README section 10 and the progress log)

Colony/economy (earlier): goods (wood/stone/furniture) physical with haulers, stockpiles, wrights, 64x64 map with stone deposits.

Battle engine and AI (everything below is pushed):
- Battles v4-v6, deployment screen (arrows, multi-select, Advance all), courage by support (friends beside you steady you), enemy plans in the Lab.
- **Army commander v1**, fatigue (green/yellow/red dot), pushes and bracing with shoving physics, plans, breakthroughs, cavalry priorities, visible pushes, archer raids.
- **Big pushes together** (2-5 squads), lines bend, reserves plug gaps, lone squads regroup, commander thinks every 1.5 s.
- **Heavy swordsmen** (`heavy`: 1.75x damage = 13.1, 1.45x HP = 145, `armor` 10% (new stat), `courage` 2 (new stat: all morale loss divided by it); front-row middle; recruitable at 450 gold placeholder).
- Lab: keeps your formation when the enemy army changes; short unit names; **squad footprints** (team-coloured blocks, push chevrons, brace bar), **cinematic button** (hides badges/words/blocks/panel), **brighter team colours** (red `#e6402e`, blue `#3f78ee`).
- **Warlord boss** (`boss`): one giant, body radius 0.75 (3x), 600 HP, damage 80 slam with 2-tile splash (75% to everyone near the target), mass 6, courage 4, `worth` 4 for the commander; Lab only (`noRecruit`).
- **Cavalry fixes**: raiders dithered at the map edge (committed `viaEdge` ride, `ai.raidTurnIn`); cavalry now answer enemy raiders behind their line (`cavAnswerRange` 16, `cavAnswerers` 2).
- **Commander v2**: seven doctrines picked by weighted chance + character (`c.temper`: aggression, cavalry boldness, patience): envelop, double, centre, defend then counter, feint then switch, cavalry hook, refuse a flank. Initiative (idle squads go through gaps / round the ends), shoring up losing parts, archers pick a focus, a reserve guards a wing when enemy horse mass there. `tools/battle-ai.ts` measures idle time and variety.
- **Research + Engine v2 step 1** (see section 7 for the research): surges and lulls (infantry fight in bouts then take a breather, `lull`), **cohesion** (`q.cohesion`), lines hold apart (`melee.foeGap`), `tools/battle-shape.ts`.
- **Infantry charge boost**: first hit 4.5x (can't be parried), momentum (+25% damage, +30% speed for 4 s), line charges after breathers, aggressive squads pounce on resting enemies.
- **Breakthrough charges through holes in the enemy line** (`gap*` config): holes found soldier by soldier; sends a reserve, else an idle squad, else detachments (rear 4 men) from squads beside the hole; line up with the hole's mouth, run through, turn on the weaker squad beside it; +18% speed (`rushSpeed`); free cavalry joins.
- **Push operation** (`pushop.ts`): own 0.3 s manager; assault (break in) then wrap (through and along the back of their line, meet enemies up to 15 tiles behind), corners send half their men round. Lab **Push button**: tap or draw a line on the battle line (length sets width 6-16 tiles). **Push v2** (latest): commander starts 2 + 1 per 25 infantry squads, max 6, rarely; squads within 12 tiles charge the point at once; squads fighting along the line (up to 8 tiles further) all push; squads further back (up to 25 tiles, capped 12% of infantry) move up and push beside the charge to fill in for the reserves.
- **Army organization for big battles**: front line about the deployed width (capped, at most half the infantry fights at once), **second line** posted behind front squads (mission `second`), rotation of tired front squads, flank budget. Measured in 2000-soldier battles: fighting share 80% -> 55-60%, second line 8 -> 13-17 squads.
- **Crowd pressure** (`CONFIG.battle.crowd`): men leaning forward pass on the weight of friends behind them; pressure makes a man heavier against enemies and creeps him forward. **Only the front two ranks strike** (`melee.strikeRanks`). **Soldiers hurry** when far from their place (`soldier.hurry*`).
- **Lab presets trimmed** to Balanced, Huge (400), Epic (1000), **Shield Wall (1500 v 1500)** (50 swordsmen + 50 heavy + 50 spearmen squads per side = 3000 soldiers). **Speed work** for huge battles (flat grid for the separation step, every other tick above `bigBattleSoldiers` 1500, slower bookkeeping 4x/s, running count of "sent at").

## 4b. Added after this file was first written
- Push rewritten: dot = recruit circle (20 tiles), arrow = direction, 15-tile corridor, all free squads charge at once (the old bug: they waited behind friends). Pushing rebalanced (`exposedParry` 0.95, `pushMul` 1.6) after an A/B test showed pushes were a net loss.
- Bigger battlefield (`fieldMargin`).
- `src/battle/maneuver.ts`: battle groups + contract / refuse / mass / shift, mission `reform`, fighting withdrawal. A/B tested: neutral (don't hurt, don't clearly help). **The owner's core complaint still stands: big battles look like one long ragged line and every battle looks alike; manoeuvres exist but aren't dramatic yet.** Ideas: bigger, earlier, more visible manoeuvres (whole wing moves), formation shapes (wedge, column), true re-forming when both sides separate, deployment variety (not always one line: e.g. deep centre, strong wing, echelon) chosen by doctrine before contact.
- A/B test scripts lived in `node_modules/.cache/ab.ts` (not committed): 20 battles of 12/12/6/10, one side with the feature disabled via `b.cmd[s].nextMan = Infinity` / `ops = 99`, alternate which side and swap sides.

## 5. Latest measurements (use as a baseline; test machine, may differ from phone)

Full `npm run battle:check` after push v2 + crowd pressure: all unit counters hold (spears beat cavalry, cavalry beat archers, archers beat spears, swords beat spears, heavy beats equal swords/spears/archers, cavalry lose to heavy, boss: beats 2 sword squads, about even with 4, loses to archers sometimes), mirror fairness near 50/50 (160-battle mirrors: red 75-90/160; 6 swords mirror 5/15 in one run was a fluke, re-run over 320 battles gave 55%). Battle length: mixed 2.6 min, 400 soldiers 3.2, 1000 soldiers 4.3. Speed per step: 1000 soldiers about 4.4 ms (target for 1x is 50 ms per step, so fine), **Shield Wall 3000 soldiers about 41 ms per step on the dev machine = slower than real time at 1x on a phone, likely slow motion**. Idle soldier-time 14-19% overall (cavalry about 30% mostly riding). Crowd pressure: about 40% of men touching the enemy have pressure 1+, about 1 in 10 have 4+. Push operations: 1.5-3 per battle in mid-size battles.

## 6. How to test (important: you cannot watch battles move)

- `npm run battle:check` (add `-- quick`, `-- map`, `-- legacy`): about 3-4 minutes full; **it exceeds the 120 s tool timeout: run it in the background** (`(npm run battle:check > /tmp/full.txt 2>&1 &)`) and wait with the Monitor tool (until grep "epic 1000"), then read the file. Lines marked `<-- CHECK` need a look (small samples swing: confirm with bigger runs).
- Bundled tools: `npx esbuild tools/<x>.ts --bundle --platform=node --outfile=node_modules/.cache/<x>.cjs --log-level=warning && node node_modules/.cache/<x>.cjs [quick]`:
  - `battle-ai.ts`: idle time by unit/mission, plan variety, gap charges, push operations.
  - `battle-main.ts`: first 75 s after contact: what cavalry fight, pushes (count, length, line movement), big-push stats.
  - `battle-shape.ts`: mixing (enemies behind a man), losses, lull/surge rhythm, cohesion; `battle-shape.ts a` = experiment with half damage.
- Mirror fairness test (scratch, was kept in `node_modules/.cache/fair.ts`, not committed): create 160 battles of 2 swordsmen/2 spears/2 archers/2 cavalry squads a side with `commander: [true, true]`, `swapSides = i % 2 === 1`, count red wins and "left side" wins. Re-create it if needed (about 10 lines using `createBattle`/`stepBattle`).
- Screenshots: `npx vite --port 5173` in the background, then Playwright (preinstalled, `require('playwright')`): open `http://localhost:5173`, `window.game.lab.open()`, set `lab.counts`, `lab.rebuildArmy()`, `lab.view='fight'`, `lab.speed=10`, `lab.autoCam=true`, wait for `lab.b.t`, set `lab.speed=0.0001` to freeze, `page.screenshot`. Phone viewport 390x844, `deviceScaleFactor: 2`. Kill vite after (`pkill -f "vite --port 5173"`). The Push button is `button[data-lab="push"]`, cinematic `#labCine`.
- Profiling: `node --cpu-prof` on a bundled script, then read the `.cpuprofile` (used to find the separation loop and commander bookkeeping hot spots).

## 7. Research findings (README section 10 "Battle research")

Historians (Sabin, Devereaux): losses low while the lines hold (often 5% or less), most deaths in the rout and pursuit; fighting in short local surges with lulls; morale and cohesion are separate things. Total War: per-soldier simulation, mass/speed in charges, morale states; Medieval II cohesion for pikemen; tabletop rules count "hits" as lost fighting ability and only the front fights. **The owner explicitly wants most soldiers to fight to the death** ("more entertaining"), so killing stays high (winners lose 40-70%) even though history says otherwise; the realism work focused on lines, rhythm, cohesion instead. Measured before engine v2: soldiers mixed into the enemy ranks about 33%, now about 20%.

## 8. Open problems and the owner's latest concerns (nothing here is fixed yet)

1. **Big battles (the owner focuses on 2000 soldiers, "lategame")**: everything becomes one very long line that gets weeded out; late in the battle (fewer than half left) the line still thins to one ragged line; both armies stretch to 26-31 tiles. The owner wants Total War-style management of **multiple formations**.
2. **Phone performance**: Shield Wall (3000 soldiers) likely runs in slow motion; 10x/3x won't keep up in big battles. More speed work possible (the separation step and `stepBattle` soldier loop dominate; consider a typed-array soldier store).
3. **Push operation known limits**: late in a battle the line already has holes so a push "breaks through" at once; the wrap follows squads, not a drawn route; the player can't yet choose which squads join or draw the wrap; Push button only tested with a mouse in a browser, not on a phone. The Push button only appears when the player's side is commander-led.
4. Detachments never rejoin their squad (shown as "(detachment)" in results).
5. Gaps in the middle of a line are rare, so most initiative goes round the ends.
6. Cavalry idle about 30% (mostly riding); charge-withdraw cycles can look like standing around.
7. Colony recruit menu shows cavalry at 160 HP / attack 16 (old placeholders; battles ignore colony hp/attack: only `CONFIG.battle.units` counts). Heavy cost 450/upkeep 10 are made-up placeholders.
8. Tuning knobs the owner may want to change after playing: number of pushes per battle (`op.aiCount/aiPerSquads/aiFirst/aiEvery`), charge radius 12 (`op.chargeRadius`), crowd pressure strength (`crowd.*`), bout/breather lengths (`lull`), infantry charge numbers (`charge.*`), plan weights (`commander.doctrine`), front share (`org.frontShare`).

## 9. Ideas discussed but NOT built (need "go" from the owner)

- **Battle groups** (the suggested next step, not yet approved): split the army into left / centre / right formations with their own sub-commanders and a small reserve each; each group re-forms a shorter, deeper line as it shrinks; fall back and re-form after a collapse.
- Re-forming a shorter line as the army shrinks; falling back to re-form after a collapse; retreat and rally of the whole army.
- Player-controlled commands in the Lab: the Push button exists; later: choose which squads join, draw the wrap route, "command myself" mode with these tools.
- Fog of war (`observe()`), difficulty, personalities, learning between battles: explicitly deferred by the owner.
- Squads wheeling to face several attackers, one-on-one duel animations, saved formations, sound.
- Readability of individual fights on a phone (art/animation); a separate later task.
- Connect battles to the colony (real squads), grand map + enemy kingdoms + AI; happiness effects; more buildings.
- Possible tweaks: have detachments rejoin; a typed-array soldier store for speed.

## 10. Process notes / gotchas learned

- The 2-minute tool timeout: run long checks in the background and watch with Monitor; read results with `cut -c1-108`.
- Never leave scratch files in the repo (`tools/_*.ts` or untracked files trigger the Stop hook); keep scratch in `node_modules/.cache/` or the scratchpad directory.
- Small samples swing a lot: confirm fairness with 160+ battle mirrors, swap sides every other battle (`swapSides`), and look at both "red wins" and "left side wins".
- Deterministic seeded rng (`rand(b)`, `hash01`): the same seed gives the same battle; use different seeds for variety tests.
- `git status` must be clean at the end of a turn; commit message ends with the attribution trailer lines the system reminder gives.
- The `read_documentation` tool and project docs cover environment/network questions; GitHub MCP tools are for GitHub (no `gh` search needed here).
- Owner screenshots usually come from the Lab at 1x/10x on an iPhone; "blob of pixels" complaints led to footprints, cinematic mode and brighter colours.
