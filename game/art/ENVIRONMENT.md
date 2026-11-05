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
| Berges | `bank_straight`, `bank_corner_inner`, `bank_corner_outer` | Eau peu profonde, terre en pente ou en pointe, pierres et végétation basse |
| Quai | `quay_straight` | Mur bâti, pierres de couronnement, pavés, escalier et bitts |
| Sols | `ground_path`, `ground_soil`, `ground_fertile`, `ground_planted` | Chemin piéton étroit, sol nu, sillons et jeunes cultures |
| Place | `civic_plaza` | Placette pavée et médaillon dans une seule case |
| Végétation | `vegetation_reeds`, `vegetation_flowers` | Roseaux et fleurs basses |
| Mobilier | `furniture_bench`, `furniture_lamp`, `furniture_planter` | Banc bois/acier, lanterne et jardinière |

Ces modules sont exclusivement du décor. Ils ne représentent ni pont, ni route carrossable, ni bâtiment producteur.

## Ancrages et rotations

- Export glTF Y-up, origine au centre de la case ou du meuble, base minimale à `Y=0`.
- Toutes les géométries restent dans `X/Z ∈ [-0.475, +0.475]`. Les modules de terrain occupent au maximum `0.95 × 0.95` ; le mobilier est plus compact pour être placé librement dans une case.
- La façade d’eau canonique de `bank_straight` et `quay_straight` est du côté `+Z` dans le GLB (`-Y` dans Blender). Faire tourner autour de `Y` par multiples de 90° pour orienter ce raccord.
- `bank_corner_inner` présente l’eau sur les côtés `+Z` et `-X`, avec le terrain haut dans l’angle opposé.
- `bank_corner_outer` forme une pointe de terrain convexe vers `-X/+Z`, entourée par l’eau au nord-est.
- `ground_path` suit l’axe `Z`. Une rotation de 90° autour de `Y` le fait suivre `X`.
- Les bancs et lanternes sont centrés sur leur emprise propre ; leurs hauteurs restent inférieures à un niveau Living Layers de `0.48`, sauf la lanterne qui culmine à environ `0.73`.

## Matériaux et instanciation

La palette est partagée avec C2 : craie, ardoise et eau pour les berges ; graphite, laiton et brique pour les éléments bâtis ; prune, sauge et lin pour les jardins et le mobilier. Il n’y a ni texture externe ni variation aléatoire de teinte.

Chaque GLB est fusionné puis séparé par matériau à l’export. Cela limite le nombre de meshes et permet de regrouper efficacement les placements identiques avec `InstancedMesh`, sans imposer ce choix au moteur.

Le générateur contrôle réellement chaque fichier : GLB 2.0 autonome, empreinte et centrage, base `Y=0`, géométrie non vide, maximum 8 000 triangles, 20 meshes et 384 Kio par module.
