# Living Layers — observed browser results

Generated: 2026-11-05T06:33:24.701Z
Revision: 0b4d2782f6303902f1eaa833e7151cedf9c47c6d

- Machine: win32/x64, AMD Ryzen 9 5950X 16-Core Processor            , 32 logical processors, 68645154816 bytes RAM.
- Runtime: Node v24.22.1; Chrome/156.0.8078.80.
- Conditions: SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark; isolated temporary Chrome profile, new headless mode, offline network emulation.
- Standalone export: 17378392 bytes (2824751 bytes gzip).
- Frame samples: 30 measured requestAnimationFrame intervals after 15 warm-up frames, simulation paused.

## Scenarios

- **PASSED — elevated city** (9346 ms)
- **PASSED — mixed city, two conversions, camera and native viewports** (21368 ms)
- **PASSED — dense city — high and low quality** (11013 ms)
- **PASSED — River Pact — Garden commons** (5798 ms)
- **PASSED — River Pact — Makers quarter** (5583 ms)

## Measurements

All values below are observations from this run, not targets or hardware-GPU claims.

| View | FPS | mean ms | p95 ms | draw calls | triangles | JS heap bytes | DPR / renderer ratio | drawing buffer |
|---|---:|---:|---:|---:|---:|---:|---|---|
| mixed-1280x720-general | 60.00 | 16.67 | 17.10 | 931 | 199984 | 91700000 | 1 / 1 | 1280×720 |
| mixed-1920x1080-high-general | 60.00 | 16.67 | 16.90 | 931 | 199984 | 91700000 | 2 / 2 | 3840×2160 |
| mixed-390x844-high-general | 60.00 | 16.67 | 16.80 | 931 | 199984 | 91700000 | 2 / 2 | 780×1688 |
| mixed-3840x2160-general | 60.00 | 16.67 | 16.80 | 931 | 199984 | 91700000 | 1 / 1 | 3840×2160 |
| dense-1920x1080-high | 60.00 | 16.67 | 16.80 | 1328 | 244219 | 91700000 | 2 / 2 | 3840×2160 |
| dense-1920x1080-low | 60.00 | 16.67 | 16.80 | 1318 | 243979 | 91700000 | 2 / 1 | 1920×1080 |

## Captures

- `captures/elevated-before-general.png` — 1280×720 physical pixels, 313415 bytes.
- `captures/elevated-after-general.png` — 1280×720 physical pixels, 318253 bytes.
- `captures/elevated-after-close-inspector.png` — 1280×720 physical pixels, 328402 bytes.
- `captures/mixed-before-general.png` — 1280×720 physical pixels, 315884 bytes.
- `captures/mixed-after-general.png` — 1280×720 physical pixels, 319865 bytes.
- `captures/mixed-workshop-repair-close-inspector.png` — 1280×720 physical pixels, 512438 bytes.
- `captures/mixed-warehouse-hall-close-inspector.png` — 1280×720 physical pixels, 576148 bytes.
- `captures/mixed-after-close-inspector.png` — 1280×720 physical pixels, 368930 bytes.
- `captures/mixed-1280x720-general.png` — 1280×720 physical pixels, 365091 bytes.
- `captures/mixed-1280x720-close-inspector.png` — 1280×720 physical pixels, 421026 bytes.
- `captures/mixed-1920x1080-high-general.png` — 3840×2160 physical pixels, 2028648 bytes.
- `captures/mixed-1920x1080-high-close-inspector.png` — 3840×2160 physical pixels, 1882658 bytes.
- `captures/mixed-390x844-high-general.png` — 780×1688 physical pixels, 329801 bytes.
- `captures/mixed-390x844-high-close-inspector.png` — 780×1688 physical pixels, 352449 bytes.
- `captures/mixed-3840x2160-general.png` — 3840×2160 physical pixels, 1584192 bytes.
- `captures/mixed-3840x2160-close-inspector.png` — 3840×2160 physical pixels, 2089121 bytes.
- `captures/dense-1920x1080-high-general.png` — 3840×2160 physical pixels, 1901020 bytes.
- `captures/dense-1920x1080-low-general.png` — 3840×2160 physical pixels, 1672711 bytes.
- `captures/river-gardens-before-charter.png` — 1280×720 physical pixels, 177247 bytes.
- `captures/river-gardens-after-charter.png` — 1280×720 physical pixels, 285977 bytes.
- `captures/river-gardens-success-dialog.png` — 1280×720 physical pixels, 202847 bytes.
- `captures/river-workshops-before-charter.png` — 1280×720 physical pixels, 177247 bytes.
- `captures/river-workshops-after-charter.png` — 1280×720 physical pixels, 286716 bytes.
- `captures/river-workshops-success-dialog.png` — 1280×720 physical pixels, 202292 bytes.

The JSON report contains full actions, architecture/conversion evidence, CDP memory metrics and errors.
