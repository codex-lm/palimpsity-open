# First house — four floors, native 4K validation

Generated: 2026-11-04T09:04:35.186Z
Result: PASS
Source: http://127.0.0.1:5173/index.html

## Conditions

- Viewport: 1920×1080 CSS pixels at DPR 2; expected captures and drawing buffer: **3840×2160 physical pixels**.
- Renderer: SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark.
- Quality: `high`, native unclamped DPR, antialiasing requested by the renderer, 2048×2048 shadow map.
- The simulation was paused. Phase and resources were prepared; all three floor additions used `transformBuilding`.
- Machine: win32/x64, AMD Ryzen 9 5950X 16-Core Processor            , Node v24.22.1.

## Structural and interaction checks

- PASS — Real game loads with nearby legacy references.
- PASS — Three real transformBuilding calls reach four floors.
- PASS — Banks variant 0 has four 0.48 levels and one roof at Y=1.92.
- PASS — No intermediate roof and legacy references remain legacy.
- PASS — Inspector focus reaches the four-floor house.
- PASS — Wheel zoom reaches minDistance without crossing the ground.
- PASS — Base, three floors and roof each raycast and click-select the house.
- PASS — High quality keeps 2048 shadow mapping enabled.

Maximum zoom: distance **9.6411** / minDistance **9.6411**; camera Y **9.6893**.

### Module anchors

| Part | Local Y | Measured base | Measured top | Meshes |
|---|---:|---:|---:|---:|
| Ground floor | 0.00 | 0.0000 | 0.4800 | 7 |
| Floor 2 | 0.48 | -0.0000 | 0.4800 | 7 |
| Floor 3 | 0.96 | -0.0000 | 0.4800 | 7 |
| Floor 4 | 1.44 | -0.0000 | 0.4800 | 7 |
| Roof | 1.92 | 0.0000 | 0.3875 | 4 |

## Native rendering measurements

| View | FPS (SwiftShader) | Mean ms | p95 ms | DPR | Drawing buffer | Draw calls | Triangles |
|---|---:|---:|---:|---:|---:|---:|---:|
| four-floor-general | 1.0 | 1035.0 | 1083.3 | 2 | 3840×2160 | 828 | 161518 |
| four-floor-zoom-max | 0.5 | 1892.2 | 1950.0 | 2 | 3840×2160 | 361 | 46893 |

These numbers are observations under SwiftShader, not hardware-GPU performance claims.

## Captures

- [first-house-1-level](captures/first-house-1-level.png) — 3840×2160 physical pixels, 1232589 bytes.
- [first-house-general](captures/first-house-general.png) — 3840×2160 physical pixels, 1233279 bytes.
- [first-house-zoom-max](captures/first-house-zoom-max.png) — 3840×2160 physical pixels, 1136639 bytes.

The general and maximum-zoom captures include the real interface.

## Visual inspection performed on the PNGs

- The one-level and four-level captures use the same home framing. The completed house keeps the same parcel footprint as the nearby well, farm, market and park; its four facade rows remain aligned at maximum zoom.
- The roof sits only above floor 4. No roof is visible between the ground floor and the three added floors, and no gap or overlapping roof band was observed.
- Native-resolution crops show crisp window frames, roof edges, building shadows and interface text. No depth-of-field or post-process blur is present.
- The diagonal market leaves the ground-floor facade visible. All five module picks were also exercised with real clicks, so the visual assessment does not substitute for the interaction checks.
- These captures were produced with SwiftShader. They validate geometry, native-pixel output and the observed software-rendered image, not hardware-driver rendering or performance.
