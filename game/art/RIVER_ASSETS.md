# River Assets — quai, barge et cargaisons

## Source et régénération

Les quatre modèles sont générés par `game/art/river/build_river_assets.py`, qui réutilise les primitives du kit Living Layers et des matériaux sans texture externe. Les GLB sont écrits directement dans `game/art/diorama/`.

Depuis `game/` :

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python art/river/build_river_assets.py
```

Ajouter `-- --skip-render` pour omettre `diorama/river-preview.png`. La commande complète `npm run assets:diorama` régénère les assets legacy, Living Layers, Environment puis River Assets. Elle contrôle **102 GLB référencés par le manifeste**, plus `terrain.glb` de présentation, soit **103 GLB** au total.

## Entrées du manifeste

`river_quay` est le 19e modèle principal, avec seulement les champs `file`, `footprint` et `height`. La barge et les cargaisons sont séparées dans `riverAssets` :

```json
{
  "models": {
    "river_quay": {
      "file": "river_quay.glb",
      "footprint": 0.95,
      "height": 0.671
    }
  },
  "riverAssets": {
    "barge": { "file": "river_barge.glb" },
    "cargoFood": { "file": "river_cargo_food.glb" },
    "cargoWater": { "file": "river_cargo_water.glb" }
  }
}
```

## Catalogue et ancrages

Tous les exports sont Y-up, centrés horizontalement et ont leur base minimale à `Y=0`.

| Fichier | Dimensions X/Y/Z | Convention |
|---|---|---|
| `river_quay.glb` | `0.900 / 0.671 / 0.930` | Eau au sud, côté `+Z` GLB (`-Y` Blender) |
| `river_barge.glb` | `0.784 / 0.267 / 0.448` | Avant et étrave pointue vers `+X` |
| `river_cargo_food.glb` | `0.394 / 0.298 / 0.289` | Trois caisses alimentaires empilées |
| `river_cargo_water.glb` | `0.337 / 0.211 / 0.325` | Trois tonneaux cerclés |

Le quai reste dans une emprise maximale de `0.95`. Sa terre et son abri sont au nord, tandis que le ponton avance vers le sud. Les pilotis commencent à `Y=0`, le platelage est à environ `0.19`, et le treuil surplombe l’eau sans dépasser la case.

La barge tient entièrement dans une case d’eau de `0.80 × 0.80`. Sa coque basse, ses lisses cuivre, ses planches, ses supports de cargaison et sa barre restent sous `Y=0.30`. Les cargaisons sont des modèles indépendants à poser sur le pont ou ailleurs, selon le contrat moteur.

## Détails et palette

- Quai : planches clouées, poutres, six pilotis, bitts, abri de chargement ouvert, toit à nervures, treuil avec tambour, manivelle, câble et crochet.
- Barge : coque à étrave, platelage, lisses, taquets et barre.
- Caisses : corps, lattes verticales, ceintures cuivre, couvercles et marques alimentaires ocre.
- Tonneaux : douves, trois cercles cuivre, couvercles et bonde.

| Matériau | Hexadécimal | Usage |
|---|---|---|
| Bois patiné | `#756F60` | Platelage, caisses et douves |
| Encre | `#35394A` | Coque, structure et ferrures |
| Ocre | `#D9A047` | Taquets, manivelle et marques |
| Cuivre oxydé | `#4F9DA6` | Lisses, cercles et toiture |

Chaque GLB est fusionné par matériau à l’export. Le générateur valide le format GLB 2.0, les dimensions et le centrage, la base `Y=0`, la hauteur basse de la barge et des cargaisons, ainsi que les budgets de 8 000 triangles, 16 meshes et 384 Kio par fichier.
