# Palimpsity — playable prototype

Build a city whose solutions gradually become its constraints. The wells,
markets, parks and workshops from its early days can regain their value as
industry, distribution and maintenance become more important. Living Layers
also lets buildings gain floors, change their ground-floor role and acquire
new roofs without losing their identity or history.

The game starts in English and offers French through the small **English / Français**
selector at the top right. You can switch during a game without restarting it;
the choice is remembered when browser storage is available. Rules last updated: **November 4, 2026**.

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
- **R:** rotate the building preview; **Escape:** cancel the tool, close the inspector, leave photo mode or dismiss the active dialog.
- **Space:** pause or resume. The buttons at the top right select pause, normal speed or fast speed.
- **Arrow keys, then Enter**, while the map has focus: choose a tile and build or inspect.
- The bottom palette selects a building or **Demolish**. Demolition refunds 40% of the investment tracked for that building.
- **City / Logistics / Heat / Wear:** lenses unlocked as the game progresses.
- Projection buttons select **Orthographic** or **Soft perspective**. The home button recenters the camera on the valley.
- **Focus building**, in the inspector, moves the camera to the selected structure.
- **Display & photo** selects **High**, **Balanced** or **Low** rendering quality, toggles **Reduced effects** and shows or hides modular roofs. High uses the native device pixel ratio; Low reduces the drawing buffer and disables shadows.
- **Enter photo mode** hides the interface. Orbit freely and choose **Day**, **Golden hour**, **Evening** or **Night**; **Escape** restores the interface.

### Progression

1. **Foundation:** meet essential needs and reach **35 residents**.
2. **Growth:** industrial facilities and apartment buildings become available. They increase production and capacity, but also costs, heat and dependencies.
3. **Logistics:** sustained distribution pressure or heavy flows can trigger a logistics crisis and unlock local depots, trams and Commons.
4. **Maturity:** heat and wear make maintenance increasingly important. A city with at least **100 residents**, adequate food, water and district service can also mature without a crisis by keeping heat below **15 for 12 turns**, even with well-cooled industry.

The **green halo** marks older building types that regain value under the dominant
regime. It never lights up during the initial survival regime alone.

## Living Layers

Open the inspector of a house, workshop or warehouse and expand **Transform this
building**. Each offer shows its price, requirements and complete before/after
profile before confirmation. Architecture belongs to the building instance;
transforming one building never rewrites the catalogue or a neighbour. The
inspector retains a history of transformations and conversions.

- **Floors:** add up to **four total levels**, unlocked progressively by city phase. Extra floors change real capacity, demand, upkeep and local effects rather than only the model.
- **Ground-floor shops:** a house can exchange its ground-floor homes for sales and district distribution. Upper homes remain. Shops need food, water, energy and workers, so an unpowered shop is not free income.
- **Roofs:** **Traditional** has no production or environmental bonus; **Garden** adds cooling and amenity with extra water demand; **Productive** grows food and generates solar power with its own water demand. A garden roof is not a park.
- **Families and variants:** **Banks**, **Works** and **Gardens** provide distinct construction systems. Residential variants **0**, **1** and **2** change actual facade geometry and matching floors, not merely colors. Style transformations do not change the building's economic base role.

The modular renderer assembles a ground floor, matching upper floors and one roof.
There is no roof trapped between added levels. **Commons** is the civic exception:
its standalone clock-tower model provides local services and never receives
generic floors or a generic roof.

### Reconvert older buildings

Both conversions keep location, age, architecture and history while replacing
the old role with local services:

| Source | Requirement | Cost | New role |
|---|---|---|---|
| Workshop | Phase 3, age 24 turns | 65 € + 20 materials | **Maintenance workshop** — maintains its district and stops material production and sales income |
| Central warehouse | Phase 3, age 18 turns | 70 € + 12 materials | **Neighborhood hall** — gives up central storage and provides staffed local services and trust |

Keep another source of materials if the city relies on a converted workshop.
A Maintenance center is another way to provide local maintenance.

## Districts, transport and the economy

The map has four districts. Each has limited local distribution capacity; markets
and depots increase it. The food and water actually available in a district affect
its occupancy and activity. The Logistics lens shows insufficient service and
congestion. The Wear lens shows the maintenance burden left after local services
have done their work, rather than a building's age alone.

**Connected paths and roads** can link districts to import surplus resources.
A useful network needs at least two adjacent transport tiles and must reach
buildings. Isolated pieces do not provide the same capacity. Trams form their own
network. **This MVP has no bridges or large multi-tile footprints:** make each
riverbank self-sufficient instead. Energy remains a global resource, with no
electricity network to draw.

Local stocks cushion a short disruption, then run out. They do not make a distant
district's reserves available without a connection.

Homes earn income according to actual occupancy, and businesses according to
their activity. Underused buildings still have upkeep costs. Adding homes without
services no longer creates a free income stream. Materials are used for repairs,
transformations and conversions.

## The 19 building entries

| Phase | Buildings |
|---|---|
| 1 — Foundation | House · Well · Farm · Workshop · Local market · Path · Park |
| 2 — Growth | Road · Thermal power plant · Factory · Central warehouse · Water treatment plant · Apartment building |
| 3 — Logistics | Local depot · Tram · Commons; both old-building conversions |
| 4 — Maturity | Maintenance center · Heated greenhouse · Recycling center |

The original 18 entries retain their legacy models; Commons uses the standalone
civic module. The Heated greenhouse uses local heat to produce food. The Recycling
center produces recovered materials; **pollution is not a simulated resource** in
this version.

## Verify changes

From `game/`:

```powershell
npm test                           # 127 tests: simulation, Living Layers, UI/rendering, assets and bilingual checks
npm run test:d2-calculation         # 5 separate RAF calculation tests
npm run test:gameplay               # gameplay regressions and normal playthroughs
npm run test:victory                # normal-budget victory playthroughs
npm run test:ui                     # UI/rendering contracts, outside a browser
npm run test:language               # English player-facing text and coverage checks
npm run test:localization           # French/English switching, saved preferences and live text
npm run build                       # rebuild the standalone file
npm run test:artifact               # compare the shipped code and assets with their sources
npm run test:living-layers-browser # standalone browser recipe, native captures and measurements
npm run test:d1                     # 12 floor/roof combinations
npm run test:d2                     # baseline/current performance comparison
npm run test:d3                     # automated natural-budget playthrough
```

With `npm run dev` running in another terminal, two focused visual recipes are
also available:

```powershell
npm run test:first-house-4k         # four-floor anchors, picking, focus and native DPR-2 captures
npm run test:renderer-visual        # standalone Commons and modular-roof visibility
```

Normal playthroughs keep the **initial 600 € and natural unlocks**. Visual fixtures
that explicitly prepare phase and resources prove contracts and rendering, not
that a complete playthrough is achievable. Node-based tests do not replace WebGL
or human visual inspection; the browser recipes use an isolated Chrome profile
and write their evidence under `../docs/living-layers/`.

The integrated Living Layers build passes `test:artifact`: embedded code matches its
sources, with **18 legacy building models, 45 Living Layers modules, 14 environment
modules and 98 embedded GLBs**. The asset generator separately checks **99 GLBs**,
adding the presentation `terrain.glb` to the 98 references used by the game manifest. See
[the delivery report](../docs/living-layers/DELIVERY.md) for actual browser results.

## Editable source and models

The application modules are in `src/`. Original Blender models and their generator
are in `art/diorama/`; the procedural Living Layers source is
`art/living-layers/build_living_layers.py`. To regenerate everything, install
Blender and set `BLENDER_EXE` to the absolute path of its executable, then run
`npm run assets:diorama`. The `.blend` files are regenerable by these scripts and
are not independent authoring inputs.

The [Living Layers catalogue](art/LIVING_LAYERS.md) documents module anchors,
families, variants, limits and the procedure for adding a floor, roof or family.
Blender is not required to rebuild or play the committed game.

Original code and original Blender assets: CC0-1.0. Three.js: MIT; see the
repository LICENSE and THIRD_PARTY_NOTICES.md.
