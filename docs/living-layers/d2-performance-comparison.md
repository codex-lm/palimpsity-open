# D2 — comparaison de performance baseline / courant

Généré : 2026-11-05T01:54:46.072Z

## Conditions et portée

- Un seul Chrome (Chrome/156.0.8078.80), artifacts chargés séquentiellement, viewport 1920×1080 à DPR 2.
- Moteur WebGL réel commun : **ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002216) Direct3D11 vs_5_0 ps_5_0, D3D11)** (Google Inc. (NVIDIA)).
- Échauffement configuré à 5 s minimum (durée réelle conservée par vue), puis **au moins 10 s et 20 intervalles RAF**, avec borne de 60 s si le rendu est lent.
- Mêmes scènes, caméra de vallée, fixtures publiques, qualité, résolution et renderer effectif pour baseline et courant.
- Durée et FPS calculés depuis la même somme d’intervalles RAF bruts, conservés dans le JSON. SwiftShader n’est pas un GPU matériel ; aucune validation matérielle n’est déduite.

## Artifacts

| Artifact | Brut | Gzip | SHA-256 |
|---|---:|---:|---|
| baseline | 16445352 o | 2668053 o | `49fba91a84a7c44da980f0bc228c2c0e04e49ab84e2fc666aef5ff3b2e64f4f0` |
| current | 17073157 o | 2772919 o | `873ac161ec63c549067ad11d4c67379ab2df7ca140fda3b06ba86d3ac9b500fd` |

## Mesures

| Artifact | Scène | Qualité | Durée | Frames | FPS | Médiane | p95 | Draw calls | Triangles | Buffer |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | small | high | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 940 | 190073 | 3840×2160 |
| baseline | small | low | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 940 | 190073 | 1920×1080 |
| baseline | dense | high | 10.02 s | 601 | 60.00 | 16.70 ms | 16.90 ms | 1343 | 240199 | 3840×2160 |
| baseline | dense | low | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 1343 | 240199 | 1920×1080 |
| current | small | high | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 957 | 203393 | 3840×2160 |
| current | small | low | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 957 | 203393 | 1920×1080 |
| current | dense | high | 10.02 s | 601 | 60.00 | 16.70 ms | 16.80 ms | 1360 | 248687 | 3840×2160 |
| current | dense | low | 10.02 s | 601 | 60.00 | 16.70 ms | 16.90 ms | 1360 | 248687 | 1920×1080 |

## Delta du p95 courant vs baseline

| Scène | Qualité | Baseline p95 | Courant p95 | Delta | Seuil 10 % |
|---|---|---:|---:|---:|---|
| small | high | 16.80 ms | 16.80 ms | +0.00 % | Non |
| small | low | 16.80 ms | 16.80 ms | +0.00 % | Non |
| dense | high | 16.90 ms | 16.80 ms | -0.59 % | Non |
| dense | low | 16.80 ms | 16.90 ms | +0.60 % | Non |

### Lecture

Aucun delta absolu de p95 supérieur ou égal à 10 % entre les deux artifacts dans ces conditions.

## Captures natives

- [baseline/small/high](captures/d2/d2-baseline-small-high.png) — 3840×2160, 1346168 octets.
- [baseline/small/low](captures/d2/d2-baseline-small-low.png) — 3840×2160, 1119537 octets.
- [baseline/dense/high](captures/d2/d2-baseline-dense-high.png) — 3840×2160, 1701534 octets.
- [baseline/dense/low](captures/d2/d2-baseline-dense-low.png) — 3840×2160, 1434168 octets.
- [current/small/high](captures/d2/d2-current-small-high.png) — 3840×2160, 1548682 octets.
- [current/small/low](captures/d2/d2-current-small-low.png) — 3840×2160, 1330777 octets.
- [current/dense/high](captures/d2/d2-current-dense-high.png) — 3840×2160, 1889328 octets.
- [current/dense/low](captures/d2/d2-current-dense-low.png) — 3840×2160, 1653660 octets.

La baseline HTML et `baseline-results-70c306f.json` sont conservés hors de ce rapport et n’ont pas été réécrits.
