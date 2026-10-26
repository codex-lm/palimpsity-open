# Palimpsity — playable prototype

Build a city whose solutions gradually become its constraints. The wells,
markets, parks and workshops from its early days can regain their value as
industry, distribution and maintenance become more important.

The game starts in English and offers French through the small **English / Français**
selector at the top right. You can switch during a game without restarting it;
the choice is remembered when browser storage is available. Rules last updated: **October 26, 2026**.

## Launch the game

**The simplest option:** double-click `../dist/palimpsity-mvp.html`.
The built file includes Three.js and the Blender models. Playing needs no
installation, server or Internet connection. Blender is only needed to regenerate
models, not to launch the game.

After changing the source files, rebuild the standalone file from `game/`:

```powershell
npm install       # only if the dependencies are not already installed
npm run build
```

Development mode uses separate ES modules and the locally installed Three.js
dependency:

```powershell
npm run dev
# open http://localhost:5173/index.html
```

## Getting started

The **Thriving city** panel lists the victory requirements. Reach **180 residents**
and urban maturity, then keep the city supplied, its districts served and
maintained, and its services funded for **8 consecutive turns**.
**You can prevent crises and still win.**

New games **start paused**. The City planner suggests building houses, a well and
a farm in the same district. Start time with **▶** or **Space** when you are ready.
Add a workshop and market as the city grows. Farms produce more on fertile land.
A resource elsewhere on the map is not automatically delivered to your residents.

### Controls

- **Left-click:** build with the selected tool; with no tool selected, inspect a building.
- **Left-drag:** rotate the camera.
- **Right-drag:** pan the view; **mouse wheel:** zoom.
- **R:** rotate the building preview; **Escape:** cancel the tool, close the inspector or dismiss the active dialog.
- **Space:** pause or resume. The buttons at the top right select pause, normal speed or fast speed.
- **Arrow keys, then Enter**, while the map has focus: choose a tile and build or inspect.
- The bottom palette selects a building or **Demolish**. Demolition refunds 40% of the building's original price.
- **City / Logistics / Heat / Wear:** lenses unlocked as the game progresses.
- Projection buttons select **Orthographic** or **Soft perspective**. The home button recenters the camera on the valley.

### Progression

1. **Foundation:** meet essential needs and reach **35 residents**.
2. **Growth:** industrial facilities and apartment buildings become available. They increase production and capacity, but also costs, heat and dependencies.
3. **Logistics:** sustained distribution pressure or heavy flows can trigger a logistics crisis and unlock local depots and trams.
4. **Maturity:** heat and wear make maintenance increasingly important. A city with at least **100 residents**, adequate food, water and district service can also mature without a crisis by keeping heat below **15 for 12 turns**, even with well-cooled industry.

The **green halo** marks older building types that regain value under the dominant
regime. It never lights up during the initial survival regime alone.

## Districts, transport and the economy

The map has four districts. Each has limited local distribution capacity; markets
and depots increase it. The food and water actually available in a district affect
its occupancy and activity. The Logistics lens shows insufficient service and
congestion. The Wear lens shows the maintenance burden left after local services
have done their work, rather than a building's age alone.

**Connected paths and roads** can link districts to import surplus resources.
A useful network needs at least two adjacent transport tiles and must reach
buildings. Isolated pieces do not provide the same capacity. Trams form their own
network. **This MVP has no bridges:** you can make each riverbank self-sufficient
instead. Energy remains a global resource, with no electricity network to draw.

Local stocks cushion a short disruption, then run out. They do not make a distant
district's reserves available without a connection.

Homes earn income according to actual occupancy, and businesses according to
their activity. Underused buildings still have upkeep costs. Adding homes without
services no longer creates a free income stream. Materials are used for repairs
and workshop conversion.

## Convert an old workshop

From **phase 3**, a workshop at least **24 turns** old can become a
**Maintenance workshop**:

1. Press **Escape**, then click the old workshop to inspect it.
2. Read **Give this building a new role** and the conversion requirements.
3. Choose **Renovate this workshop** when you have **65 € and 20 materials**.

The workshop then maintains **its own district**. It keeps its location, age and
3D model, but **stops producing materials and sales income**. It needs workers and
an operating budget. Keep another source of materials if your city relies on them.
A Maintenance center is another way to provide local maintenance.

## The 18 buildings

| Phase | Buildings |
|---|---|
| 1 — Foundation | House · Well · Farm · Workshop · Local market · Path · Park |
| 2 — Growth | Road · Thermal power plant · Factory · Central warehouse · Water treatment plant · Apartment building |
| 3 — Logistics | Local depot · Tram; conversion of old workshops |
| 4 — Maturity | Maintenance center · Heated greenhouse · Recycling center |

The Heated greenhouse uses local heat to produce food. The Recycling center
produces recovered materials; **pollution is not a simulated resource** in this
version.

## Verify changes

From `game/`:

```powershell
npm test                      # regimes, gameplay, UI/rendering and bilingual language checks
npm run test:gameplay          # gameplay regressions and normal playthroughs
npm run test:victory           # normal-budget victory playthroughs
npm run test:ui                # UI/rendering contracts, outside a browser
npm run test:language          # English player-facing text and coverage checks
npm run test:localization      # French/English switching, saved preferences and live text
npm run build                 # rebuild the standalone file
npm run test:artifact          # compare the shipped code and assets with their sources
```

Normal playthroughs keep the **initial 600 € and natural unlocks**. Fixtures that
isolate a condition do not prove that a complete playthrough is achievable.
The 7 UI/rendering contract tests cover workshop conversion, objectives, lenses
and focus preservation in the inspector. They run outside a browser: neither they
nor the engine tests validate WebGL rendering or the experience of playing.

The October 26 rules build passed `test:artifact`: the embedded code matched its
sources, with the expected **18 models and 39 GLBs** present. Run this static
check after each new build; it does not open the game in a browser.

## Editable source and models

The application modules are in `src/`. Original Blender models and their generator
are in `art/diorama/`. To regenerate them, install Blender and set `BLENDER_EXE`
to the absolute path of its executable, then run `npm run assets:diorama`.
Blender is not required to rebuild or play the committed game.

The optional `npm run test:browser` launches an isolated Chrome profile; the
automated checks used for this source snapshot are Node-based, not a guarantee
of WebGL behavior or human play experience.

Original code and original Blender assets: CC0-1.0. Three.js: MIT; see the
repository LICENSE and THIRD_PARTY_NOTICES.md.
