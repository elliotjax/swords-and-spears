# PROJECT_COLLABORATION.md — Swords and Spears

> **Purpose:** Living, project-wide design and handoff document between the owner, ChatGPT, and Claude Code. This covers the **entire medieval colony simulator**, not only battles.
>
> **Status:** Design direction, not blanket permission to implement all ideas. Prepared November 9, 2026.
>
> **Roles:** Owner = final creative/product authority; ChatGPT = independent design partner, source reviewer, test analyst, and specification writer; Claude = primary programmer, integrator, and test runner. **ChatGPT must not modify gameplay source code.**
>
> **Authority:** Read `README.md` and `CLAUDE.md` first. They remain the project's primary rules/progress sources. This document is a supplementary brief; when guidance conflicts, ask the owner.

## 1. Collaboration protocol: maximize Claude usage

The owner brainstorms broadly with ChatGPT. ChatGPT translates those discussions into specific, code-aware, prioritized briefs; Claude focuses on implementation, debugging, testing, and integration.

- **Do not implement this entire document in one pass.** The owner explicitly authorizes individual tasks/phases.
- First inspect current code and existing functionality. Avoid recreating systems that already work.
- Favor incremental, reversible improvements over replacing the battle engine wholesale.
- Keep balance values in `src/config.ts`, per the existing `CLAUDE.md` instructions.
- For each task, report files changed, rationale, tests/results, performance, limitations, and next recommended step. Clearly separate measured results from hypotheses.
- When requested, ChatGPT will review new source and results, prepare follow-up requirements, and update this brief with the owner's permission.
- There is **no automatic communication or shared running context** between ChatGPT and Claude; this document is the handoff. Continue updating `README.md` under existing project rules.

## 2. Product vision

*Swords and Spears* is a mobile-first medieval **colony simulator**, incorporating the town economy, labor, resources, training/recruitment, and battles. Battles can involve **tens to approximately 1,000 soldiers total**. Browser performance on an iPhone-class device is fundamental.

The owner wants:
- Two intelligent opposing armies continually observing, interpreting, and countering each other.
- Three layers of decision-making: autonomous army commander, tactically autonomous squads, and individual soldiers.
- Dynamic cavalry capable of defending flanks, intercepting infantry **or** cavalry, flanking, raiding, charging, withdrawing, regrouping, and pursuing.
- Infantry capable of flanking, protecting threatened wings, wheeling, and reinforcing.
- Realistic-looking but readable pixel-art combat: recognizable individual engagements when zoomed in and intelligible army movements when zoomed out.
- Organic motion and battle decisions, without making performance, control, or game enjoyment worse.
- Combat outcomes consistent with the overall colony simulation.

**Victory-condition clarification:** The owner describes the goal as defeating/eliminating the opposing army, while current code models morale, fleeing, and routing. **Do not silently turn victory into “every enemy must die.”** Confirm whether rout counts as defeat before revising battle-end rules.

## 3. Existing implementation snapshot

Reviewed: `elliotjax/swords-and-spears`, development branch `claude/vigilant-maxwell-ov022y`. Reinspect the *latest revision* before changes.

- `src/battle/battle.ts`: deterministic seeded simulation, `BATTLE_TPS = 20`, formations, squad targeting/roles, movement, morale, routing, cavalry charge and withdrawal, archery, soldier HP and individual target decisions.
- `BSquad`: contains `role: '' | 'guard' | 'raid'`, `order: 'free' | 'hold' | 'path'`, squad state, target, morale, formation, and threat memory.
- `BSoldier`: target and retargeting, individual skill/nerve, stagger, facing, slots, and combat behavior.
- `src/battle/lab.ts`: deployment, enemy plans, visualization, and touch controls. Preserve meaningful player-issued orders.
- `src/config.ts`: central balance configuration.
- `tools/battle-check.ts`: **existing** deterministic test harness; `npm run battle:check`, `npm run battle:check -- quick`, and `npm run battle:check -- map`. It already checks matchup fairness, mirrored sides, idle/reserve rates, battle time, flank hits and ms/step; scenarios include approximately 400 and 1,000 soldiers. **Extend; do not rebuild.**
- `CLAUDE.md` already notes future plans for army structure, squad wheeling, and duel animations.

### Cavalry issue to reproduce

The owner observes some guard cavalry stationed on the wings and doing nothing useful. Current `battle.ts` includes:

```ts
if (q.role === 'guard' && !enemyCavLeft[q.side]) q.role = 'raid';
```

Guards focus on enemy cavalry and raiders favor vulnerable targets. This role/target heuristic is not sufficient as complete mission planning. **The exact root cause of the reported idle behavior is not yet verified.** Investigate orders, target filters, guard range, formation/line state, movement, disengagement, and testing before choosing a fix.

## 4. Three-level intelligence architecture

### A. Army commander: WHAT and WHY

One commander per side. Each maintains an army-wide tactical picture including friendly condition, *observed* enemy positions and approximate strength, exposed flanks, reserves, casualties, engagement outcomes, and suspected opposing intentions.

- Holds a **persistent battle plan**, not a new arbitrary target every tick.
- Sets strategic objectives and coordinates squads/wings: protect center, commit reserves, strengthen a flank, exploit an opening, draw out opponents, or disengage/reorganize.
- Reacts to the opposing commander's *observed* maneuvers, possibly misreading feints or reacting imperfectly.
- Allocates missions and gives priority, but does not micromanage every soldier.
- Does not read enemy intent or unobserved information. **Both sides use fair, symmetrical AI rules.**
- Clarify human-player order precedence separately from fully autonomous AI-vs-AI mode.

### B. Squad intelligence: HOW and WHEN

- Interprets commander missions, selects tactical positions/routes/targets, and maintains cohesion.
- Responds locally to nearby threats, flanking infantry/cavalry, failing allies, unfavorable engagements, and opportunities.
- Has **bounded initiative**: immediate defense, short emergency override, interception, disengagement, and requests for reinforcement.
- Reports current mission state, threat/opportunity observations, casualties, and inability to carry out instructions.
- Returns to its previous mission after local emergencies unless commander reassigned it.
- Uses commitment windows, cooldowns, hysteresis and stable targets to prevent constant toggling of orders.

### C. Individual soldier: immediate combat/survival

- Chooses nearby opponents, faces threats, attacks, parries, reacts to hits, and maintains formation discipline.
- Individual differences in skill, nerve, timing and position should generate organic action.
- Do not let every soldier ignore formation or chase enemies across the field.
- Preserve current working combat, morale, and damage calculations unless improvement is tested.

**Priority contract:** survival/imminent emergency > mission-critical threat > assigned commander objective > opportunistic action. The commander changes objectives; squads decide *how* and make bounded emergency deviations; soldiers handle immediate fighting. Do not create repeated commander/squad tug-of-war.

## 5. Dynamic cavalry missions and infantry responses

`guard` and `raid` should not be hard-coded permanent identities. Use dynamic missions assigned by the commander and refined by squad initiative:

| Mission | Purpose |
|---|---|
| Screen | Protect exposed friendly wing/rear against **infantry and cavalry** |
| Intercept | Stop an approaching threat to friendly squads or archers |
| Flank | Maneuver to exposed sides of occupied enemy formations |
| Raid | Pressure exposed archers/support |
| Shock | Charge a suitable vulnerable target, disengage/regroup when justified |
| Reserve | Wait intentionally for a later high-value commitment |
| Pursue | Exploit a rout or retreat |
| Disengage | Withdraw from an unfavorable fight or urgent reassignment |

Examples:
1. Cavalry screening a wing finds no enemy cavalry but sees infantry maneuvering around the flank: it should respond to the **infantry** rather than remain inert.
2. Guard cavalry finds no flank threat but exposed enemy archers: commander may order a raid, or consciously retain the unit as reserve.
3. A cavalry squad already fighting recognizes a grave flank threat and may disengage, subject to travel time, cohesion, and the urgency of its original mission.
4. Infantry can rotate, flank, reinforce and respond to enemy movement. Avoid making every tactical reaction a cavalry-only behavior.

Waiting can be realistic when it has a strategic purpose; never reward pointless activity. Preserve counters, vulnerability, charge cycles, morale, and positioning.

## 6. Adaptive difficulty and personality

Difficulty should primarily affect **how effectively AI decisions are made**, not hidden buffs:
- **Easy:** slower or less reliable assessment, simpler plans, weaker coordination.
- **Normal:** capable local response, basic coordinated plans and reserve management.
- **Hard:** better threat evaluation, coordinated attacks, interception and counterplay.
- **Expert:** stronger pattern recognition from observations and timely adaptation, while remaining fallible.

Commanders may have different doctrines/personality (aggressive, defensive, opportunistic, cautious) independent of difficulty. Start with deterministic, explainable heuristic/utility AI with bounded tactical memory, not computationally expensive machine learning. Learning *between* battles is a separate optional feature, not approved by implication.

## 7. Individual combat readability and organic movement

**Observed by owner:** crowded pixel-art melee, soldiers standing too close together, unclear who fights whom, frequent visible hits but hard-to-follow individual engagements. This may involve both simulation spacing and visual presentation; diagnose instead of assuming one cause.

Desired:
- **At army scale:** see front lines, wings, cavalry charges, flanks, reserves, and breaking formations.
- **At close zoom:** recognize facing and target relationships, meaningful attacks, defense, recovery, reactions and small sustained duels.
- Natural variation without distracting arbitrary movement; fewer unreadable overlaps while maintaining convincing combat density.

Before implementation, inspect actual Battle Lab rendering, sprite scale, `CONFIG.battle.spacing`, collision/overlap, melee reach, target switching, animation FX, camera zoom, and phone resolution. Compare screenshots or recordings if possible. Prototype separately (not all at once): attack wind-up/contact/recovery, clearer facing, slight spacing changes, melee-pair separation, selective FX, zoom-aware details. Keep 1,000-soldier performance viable.

## 8. Performance, simulation, and code architecture

- Target approximately 1,000 total soldiers. Benchmark **simulation tick cost and render frame time separately**.
- Retain deterministic fixed-step simulation independent of rendering.
- Initial proposed decision cadence **to benchmark**, not blindly enforce: commander every ~2–4 seconds; squad every ~0.5–1 second with urgent event-based responses; soldier combat on existing 20 TPS with staggered retargeting.
- Cache shared assessments, rely on spatial indices, and avoid repeated all-soldier scans and unnecessary allocations.
- Integrate incrementally with existing `battle.ts` and Battle Lab. Prefer extracted modules only when interfaces and regression safety justify them.

## 9. Test strategy — leverage existing Claude tests

**ChatGPT has statically inspected source; it has not executed this project's battle simulations.** Claude already runs the harness. Record baseline on the same code/seeds before changing logic.

Targeted reproducible cases:
1. Guard cavalry without enemy cavalry: justified reassignment or intentional reserve, not accidental idleness.
2. **Enemy infantry** flanking: appropriate squad and commander response.
3. Cavalry protecting archers: intercept immediate threat without abandoning the wing for a distant target.
4. Cavalry in melee receives urgent reassignment: sensible withdrawal without mission thrashing.
5. Reserves: held when warranted, committed when battlefield conditions change.
6. Two commanders: adapt based on information observed, with uncertainty and counterplay.
7. Side-mirrored formations: no persistent left/right advantage.
8. Small, ~400, and ~1,000-person battles: performance and fairness.
9. Visual inspection zoomed out/in: identifiable formations, attacks, and soldier target relationships.

Useful *additional* metrics: mission changes, completion, emergency overrides, threat-response delay, idle time with vs without justified reserve, retarget churn, charge/disengage cycles, collision/crowding, and frame-time distribution. Win-rate alone does not prove believable tactics.

## 10. Implementation phases — each needs owner authorization

1. **Baseline and diagnosis**: inspect latest files, run existing tests, reproduce guard cavalry inactivity, review crowded melee visually; record evidence.
2. **Decision authority / missions**: specify commander–squad–soldier responsibilities, priority, stable mission data, and emergency overrides.
3. **Cavalry and infantry local response**: dynamic assignments, screen/intercept/raid/disengage, wing protection and infantry flanking behavior.
4. **Battlefield intelligence**: per-side observations, estimated strengths, uncertainty, and tactical memory.
5. **Autonomous commanders**: persistent plans, coordinated wings, reserve timing, reacting to opponents.
6. **Adaptive quality**: difficulty, personality/doctrine, and observed-pattern counterplay.
7. **Combat readability**: prototypes for spacing, animation rhythm, target clarity, zoom-based presentation.
8. **Regression/integration**: player orders, colony effects, large battle performance and balance.

The owner may reorder phases, especially to address visual readability earlier. **Never assume authorization to implement the complete backlog.**

## 11. Open decisions

- What exactly counts as victory: all killed versus no organized fighting squads.
- How an autonomous friendly commander should interact with player `hold`/`path`/`free` orders.
- Whether to add communications delay, officer quality, fatigue, fog of war, terrain or persistent commander learning.
- Precise animation solution at phone pixel-art scale.
- Measured per-device performance budgets.

## 12. Handoff checklist for Claude

When the owner references this file:
1. Read `README.md`, `CLAUDE.md`, `PROJECT_COLLABORATION.md` and relevant current source/tests.
2. Identify **the explicitly authorized current task**; do not implement later design sections.
3. Confirm existing mechanisms, reproduce reported issues, establish baseline.
4. State brief plan and measurable acceptance criteria.
5. Implement incrementally and test the same seeded scenarios, build, and visually inspect when needed.
6. Report evidence, files touched, tradeoffs, remaining issues and next smallest useful step.
7. Keep existing repository commit/deployment and documentation workflow.

## Decision log

- **2026-11-09:** Owner chose a project-wide collaboration document to transfer ChatGPT design/review guidance to Claude without repeated long prompts.
- **2026-11-09:** Approved direction: autonomous, adaptive opposing commanders; army/squad/soldier decision authority; dynamic cavalry roles; infantry flank response; fair difficulty.
- **2026-11-09:** Individual melee readability and realistic organic movement are high priorities alongside large-scale mobile performance.
- **2026-11-09:** ChatGPT may write documentation and review code, but **not gameplay code**. Claude implements specifically approved changes.
