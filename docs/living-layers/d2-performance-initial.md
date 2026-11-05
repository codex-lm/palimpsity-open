# D2 — comparaison de performance baseline / courant

Généré : 2026-11-05T00:31:44.646Z

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
| current | 17072793 o | 2772778 o | `7904f1105f831815e8d33aaf1e710c9ab2cab03173b1e467314bed71f59c534b` |

## Mesures

| Artifact | Scène | Qualité | Durée | Frames | FPS | Médiane | p95 | Draw calls | Triangles | Buffer |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | small | high | 10.30 s | 9 | 0.87 | 1016.60 ms | 1066.60 ms | 940 | 190073 | 3840×2160 |
| baseline | small | low | 10.12 s | 48 | 4.74 | 200.00 ms | 216.70 ms | 940 | 190073 | 1920×1080 |
| baseline | dense | high | 11.02 s | 9 | 0.82 | 1100.10 ms | 1150.00 ms | 1343 | 240199 | 3840×2160 |
| baseline | dense | low | 10.11 s | 40 | 3.96 | 250.00 ms | 266.60 ms | 1343 | 240199 | 1920×1080 |
| current | small | high | 10.81 s | 9 | 0.83 | 1083.20 ms | 1100.00 ms | 957 | 203393 | 3840×2160 |
| current | small | low | 10.11 s | 44 | 4.35 | 216.70 ms | 233.40 ms | 957 | 203393 | 1920×1080 |
| current | dense | high | 10.02 s | 7 | 0.70 | 1283.30 ms | 1316.60 ms | 1360 | 248687 | 3840×2160 |
| current | dense | low | 10.32 s | 36 | 3.49 | 266.70 ms | 350.00 ms | 1360 | 248687 | 1920×1080 |

## Delta du p95 courant vs baseline

| Scène | Qualité | Baseline p95 | Courant p95 | Delta | Seuil 10 % |
|---|---|---:|---:|---:|---|
| small | high | 1066.60 ms | 1100.00 ms | +3.13 % | Non |
| small | low | 216.70 ms | 233.40 ms | +7.71 % | Non |
| dense | high | 1150.00 ms | 1316.60 ms | +14.49 % | À documenter |
| dense | low | 266.60 ms | 350.00 ms | +31.28 % | À documenter |

### Lecture

- **dense/high** : régression de 14.49 % du p95. Constat documenté sans modification du produit pour le masquer.
- **dense/low** : régression de 31.28 % du p95. Constat documenté sans modification du produit pour le masquer.

## Captures natives

- [baseline/small/high](captures/d2-initial/d2-baseline-small-high.png) — 3840×2160, 1398506 octets.
- [baseline/small/low](captures/d2-initial/d2-baseline-small-low.png) — 3840×2160, 1224598 octets.
- [baseline/dense/high](captures/d2-initial/d2-baseline-dense-high.png) — 3840×2160, 1767374 octets.
- [baseline/dense/low](captures/d2-initial/d2-baseline-dense-low.png) — 3840×2160, 1564922 octets.
- [current/small/high](captures/d2-initial/d2-current-small-high.png) — 3840×2160, 1605791 octets.
- [current/small/low](captures/d2-initial/d2-current-small-low.png) — 3840×2160, 1465549 octets.
- [current/dense/high](captures/d2-initial/d2-current-dense-high.png) — 3840×2160, 1965548 octets.
- [current/dense/low](captures/d2-initial/d2-current-dense-low.png) — 3840×2160, 1814352 octets.

La baseline HTML et `baseline-results-70c306f.json` sont conservés hors de ce rapport et n’ont pas été réécrits.
