# Recette Living Layers

Cette recette utilise uniquement Node 22+ et Chrome/Chromium via le protocole CDP. Elle n'ajoute aucune dépendance npm et ne lance pas de profil navigateur personnel.

## Exécution

Depuis `game/`, après que le chantier d'intégration a reconstruit `../dist/palimpsity-mvp.html` :

```bash
node --test test/living-layers-static.mjs
node test/living-layers-browser.mjs
node test/d2-performance-comparison.mjs
```

`CHROME_EXE` peut désigner un exécutable Chrome, Chromium ou Edge. `LIVING_LAYERS_FRAMES` change le nombre d'intervalles mesurés par vue (30 par défaut, minimum 20). La recette ne reconstruit pas elle-même le livrable afin de tester exactement le fichier autonome présent.

## Couverture

- petite ville élevée par `place`, `tick` et `transformBuilding`, avec captures avant/après ;
- ville mixte avec transformation commerciale, toit-jardin et les deux conversions publiques `workshop_repair` et `warehouse_hall`, avec inspecteurs rapprochés ;
- trois cycles de rotation, zoom, changement de projection, recentrage et inspection ;
- ville dense avec 12 maisons portées à quatre niveaux, mesurée au même viewport en qualité `high` puis `low` ;
- River Pact joué depuis 600 € avec les chartes Garden commons et Makers quarter, y compris la sécheresse et la victoire ;
- vues générales et rapprochées à 1280×720, 1920×1080 DPR 2, 390×844 DPR 2 et 3840×2160 ;
- FPS et temps de frame issus de `requestAnimationFrame`, draw calls, triangles, mémoire WebGL/JS, DPR, drawing buffer, dimensions natives PNG et taille du HTML autonome ;
- contrats statiques des modules, profils clonés, traductions anglaises/françaises et rendu `high` au DPR natif.

Les scènes visuelles élevée, mixte et dense préparent explicitement la phase 4, 5000 € et 500 matériaux, comme `first-house-4k`, puis exécutent les vraies transformations et conversions publiques. Ces fixtures ne prouvent pas la jouabilité naturelle. Les deux parcours River Pact restent séparés et conservent leur budget naturel de 600 €. Les mesures sont faites en pause. Le mode headless demande SwiftShader : les chiffres décrivent cette configuration logicielle, pas les performances d'un GPU matériel.

## Résultats

- [`DELIVERY.md`](DELIVERY.md) : synthèse de livraison, architecture, commandes, captures comparables, mesures et limites ;
- [`d2-performance-comparison.md`](d2-performance-comparison.md) et [`d2-performance-results.json`](d2-performance-results.json) : comparaison séquentielle baseline/courant, au moins 10 s par vue sous SwiftShader, avec deltas p95 et captures séparées ;
- `results.json` : rapport brut, actions, erreurs, métriques et environnement ;
- `observed-results.md` : résultats effectivement observés lors de la dernière exécution navigateur ;
- `static-results.md` : résultats et blocages des contrôles hors navigateur ;
- `captures/` : PNG natifs, sans redimensionnement après capture.

Un statut `blocked` signifie que le livrable autonome ne contient pas encore une API ou un manifeste requis. Un statut `failed` signale une erreur de recette ou de comportement. Dans les deux cas, le rapport reste écrit et la commande échoue ; les autres scénarios indépendants continuent afin de documenter ce qui a réellement été vérifié.
