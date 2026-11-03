# Palimpsity — editable source

Build a miniature city whose solutions reshape its future challenges. Balance
production, deliveries, heat and maintenance, and give older workshops a new role.
The game starts in English and has a live English / Français selector.

## Play

Open `dist/palimpsity-mvp.html` in a WebGL-capable desktop browser. The built game
is self-contained and works without a server or an Internet connection.
Start with houses, a well and a farm in the same district, then press Play.
Read the [player guide](game/README.md) for the controls and objectives.

## First Neighbourhood challenge

Choose **First Neighbourhood** in the top bar to start a fresh city with the
normal 600 EUR budget. Welcome at least 24 residents, cover at least 85% of
food and water needs, and keep finances nonnegative for eight consecutive
turns before turn 120. The clock counts **simulation time**: each turn is
0.6 seconds (72 seconds total at normal speed); pauses are free and fast speed
advances it faster. The best completed simulation time is kept locally when
storage is available. **Classic city** returns to a fresh original city.

A possible opening in the southwest district is five houses, two wells, a
farm and a local market. Prepare while paused, then press Play. The original
Thriving city objective and all original rules remain available in classic mode.
Hiding the tab pauses either mode; press Play manually when returning.

## River Pact scenario

Choose **Start River Pact** in the side panel to build a city in three acts.
Start with the normal 600 EUR, reach 24 residents and keep food, water and
finances healthy for four turns. The council awards 200 EUR and pauses the
city for a choice:

- **Garden commons:** 100 EUR, with two parks and two wells in each of two
  inhabited districts.
- **Makers quarter:** 200 EUR, with a workshop and a local market in each
  district. Deliver 40 materials once when the second act completes.

Both districts need housing for at least 12 residents and healthy local
supplies. Holding the second act for four turns awards another 100 EUR.
Prepare before the drought on turns **120–149**: water-producing buildings
deliver **55%** of their usual output. Keep at least 36 residents and both
districts supplied for 12 consecutive drought turns, then reach 48 residents
and hold the pact for 12 turns after the river recovers. The deadline is turn
240. The panel shows exact goals and the weather forecast throughout.

Use **Advance 5 turns** for deliberate play, or the usual speed controls.
Turn batches stop at the charter choice and the result; pauses cost nothing.
Districts are the four quarters of the map. Build local food and water services
in the same quarter as housing. The original city and First Neighbourhood
remain available, and returning to Classic city starts a fresh original game.

This independent scenario was automatically produced by LOB7 Enhancement,
with a bounded Kimi K3 implementation reviewed and integrated by Nilo.

## Develop

Use Node.js 22 or newer. From `game/`, run:

```sh
npm ci
npm test
npm run build
npm run test:artifact
```

`npm run dev` serves the editable modules locally. The committed `dist/` file
is the reproducible offline build. The main branch holds the static edition
intended for LOB7; this source branch retains the editable modules, model files,
Blender generator and active game tests. Historical prototypes are not part of
this distribution. No private project history is included.

The standalone loader parses embedded GLBs directly from memory, without fetching
data URLs. `npm test` verifies all 39 models with network requests disabled.
The export keeps readable JavaScript whitespace so static analyzers can parse
conditional decimal expressions without confusing them with optional chaining.

## Credits and license

Created by Cédric with AI assistance from Codex, Claude and Kimi.
Original code and original Blender models: CC0-1.0. Three.js: MIT.
See [credits](CREDITS.md), [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
