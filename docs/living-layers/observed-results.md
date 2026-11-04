# Living Layers — observed browser results

Generated: 2026-11-04T10:18:03.876Z
Revision: a7998e21718efcbfb47a12b3ed538c00ca956bb3

- Machine: win32/x64, AMD Ryzen 9 5950X 16-Core Processor            , 32 logical processors, 68645154816 bytes RAM.
- Runtime: Node v24.22.1; Chrome/156.0.8078.80.
- Conditions: SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark; isolated temporary Chrome profile, new headless mode, offline network emulation.
- Standalone export: 16445352 bytes (2668053 bytes gzip).
- Frame samples: 30 measured requestAnimationFrame intervals after 15 warm-up frames, simulation paused.

## Scenarios

- **PASSED — elevated city** (30614 ms)
- **PASSED — mixed city, two conversions, camera and native viewports** (360926 ms)
- **PASSED — dense city — high and low quality** (118787 ms)
- **PASSED — River Pact — Garden commons** (54311 ms)
- **PASSED — River Pact — Makers quarter** (55254 ms)

## Measurements

All values below are observations from this run, not targets or hardware-GPU claims.

| View | FPS | mean ms | p95 ms | draw calls | triangles | JS heap bytes | DPR / renderer ratio | drawing buffer |
|---|---:|---:|---:|---:|---:|---:|---|---|
| mixed-1280x720-general | 3.85 | 259.99 | 266.70 | 905 | 185424 | 56800000 | 1 / 1 | 1280×720 |
| mixed-1920x1080-high-general | 0.88 | 1131.64 | 1183.40 | 905 | 185424 | 56800000 | 2 / 2 | 3840×2160 |
| mixed-390x844-high-general | 4.27 | 234.44 | 250.00 | 914 | 186580 | 56800000 | 2 / 2 | 780×1688 |
| mixed-3840x2160-general | 0.89 | 1118.30 | 1150.00 | 905 | 185424 | 56800000 | 1 / 1 | 3840×2160 |
| dense-1920x1080-high | 0.77 | 1296.07 | 1350.00 | 1311 | 235799 | 56800000 | 2 / 2 | 3840×2160 |
| dense-1920x1080-low | 3.65 | 273.88 | 283.40 | 1301 | 235559 | 56800000 | 2 / 1 | 1920×1080 |

## Captures

- `captures/elevated-before-general.png` — 1280×720 physical pixels, 320644 bytes.
- `captures/elevated-after-general.png` — 1280×720 physical pixels, 326951 bytes.
- `captures/elevated-after-close-inspector.png` — 1280×720 physical pixels, 375601 bytes.
- `captures/mixed-before-general.png` — 1280×720 physical pixels, 323164 bytes.
- `captures/mixed-after-general.png` — 1280×720 physical pixels, 326188 bytes.
- `captures/mixed-workshop-repair-close-inspector.png` — 1280×720 physical pixels, 407115 bytes.
- `captures/mixed-warehouse-hall-close-inspector.png` — 1280×720 physical pixels, 401394 bytes.
- `captures/mixed-after-close-inspector.png` — 1280×720 physical pixels, 384660 bytes.
- `captures/mixed-1280x720-general.png` — 1280×720 physical pixels, 368671 bytes.
- `captures/mixed-1280x720-close-inspector.png` — 1280×720 physical pixels, 384660 bytes.
- `captures/mixed-1920x1080-high-general.png` — 3840×2160 physical pixels, 1782189 bytes.
- `captures/mixed-1920x1080-high-close-inspector.png` — 3840×2160 physical pixels, 1856414 bytes.
- `captures/mixed-390x844-high-general.png` — 780×1688 physical pixels, 327460 bytes.
- `captures/mixed-390x844-high-close-inspector.png` — 780×1688 physical pixels, 300569 bytes.
- `captures/mixed-3840x2160-general.png` — 3840×2160 physical pixels, 1633152 bytes.
- `captures/mixed-3840x2160-close-inspector.png` — 3840×2160 physical pixels, 2024458 bytes.
- `captures/dense-1920x1080-high-general.png` — 3840×2160 physical pixels, 1777733 bytes.
- `captures/dense-1920x1080-low-general.png` — 3840×2160 physical pixels, 1584310 bytes.
- `captures/river-gardens-before-charter.png` — 1280×720 physical pixels, 192360 bytes.
- `captures/river-gardens-after-charter.png` — 1280×720 physical pixels, 304168 bytes.
- `captures/river-gardens-success-dialog.png` — 1280×720 physical pixels, 223817 bytes.
- `captures/river-workshops-before-charter.png` — 1280×720 physical pixels, 192360 bytes.
- `captures/river-workshops-after-charter.png` — 1280×720 physical pixels, 304416 bytes.
- `captures/river-workshops-success-dialog.png` — 1280×720 physical pixels, 223324 bytes.

The JSON report contains full actions, architecture/conversion evidence, CDP memory metrics and errors.
