# D2 — comparaison de performance baseline / courant

Généré : 2026-11-04T22:50:26.013Z

## Conditions et portée

- Un seul Chrome (Chrome/156.0.8078.80), artifacts chargés séquentiellement, viewport 1920×1080 à DPR 2.
- Moteur WebGL réel : **ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)** (Google Inc. (Google)).
- Après 5 s minimum d’échauffement, chaque vue est échantillonnée pendant **au moins 10 s**, simulation en pause.
- Mêmes scènes, caméra de vallée, fixtures publiques, qualité et résolution pour baseline et courant.
- **SwiftShader uniquement : aucune validation de performance sur GPU matériel.**

## Artifacts

| Artifact | Brut | Gzip | SHA-256 |
|---|---:|---:|---|
| baseline | 16445352 o | 2668053 o | `49fba91a84a7c44da980f0bc228c2c0e04e49ab84e2fc666aef5ff3b2e64f4f0` |
| current | 17071612 o | 2772401 o | `2c2579f4bc1233a4d0f45b8c8e41393c73d899aacd6da78079c675dac5d1e3fe` |

## Mesures

| Artifact | Scène | Qualité | Durée | Frames | FPS | Médiane | p95 | Draw calls | Triangles | Buffer |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | small | high | 10.82 s | 10 | 0.92 | 966.70 ms | 1000.00 ms | 940 | 190073 | 3840×2160 |
| baseline | small | low | 10.07 s | 48 | 4.76 | 200.00 ms | 216.70 ms | 940 | 190073 | 1920×1080 |
| baseline | dense | high | 10.99 s | 8 | 0.73 | 1216.60 ms | 1233.30 ms | 1343 | 240199 | 3840×2160 |
| baseline | dense | low | 10.01 s | 38 | 3.80 | 250.00 ms | 266.70 ms | 1343 | 240199 | 1920×1080 |
| current | small | high | 10.02 s | 7 | 0.70 | 1249.90 ms | 1266.60 ms | 982 | 270757 | 3840×2160 |
| current | small | low | 10.28 s | 36 | 3.50 | 283.30 ms | 300.00 ms | 982 | 270757 | 1920×1080 |
| current | dense | high | 11.36 s | 7 | 0.62 | 1416.60 ms | 1416.70 ms | 1385 | 312211 | 3840×2160 |
| current | dense | low | 10.07 s | 32 | 3.18 | 300.00 ms | 316.70 ms | 1385 | 312211 | 1920×1080 |

## Delta du p95 courant vs baseline

| Scène | Qualité | Baseline p95 | Courant p95 | Delta | Seuil 10 % |
|---|---|---:|---:|---:|---|
| small | high | 1000.00 ms | 1266.60 ms | +26.66 % | À documenter |
| small | low | 216.70 ms | 300.00 ms | +38.44 % | À documenter |
| dense | high | 1233.30 ms | 1416.70 ms | +14.87 % | À documenter |
| dense | low | 266.70 ms | 316.70 ms | +18.75 % | À documenter |

### Lecture

- **small/high** : régression de 26.66 % du p95. Constat documenté sans modification du produit pour le masquer.
- **small/low** : régression de 38.44 % du p95. Constat documenté sans modification du produit pour le masquer.
- **dense/high** : régression de 14.87 % du p95. Constat documenté sans modification du produit pour le masquer.
- **dense/low** : régression de 18.75 % du p95. Constat documenté sans modification du produit pour le masquer.

## Captures natives

- [baseline/small/high](captures/d2/d2-baseline-small-high.png) — 3840×2160, 1398568 octets.
- [baseline/small/low](captures/d2/d2-baseline-small-low.png) — 3840×2160, 1224622 octets.
- [baseline/dense/high](captures/d2/d2-baseline-dense-high.png) — 3840×2160, 1767376 octets.
- [baseline/dense/low](captures/d2/d2-baseline-dense-low.png) — 3840×2160, 1564750 octets.
- [current/small/high](captures/d2/d2-current-small-high.png) — 3840×2160, 1956863 octets.
- [current/small/low](captures/d2/d2-current-small-low.png) — 3840×2160, 1832727 octets.
- [current/dense/high](captures/d2/d2-current-dense-high.png) — 3840×2160, 2292960 octets.
- [current/dense/low](captures/d2/d2-current-dense-low.png) — 3840×2160, 2164042 octets.

La baseline HTML et `baseline-results-70c306f.json` sont conservés hors de ce rapport et n’ont pas été réécrits.
