# TASK: Army commander, first version (authorized by the owner, 2026-11-10)

> **Status: built (first version).** Results, limits and next steps are in README section 10 "Army commander, first version". Not done from this brief: a measured "time to answer a flank threat" in `battle:check`; using the Lab's plans for more than the enemy's starting formation.

This is the one authorized task. Do **not** build anything from `PROJECT_COLLABORATION.md` that isn't listed here (no fog of war, no difficulty levels, no personalities, no learning between battles, no art/readability work).

Read first: `README.md` (section 1 rules and the Battle AI notes in section 10), `CLAUDE.md`, then `PROJECT_COLLABORATION.md` sections 4, 5 and 9 (the three layers, cavalry missions, tests). Then the code: `src/battle/battle.ts` (`createBattle`, `stepBattle`: squad step and soldier step), `src/battle/lab.ts` (`PLANS`, deployment, `pickPlan`), `CONFIG.battle.ai` / `.orders` / `.morale` in `src/config.ts`, `tools/battle-check.ts`.

## Owner's decisions (final)
- **The commander is the only one giving orders in this version.** No player control yet (in the final game the player will choose: command the army yourself, or let the commander do it). Keep the existing deployment screen, arrows, hold and Advance code working and untouched where possible: it comes back later. In the Battle Lab add a simple switch "Who commands your army: Commander / Me" (default Commander). The enemy is always commander-led. Both sides run the **same** commander code with the same rules (fairness is a hard requirement; check mirrored sides).
- **The commander never leaves a unit idle.** Every squad always has a mission. The only waiting allowed is deliberate and labelled with a reason: a reserve held for a later commit, or infantry protecting a flank (and that infantry stays close to the formation). Make `battle:check` measure "idle with no stated reason" (should be about 0).
- **Rout counts as defeat** (unchanged battle end rules: an army loses when it has no squads still fighting).
- **No fog of war for now**: the commander may see everything, but read the enemy through one small function (e.g. `observe(side)`) so fog can be added later without a rewrite. No personalities or difficulty. Deterministic, explainable heuristic AI (utility or rules), no machine learning.
- **Cavalry missions are dynamic**, assigned by the commander (replace the fixed guard/raid roles): Screen, Intercept, Flank, Raid, Shock (charge, withdraw, charge again), Reserve, Pursue, Disengage. Screening cavalry must react to enemy **infantry** flanking too, not only to cavalry. Infantry also get commander missions: hold the line, protect a wing, wheel to face a flank threat, reinforce a fighting squad, advance.
- Enemy "plans" in the Lab (`PLANS`: Line, Wide line, Crescent, ...) can become the commander's opening deployment/posture; your call how.

## The core idea: three levels of intelligence that divide the work (the owner cares most about this)
| Level | Decides | What it does | Status today |
|---|---|---|---|
| **Army commander** (new, the job here) | WHAT and WHY | One per side. Holds a persistent plan and re-thinks every ~2 to 4 s. Gives each squad a mission: protect the centre, strengthen or cover a wing, commit or keep a reserve, exploit an opening, send cavalry to screen, flank or raid. Does not pick individual soldier targets and does not change its mind every tick. | Doesn't exist. Only crude pieces: the Lab's enemy plans, the army march line, cavalry guard/raid roles fixed at the start. |
| **Squad** (exists, must change) | HOW and WHEN | Takes its mission and works out the route, position and target while keeping its formation. Has **bounded initiative**: immediate defence, a short emergency override (turn on a flank attacker, brace against a cavalry charge, pull out of a lost fight), asking for reinforcement, reporting its state (casualties, can't carry out the mission). When the emergency is over it **returns to its mission** unless the commander reassigned it. | Today the squad step chooses everything itself (target scoring, threat reaction, reserves, archers falling back, form-up and charge). It must become "follow a mission, with emergency exceptions". |
| **Soldier** (exists, keep) | The fight in front of them | Picks a nearby opponent, faces threats, attacks, parries, reacts to hits, keeps formation discipline with personal skill and nerve. Not every soldier may ignore the formation or chase across the field. | The soldier step in `stepBattle`. Leave the working combat, morale and damage alone unless a change is tested. |

**Priority contract:** survival or imminent emergency > mission-critical threat > the commander's objective > opportunistic action. The commander changes objectives; squads decide how and may deviate briefly; soldiers handle the immediate fighting. **No tug-of-war:** a squad's emergency override has a time limit and is reported up; the commander doesn't reassign a squad in the middle of its emergency unless it's urgent; after it, the squad goes back to its mission. Missions must have commitment windows and cooldowns (hysteresis).

## Design constraints (from `PROJECT_COLLABORATION.md`, agreed)
- Priority: survival or imminent emergency > mission-critical threat > commander objective > opportunism. Squads decide HOW (bounded emergency deviations, then return to their mission); the commander decides WHAT and WHY.
- The commander keeps a **persistent plan** and re-thinks every ~2 to 4 seconds. Use commitment windows, cooldowns and hysteresis so missions don't flip back and forth (measure it).
- Keep the existing counters, morale (friends beside you steady you), charge cycles, formation march and form-up. Improve, don't replace the battle engine.
- 1,000 soldiers must stay fast: commander work is per squad and cheap; target at most about 2 ms per step in `npm run battle:check` (it was 1.7 ms). Put every number in `src/config.ts`.

## Steps (commit and push after each; keep README and CLAUDE.md updated)
1. **Baseline first:** run `npm run battle:check` (full) and a few `-- map` runs; write the numbers in the README progress log before changing anything.
2. Commander data model and a per-squad mission with a reason; show the mission in the Lab (a tiny label or the badge tooltip is enough, the owner needs to see what each squad is doing; also useful for `-- map`).
3. Infantry missions, then cavalry missions, with squad-level emergency overrides and return-to-mission.
4. Lab switch (Commander / Me), enemy opening posture from the commander.
5. Extend `tools/battle-check.ts` (do not rebuild it): mission changes per squad per minute, idle-without-reason %, reserve commits, how long a flank threat takes to get a response, plus everything it already checks (counters, mirrored fairness, 400 and 1000 soldiers). Counters must still hold (spears beat cavalry, cavalry beat archers, archers beat spears, swords beat spears) and 80 mirrored battles must stay near 50/50.
6. Final report to the owner in short plain language: what changed, measured results (separate from guesses), what's limited, the next smallest step.

## Working with the owner
- The owner doesn't code and plays on an iPhone. Keep replies short and plain. Don't open a pull request.
- They have limited usage: plan briefly, don't re-read big files you don't need, don't write long essays; spend effort on code and tests.
- Separate later task (not this one): making individual fights readable on a phone screen (who is fighting whom). Don't change soldier spacing here; the owner asked earlier for tighter formations.
