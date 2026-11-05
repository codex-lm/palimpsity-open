# D1 — floor and roof matrix, native 4K

Generated: 2026-11-04T21:37:26.868Z
Result: PASS
Source: http://127.0.0.1:5173/index.html

## Fixture and scope

- Paused classic game; phase 4, 5000 EUR and 500 materials prepared. All architecture changes use engine.transformBuilding.
- SwiftShader requested; visual validation only, no performance benchmark.
- Viewport: 1920×1080 CSS at DPR 2; expected drawing buffer and general/zoom PNGs: 3840×2160.
- House: Banks variant 0. Legacy well, farm, park and market provide scale references.
- Real transformations recorded: 14.

## Twelve combinations

| Floors | Roof | Modules | Roof Y | Signature |
|---:|---|---:|---:|---|
| 1 | traditional | 2 | 0.48 | `base_house_banks_0|1|floor_banks_0|roof_traditional_banks_0|true` |
| 1 | garden | 2 | 0.48 | `base_house_banks_0|1|floor_banks_0|roof_garden_banks|true` |
| 1 | productive | 2 | 0.48 | `base_house_banks_0|1|floor_banks_0|roof_productive_banks|true` |
| 2 | traditional | 3 | 0.96 | `base_house_banks_0|2|floor_banks_0|roof_traditional_banks_0|true` |
| 2 | garden | 3 | 0.96 | `base_house_banks_0|2|floor_banks_0|roof_garden_banks|true` |
| 2 | productive | 3 | 0.96 | `base_house_banks_0|2|floor_banks_0|roof_productive_banks|true` |
| 3 | traditional | 4 | 1.44 | `base_house_banks_0|3|floor_banks_0|roof_traditional_banks_0|true` |
| 3 | garden | 4 | 1.44 | `base_house_banks_0|3|floor_banks_0|roof_garden_banks|true` |
| 3 | productive | 4 | 1.44 | `base_house_banks_0|3|floor_banks_0|roof_productive_banks|true` |
| 4 | traditional | 5 | 1.92 | `base_house_banks_0|4|floor_banks_0|roof_traditional_banks_0|true` |
| 4 | garden | 5 | 1.92 | `base_house_banks_0|4|floor_banks_0|roof_garden_banks|true` |
| 4 | productive | 5 | 1.92 | `base_house_banks_0|4|floor_banks_0|roof_productive_banks|true` |

Every level has local base 0 and top 0.48. Every roof has local base 0 at floors × 0.48. Each combination has exactly one upper roof and all its modules are pick targets.

## Previews and final picking

- traditional preview via roof_garden: distinct pixel hashes 532794221 / 2939660080, 600×420 canvases, city unchanged.
- garden preview via roof_productive: distinct pixel hashes 1957758401 / 1151513214, 600×420 canvases, city unchanged.
- productive preview via roof_traditional: distinct pixel hashes 826804162 / 532794221, 600×420 canvases, city unchanged.
- Final productive four-level house: 5/5 parts selected by raycast and real click.

## Native captures

| Capture | CSS | DPR | Drawing buffer | PNG | Bytes |
|---|---|---:|---|---|---:|
| [d1-preview-productive-before](captures/d1-preview-productive-before.png) | 300×210 | 2 | 600×420 | 600×420 | 78762 |
| [d1-preview-traditional-after](captures/d1-preview-traditional-after.png) | 300×210 | 2 | 600×420 | 600×420 | 79682 |
| [d1-house-4-productive-general](captures/d1-house-4-productive-general.png) | 1920×1080 | 2 | 3840×2160 | 3840×2160 | 1865401 |
| [d1-house-4-productive-zoom](captures/d1-house-4-productive-zoom.png) | 1920×1080 | 2 | 3840×2160 | 3840×2160 | 2305972 |

## Visual inspection performed

- The general and zoom PNGs use different useful framing and both retain the real interface, native 4K geometry and shadows.
- Four facade levels are visible with aligned balconies and no intermediate roof. The single productive roof sits above level 4.
- Solar panels and the water tank rest on the roof terrace; no floating accessory, detached roof band or visible gap was observed at native resolution.
- The productive and traditional preview images share camera and lighting while remaining clearly distinguishable. No product defect was confirmed in this recipe.
