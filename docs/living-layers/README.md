# Preuves Living Layers — socle A–D

Le point d’entrée consolidé est [`DELIVERY.md`](DELIVERY.md) : fonctionnalités, retours NILO-001 à NILO-012, architecture, commandes, captures, performances finales et limites.

## Commandes

Depuis `game/`, après reconstruction de `../dist/palimpsity-mvp.html` par le chantier d’intégration :

```bash
npm test                         # 157 tests
npm run test:d2-calculation      # 5 tests RAF distincts
npm run test:living-layers-browser
npm run test:d1
npm run test:d2
npm run test:d3
npm run test:015
```

`CHROME_EXE` peut sélectionner Chrome, Chromium ou Edge. `LIVING_LAYERS_RENDERER=default` laisse Chrome choisir son renderer ; `swiftshader` est une option explicite. `LIVING_LAYERS_FRAMES` concerne l’ancienne recette générale, tandis que D2 exige au moins 10 secondes et 20 intervalles RAF bruts par vue. Aucune recette ne reconstruit le livrable à la place de l’intégrateur.

## Couverture

- transformations jusqu’à quatre niveaux, boutiques, trois toits, deux conversions et Commons ;
- familles/variantes, focus, photo, qualité, effets et LOD orthographique ;
- ville élevée, ville mixte, ville dense, caméra/inspection répétées et deux chartes River Pact ;
- viewports 1280×720, 1920×1080 DPR 2, 390×844 DPR 2 et 3840×2160 ;
- D1 : 12 combinaisons niveaux/toits ;
- D2 : baseline/courant avec renderer effectif commun et intervalles RAF bruts ;
- D3 : route naturelle automatisée, distincte de la partie jouée par Nilo via les commandes du navigateur ;
- 015 : quais payés t27, flux t28, réseau saturé t120, trois puits de secours SW et victoire t161, sans injection de ressources, phase ou population.

Les scènes visuelles préparent explicitement phase et ressources ; elles ne prouvent pas une progression naturelle. D3 et les playthroughs Node apportent cette preuve séparément. Les anciennes mesures SwiftShader sont conservées à part et ne sont pas mélangées au résultat RTX 3080.

## Rapports

- [`DELIVERY.md`](DELIVERY.md) : synthèse complète A–D et lot 015, avec limites ;
- [`015-natural-summary.md`](015-natural-summary.md) et [`015-natural-results.json`](015-natural-results.json) : route naturelle quais/barges, actions et intervalles RAF bruts ;
- [`observed-results.md`](observed-results.md) et [`results.json`](results.json) : recette navigateur 5/5 ;
- [`d1-roof-matrix-4k.md`](d1-roof-matrix-4k.md) : 12 combinaisons D1 ;
- [`d2-performance-comparison.md`](d2-performance-comparison.md) et [`d2-performance-results.json`](d2-performance-results.json) : finale RTX 3080 D3D11, 601 intervalles/vue ;
- [`d2-performance-initial.md`](d2-performance-initial.md) et [`d2-performance-initial.json`](d2-performance-initial.json) : preuves initiales préservées, captures dans `captures/d2-initial/` ;
- [`d3-natural-results.json`](d3-natural-results.json) : route naturelle automatisée ;
- [`static-results.md`](static-results.md) : contrôles hors navigateur ;
- `captures/` : PNG natifs, sans redimensionnement documentaire.

Un statut `blocked` indique une API ou un asset absent du livrable testé. Un statut `failed` signale une erreur de recette ou de comportement. Les rapports initiaux et la baseline HTML ne sont pas écrasés lors des consolidations finales.
