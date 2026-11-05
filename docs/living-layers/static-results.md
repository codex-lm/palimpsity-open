# Contrôles statiques observés

Commande exécutée depuis `game/` sur le standalone intégré et ses sources :

```bash
node --test test/living-layers-static.mjs
```

Dernier résultat : **3 tests, 3 réussites, 0 échec**.

- Les 45 clés du catalogue `layers.modules`, la hauteur de niveau `0.48` et les en-têtes GLB locaux sont validés.
- Les bâtiments possèdent leur architecture par instance ; les profils effectifs `before/after` sont complets et clonés ; noms, descriptions et raisons de blocage ont une traduction française.
- Le mode de rendu `high` conserve l'anticrénelage, le DPR natif et le dimensionnement indépendant du canvas.

Les vérifications syntaxiques des fichiers de recette avec `node --check` réussissent également. Les résultats navigateur et leurs éventuelles limites restent consignés séparément dans `observed-results.md` et `results.json`.
