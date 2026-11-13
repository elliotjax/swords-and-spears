# Notes for Claude Code sessions

**README.md is the single source of truth.** Read it first (section 1 has the owner's rules). Keep it updated with every decision and add to the progress log (section 15).

## Status
**New chat? Read `HANDOFF.md` first** (temporary, full context of the long battle session, open problems and next steps), then README.
The army commander (first version) is built: see README section 10 "Army commander" and `COMMANDER_TASK.md` (the brief it was built from, with a status note at the top). `PROJECT_COLLABORATION.md` is the wider design brief written with ChatGPT: only build from it what the owner authorizes.

## The owner
- Doesn't code, plays on an iPhone. Explain things in short, plain language.
- Don't start building until they say "go" (unless they've given you freedom for a task).
- Don't create a pull request unless asked.

## Working rules
- Every balance number lives in `src/config.ts`.
- Commit after each working step and push to the session's branch. Every push deploys to GitHub Pages (the game shows a "New version" button).
- `npm run build` must pass (it type-checks).
- No model names in commits or code.

## Where things are
- `src/sim/` town simulation (`sim.ts` people/jobs/food, `logistics.ts` goods, haulers, building sites).
- `src/battle/battle.ts` battle engine (no drawing). `src/battle/lab.ts` Battle Lab screen: deployment, enemy plans, drawing, touch.
- `src/render/` map drawing, `src/ui/` menus.

## Testing battles
- `npm run battle:check` (commanders on both sides; add `-- legacy` for the old no-commander AI) prints who wins each matchup (unit counters, fairness between the two sides), battle length, idle/reserve time, flank hits and speed. Lines marked `<-- CHECK` need a look. `-- quick` runs fewer battles, `-- map` prints ASCII pictures of one battle every 10 s.
- `tools/battle-ai.ts` measures idle soldier-time (by unit and mission) and how different battles are (plans chosen, where the line broke, length, margin, gap attacks).
- `tools/battle-main.ts` measures only the main part of the battle (first 75 s after contact): what cavalry fight, whether they reach the archers, how far pushes move the line. Whole-battle averages hide this.
- Run it before and after any battle change. Small samples swing a lot: confirm fairness with the full run.
- You can't watch battles move: use the numbers, the ASCII map, and Playwright screenshots (`npx vite --port 5173`, then `window.game.lab`).

## Battle AI: how it fits together (see README section 10 for the rules)
- **Three levels:** commander (`src/battle/commander.ts`: every 1.5 s gives each squad a `mission` with a reason; `CONFIG.battle.commander`) → squad step in `battle.ts` (carries the mission out: fixed-target missions set the target, posted missions (reserve/screen) stand at `postOf` and deal with close enemies, `advance` uses the free AI below) → soldier step. A side is commander-led when `setup.commander[side]` is true (then its orders are ignored).
- Without a commander, every squad has an order: `free` (battle AI; "Advance" in the Lab), `hold`, or `path` (an arrow: infantry leave it near the enemy, archers stop to shoot, cavalry keep to it; free at the end). Both sides use the same code; the enemy's orders come from its plan (`PLANS` in `lab.ts`).
- Squad step in `stepBattle`: pick a target (scoring in tiles, bonuses in `CONFIG.battle.ai`), then one of: archers / withdraw / melee / hold / path / marching in the army line / form up and charge.
- Dynamics: `q.fatigue` (0..1; `CONFIG.battle.fatigue`), `q.pushing` / `q.bracing` (shoving weights in the separation step; `CONFIG.battle.push`), the commander's `plan` (strike wing / centre / both / defend) and its push orders (`mission.push`): one push event at a time (`c.push`, 2 to 5 squads starting together); neighbours of a pushed squad bend back; reserves plug the gap; lone squads regroup.
- Engine v2: infantry fight in bouts with breathers (`q.lull`, `q.boutEnd`, `CONFIG.battle.lull`), `q.cohesion` (`CONFIG.battle.cohesion`: frays formations, weakens parries), `melee.foeGap` keeps lines apart. `tools/battle-shape.ts` measures mixing, losses, rhythm.
- Army organization (`CONFIG.battle.commander.org`): at plan time the infantry is split into front (capped: ~deployed width, at most half the infantry), second line (mission `second`, posted behind a front squad via `mission.friend`) and reserve; rotation of tired front squads; flank budget.
- Crowd pressure (`CONFIG.battle.crowd`, `s.pressure`): computed in the separation step back-to-front; pressure makes a man heavier against enemies and creeps him forward. Only the front two ranks strike (`friendsBetween`, `melee.strikeRanks`).
- Push operation (`src/battle/pushop.ts`, `c.op`, `CONFIG.battle.commander.op`): start point + direction + 15-tile corridor; every free infantry squad within 20 tiles charges at once in lanes (rush missions never wait behind friends); own 0.3 s manager; squads in it have `mission.op` (the commander skips them); started by the commander or the Lab's ⚔ Push (drag = direction). Phases assault -> wrap; corners detach half.
- Manoeuvres (`src/battle/maneuver.ts`, `c.man`, `CONFIG.battle.commander.man`): three battle groups judged along the line; contract / refuse / mass / shift; mission `reform` (posted at `mission.post`, fighting withdrawal via `q.backing`). A/B test pattern: disable for one side with `b.cmd[s].nextMan = Infinity` (or `ops = 99` for pushes) and compare wins over 20+ battles.
- Breakthrough charges: commander finds holes in the enemy line per soldier (`gap*` in `CONFIG.battle.commander`), sends reserve / idle squad / detachments (`detach()` makes a new squad mid-battle: `q.detached`) with `mission.via` + `mission.rush`.
- Commander v2: `plan.kind` (envelop/double/centre/defend/feint/hook) picked by weighted chance + `c.temper` (aggr/cav/patience); initiative (idle squads through gaps / round the ends), shoring up, archer focus, wing guard. Numbers in `commander.doctrine` and nearby.
- Units: swordsmen, heavy (1.75x damage, 1.45x hp, `armor` 10%), spearmen, archers, cavalry; per-unit stats in `CONFIG.battle.units` (`hp`, `armor` optional).
- Boss (`boss`, Warlord): one giant soldier, `radius`/`mass`/`worth`/`splash` stats in `CONFIG.battle.units`; reach and spacing use `bodyR`/`ext` so big bodies work.
- Courage: `q.support` (friendly squads beside it) softens front/charge/outnumbered losses (`morale.supportFront`). Cavalry `q.role`: guard or raid, set in `createBattle`.
- Soldier step: each soldier picks their own opponent near their formation slot; blows, parries and morale follow.
- Ideas not built yet: refusing a flank (holding one wing back on purpose), retreat and rally of the whole army, fog of war (`observe`), difficulty and personalities, squads wheeling to face several attackers, one-on-one duel animations, saved formations.
