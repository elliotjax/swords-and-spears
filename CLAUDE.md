# Notes for Claude Code sessions

**README.md is the single source of truth.** Read it first (section 1 has the owner's rules). Keep it updated with every decision and add to the progress log (section 15).

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
- `npm run battle:check` prints who wins each matchup (unit counters, fairness between the two sides), battle length, idle/reserve time, flank hits and speed. Lines marked `<-- CHECK` need a look. `-- quick` runs fewer battles, `-- map` prints ASCII pictures of one battle every 10 s.
- Run it before and after any battle change. Small samples swing a lot: confirm fairness with the full run.
- You can't watch battles move: use the numbers, the ASCII map, and Playwright screenshots (`npx vite --port 5173`, then `window.game.lab`).

## Battle AI: how it fits together (see README section 10 for the rules)
- Every squad has an order: `free` (battle AI; "Advance" in the Lab), `hold`, or `path` (an arrow: infantry leave it near the enemy, archers stop to shoot, cavalry keep to it; free at the end). Both sides use the same code; the enemy's orders come from its plan (`PLANS` in `lab.ts`).
- Squad step in `stepBattle`: pick a target (scoring in tiles, bonuses in `CONFIG.battle.ai`), then one of: archers / withdraw / melee / hold / path / marching in the army line / form up and charge.
- Soldier step: each soldier picks their own opponent near their formation slot; blows, parries and morale follow.
- Ideas not built yet: explicit army structure (centre, wings, reserve with a commander deciding when to commit), squads wheeling to face several attackers, one-on-one duel animations, saved formations.
