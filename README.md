# Palimpsity

Build a miniature city whose solutions reshape its future challenges. Balance
production, deliveries, heat and maintenance, and give older workshops a new role.

## Play

Open `index.html` in a WebGL-capable desktop browser, or use the LOB7 player
when this edition is published. The game includes its 18 Blender building models
and needs no installation, server or external network connection.

New games start paused. Build houses, a well and a farm in the same district,
then press **Play**. Use the **English / Français** selector to change language.
Left-click builds or inspects; left-drag rotates the camera, right-drag pans, and
the mouse wheel zooms. **R** rotates a building, **Escape** cancels the tool, and
**Space** pauses or resumes. Arrow keys and Enter provide keyboard placement.

Reach 180 residents with a mature, supplied, maintained and funded city. The
**Thriving city** panel lists the requirements. Preventing crises can win too.

## Editable source and collaboration

This branch is the ready-built static export for LOB7. The corresponding editable
source is on the [source branch](https://github.com/codex-lm/palimpsity-open/tree/af4298244f7df57e1c1a17177f0a79a7e80f26b0),
at exact commit [`af4298244f7df57e1c1a17177f0a79a7e80f26b0`](https://github.com/codex-lm/palimpsity-open/tree/af4298244f7df57e1c1a17177f0a79a7e80f26b0).
It includes application modules, the Blender generator, local GLB model files,
build instructions and the active game tests. Fork that source to develop an
independent variant.

From `game/` on the source branch:

```sh
npm ci
npm test
npm run build
npm run test:artifact
```

Node.js 22 or newer is required for development. Blender is needed only when
regenerating models; set `BLENDER_EXE` to its executable. Commit the resulting
`dist/palimpsity-mvp.html` as `index.html` on your static export branch.

## Credits and licensing

Created by Cédric with AI assistance from Codex, Claude and Kimi. Original code
and original Blender models: **CC0-1.0**. Bundled Three.js, OrbitControls and
GLTFLoader: **MIT**. Keep the notices when sharing or adapting this edition.
See [CREDITS.md](CREDITS.md), [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This export contains the game and its public development sources. The original
private project history and internal working documents are not included.

## Snapshot

Version: `0.1.1-neighbourhood`. SHA-256 of `index.html`:

```text
4f559952ed9b897c2d0efc34fab70f400204b8cf10fd6983d99ed5acded80f9b
```

The source checks and static artifact checks pass. Browser/device play behavior
remains subject to testing in the published environment.

## First Neighbourhood

Choose First Neighbourhood in the top bar. Reach 24 residents, cover at least 85% of food and water needs, and keep money nonnegative for eight consecutive turns by turn 120. One turn counts as 0.6 seconds of simulation (pauses are free; fast speed advances faster). Your best completion time is kept locally when storage is available. Classic city starts a fresh original game. Hiding the tab pauses either mode; resume manually.

Automatically produced by LOB7 Enhancement. Implementation assisted by Kimi K3, reviewed and tested by Nilo. Original credits and CC0/MIT notices preserved.
