# Environment — berges, sols et mobilier

## Source et régénération

Le kit C3 est généré par `game/art/environment/build_environment.py`. Il réutilise les primitives et les matériaux fixes de `living-layers/build_living_layers.py`, puis exporte exactement 14 GLB dans `game/art/diorama/environment/`.

Depuis `game/` :

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python art/environment/build_environment.py
```

Ajouter `-- --skip-render` pour omettre `diorama/environment-preview.png`. La commande complète `npm run assets:diorama` régénère successivement les assets legacy, les 45 modules Living Layers, ces 14 modules et les quatre River Assets, puis valide les 103 GLB attendus, `terrain.glb` de présentation compris. Les axes et le manifeste fluviaux sont décrits dans `RIVER_ASSETS.md`.

Le manifeste commun contient :

```json
{
  "environment": {
    "modules": {
      "bank_straight": { "file": "environment/bank_straight.glb" }
    }
  }
}
```

Chaque entrée suit exactement la forme `{ "file": "environment/<key>.glb" }`.

## Catalogue fermé — 14 modules

| Groupe | Clés | Usage |
|---|---|---|
| Berges | `bank_straight`, `bank_corner_inner`, `bank_corner_outer` | Bordure fine de la rive réelle, pierres et végétation basse ; aucune eau ajoutée |
| Quai | `quay_straight` | Mur de rive étroit et pierres de couronnement ; le quai fonctionnel conserve son propre modèle |
| Sols | `ground_path`, `ground_soil`, `ground_fertile`, `ground_planted` | Chemin piéton étroit, sol nu, sillons et jeunes cultures |
| Place | `civic_plaza` | Placette pavée et médaillon dans une seule case |
| Végétation | `vegetation_reeds`, `vegetation_flowers` | Roseaux et fleurs basses |
| Mobilier | `furniture_bench`, `furniture_lamp`, `furniture_planter` | Banc bois/acier, lanterne et jardinière |

Ces modules sont exclusivement du décor. Ils ne représentent ni pont, ni route carrossable, ni bâtiment producteur.

## Ancrages et rotations

- Export glTF Y-up, origine au centre de la case ou du meuble. Le terrain original est conservé : cases de 1 unité, terre à `Y=0`, eau à `Y=-0.0925`.
- Les bordures de rive vont de `Y=-0.10` à `Y=0.008` et couvrent toute la longueur du bord (`-0.5…+0.5`) pour se raccorder sans fente. Leur largeur est de `0.082`, du côté terre `0.42` jusqu'à `0.502` : les 0.002 extérieurs masquent la face du terrain sans la superposer. Aucun socle de case ni surface d'eau dans ces modules.
- Les autres géométries gardent `X/Z ∈ [-0.475, +0.475]` et leur base à `Y=0` ; les sols occupent au maximum `0.95 × 0.95`.
- La façade d’eau canonique de `bank_straight` et `quay_straight` est du côté `+Z` dans le GLB (`-Y` dans Blender). Faire tourner autour de `Y` par multiples de 90° pour orienter ce raccord.
- `bank_corner_inner` habille les côtés `+Z` et `-X` par une seule bordure en L, sans faces coplanaires au raccord ni terre surélevée.
- `bank_corner_outer` décore uniquement le coin nord-est (`+X/-Z`) touchant l'eau en diagonale. Il ne découpe pas le terrain en triangle.
- `vegetation_reeds` ne contient que les tiges et feuilles, sans plaque de terre. Le placement à `0.42` vers l'eau garde chaque racine sur la terre à `Y=0` ; les touffes suivent la rive aux quatre orientations.
- `ground_path` suit l’axe `Z`. Une rotation de 90° autour de `Y` le fait suivre `X`.
- Les bancs et lanternes sont centrés sur leur emprise propre ; leurs hauteurs restent inférieures à un niveau Living Layers de `0.48`, sauf la lanterne qui culmine à environ `0.73`.

## Matériaux et instanciation

La palette est partagée avec C2 : terre et craie pour les berges ; graphite et craie pour les quais ; prune, sauge et lin pour les jardins et le mobilier. L'eau appartient uniquement au terrain d'origine. Il n'y a ni texture externe ni variation aléatoire de teinte.

Chaque GLB est fusionné puis séparé par matériau à l’export. Cela limite le nombre de meshes et permet de regrouper efficacement les placements identiques avec `InstancedMesh`, sans imposer ce choix au moteur.

Le générateur contrôle réellement chaque fichier : GLB 2.0 autonome, empreinte et centrage, hauteur adaptée aux bordures ou base `Y=0`, géométrie non vide, maximum 8 000 triangles, 20 meshes et 384 Kio par module. `node --test test/shoreline-geometry-review.mjs` vérifie les vrais GLB après transformation du renderer : continuité aux quatre orientations, angles, absence d'eau dupliquée et chaque racine de roseau. L'ancienne vignette `environment-preview.png` est une planche historique, pas une preuve du rendu corrigé dans le terrain.
