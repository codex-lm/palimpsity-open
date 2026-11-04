# Living Layers — observed browser results

Generated: 2026-11-04T23:00:00.688Z
Revision: 50e382488be8d394b00fa3c80b9c3ad7324ec1a2

- Machine: win32/x64, AMD Ryzen 9 5950X 16-Core Processor            , 32 logical processors, 68645154816 bytes RAM.
- Runtime: Node v24.22.1; Chrome/156.0.8078.80.
- Conditions: SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark; isolated temporary Chrome profile, new headless mode, offline network emulation.
- Standalone export: 17071612 bytes (2772401 bytes gzip).
- Frame samples: 30 measured requestAnimationFrame intervals after 15 warm-up frames, simulation paused.

## Scenarios

- **PASSED — elevated city** (37531 ms)
- **PASSED — mixed city, two conversions, camera and native viewports** (373764 ms)
- **PASSED — dense city — high and low quality** (129089 ms)
- **PASSED — River Pact — Garden commons** (67118 ms)
- **PASSED — River Pact — Makers quarter** (67131 ms)

## Measurements

All values below are observations from this run, not targets or hardware-GPU claims.

| View | FPS | mean ms | p95 ms | draw calls | triangles | JS heap bytes | DPR / renderer ratio | drawing buffer |
|---|---:|---:|---:|---:|---:|---:|---|---|
| mixed-1280x720-general | 3.28 | 304.44 | 316.70 | 956 | 266512 | 64000000 | 1 / 1 | 1280×720 |
| mixed-1920x1080-high-general | 0.92 | 1090.52 | 1150.00 | 956 | 266512 | 64000000 | 2 / 2 | 3840×2160 |
| mixed-390x844-high-general | 3.77 | 265.55 | 283.40 | 956 | 266512 | 64000000 | 2 / 2 | 780×1688 |
| mixed-3840x2160-general | 0.91 | 1104.97 | 1150.10 | 956 | 266512 | 64000000 | 1 / 1 | 3840×2160 |
| dense-1920x1080-high | 0.71 | 1402.18 | 1449.90 | 1353 | 307743 | 64000000 | 2 / 2 | 3840×2160 |
| dense-1920x1080-low | 3.28 | 304.43 | 316.70 | 1343 | 307503 | 64000000 | 2 / 1 | 1920×1080 |

## Captures

- `captures/elevated-before-general.png` — 1280×720 physical pixels, 377624 bytes.
- `captures/elevated-after-general.png` — 1280×720 physical pixels, 383953 bytes.
- `captures/elevated-after-close-inspector.png` — 1280×720 physical pixels, 450328 bytes.
- `captures/mixed-before-general.png` — 1280×720 physical pixels, 377906 bytes.
- `captures/mixed-after-general.png` — 1280×720 physical pixels, 384198 bytes.
- `captures/mixed-workshop-repair-close-inspector.png` — 1280×720 physical pixels, 547205 bytes.
- `captures/mixed-warehouse-hall-close-inspector.png` — 1280×720 physical pixels, 583862 bytes.
- `captures/mixed-after-close-inspector.png` — 1280×720 physical pixels, 481738 bytes.
- `captures/mixed-1280x720-general.png` — 1280×720 physical pixels, 413780 bytes.
- `captures/mixed-1280x720-close-inspector.png` — 1280×720 physical pixels, 481738 bytes.
- `captures/mixed-1920x1080-high-general.png` — 3840×2160 physical pixels, 2016591 bytes.
- `captures/mixed-1920x1080-high-close-inspector.png` — 3840×2160 physical pixels, 2145795 bytes.
- `captures/mixed-390x844-high-general.png` — 780×1688 physical pixels, 363373 bytes.
- `captures/mixed-390x844-high-close-inspector.png` — 780×1688 physical pixels, 317656 bytes.
- `captures/mixed-3840x2160-general.png` — 3840×2160 physical pixels, 1801232 bytes.
- `captures/mixed-3840x2160-close-inspector.png` — 3840×2160 physical pixels, 2480428 bytes.
- `captures/dense-1920x1080-high-general.png` — 3840×2160 physical pixels, 2297421 bytes.
- `captures/dense-1920x1080-low-general.png` — 3840×2160 physical pixels, 2178471 bytes.
- `captures/river-gardens-before-charter.png` — 1280×720 physical pixels, 174935 bytes.
- `captures/river-gardens-after-charter.png` — 1280×720 physical pixels, 343187 bytes.
- `captures/river-gardens-success-dialog.png` — 1280×720 physical pixels, 206369 bytes.
- `captures/river-workshops-before-charter.png` — 1280×720 physical pixels, 173201 bytes.
- `captures/river-workshops-after-charter.png` — 1280×720 physical pixels, 343912 bytes.
- `captures/river-workshops-success-dialog.png` — 1280×720 physical pixels, 204591 bytes.

The JSON report contains full actions, architecture/conversion evidence, CDP memory metrics and errors.
