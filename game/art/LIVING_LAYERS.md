# Living Layers — kit architectural modulaire

## Source et régénération

Le kit est entièrement procédural. Sa source est `game/art/living-layers/build_living_layers.py`; les 45 GLB sont écrits dans `game/art/diorama/layers/`. Le manifeste commun `game/art/diorama/asset-manifest.json` contient leurs chemins dans `layers.modules`.

Depuis `game/`, avec Blender 4.5 ou une version compatible :

```sh
BLENDER_EXE=/chemin/absolu/vers/blender npm run assets:diorama
```

La commande régénère successivement le diorama existant, Living Layers, les 14 modules Environment et les quatre River Assets sans leurs rendus de présentation. Elle contrôle les **102 GLB référencés par le manifeste**, plus `terrain.glb` de présentation, soit **103 GLB contrôlés** au total. Pour ne régénérer que ce kit et obtenir le rendu de contrôle des neuf maisons assemblées :

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python art/living-layers/build_living_layers.py
```

Ajouter `-- --skip-render` pour omettre `diorama/layers-preview.png`. Aucun paquet Python ou Node supplémentaire n’est requis. Le script conserve les modèles legacy et ne remplace que les fichiers de `layers/` ainsi que la section `layers` du manifeste.

## Convention d’assemblage

- Unités du diorama, export glTF Y-up. Dans Blender, X/Y sont horizontaux et Z est vertical ; dans les GLB, X/Z sont horizontaux et Y est vertical.
- Origine de chaque module au centre de la parcelle. La façade principale regarde vers `+Z` dans les GLB (`-Y` dans Blender).
- Empreinte maximale, accessoires compris : `0.95 × 0.95`. Les auvents, galeries, jardinières, gouttières et réservoirs restent dans cette limite.
- Tous les `base_house_*`, `base_workshop_*`, `base_warehouse_*`, `base_shop_*`, `floor_*` et `conversion_*` ont leur base locale à `Y=0` et leur sommet exactement à `Y=0.48`.
- Seuls les modules de rez-de-chaussée possèdent un socle. Un `floor_*` commence directement à `Y=0`, sans fondation ni marche sous son ancrage.
- Le sommet des niveaux est un platelage plat. Aucun toit n’est inclus dans une base ou un étage générique : une surélévation ne laisse donc pas d’ancien toit enfermé.
- Tous les `roof_*` ont leur base locale à `Y=0`. Leur hauteur varie selon la silhouette.

Pour un bâtiment de `floors` niveaux :

1. Poser la base à `(0, 0, 0)`.
2. Poser `floors - 1` modules `floor_*`, le niveau d’index `i` à `Y = i × 0.48`, avec `i` de `1` à `floors - 1`.
3. Poser un toit à `Y = floors × 0.48`.
4. Utiliser la même famille et, pour les clés qui en comportent une, la même variante afin de conserver les alignements de façade.

Exemple pour trois niveaux : base à `0`, premier étage à `0.48`, deuxième étage à `0.96`, toit à `1.44`.

### Exception civique

`base_civic` est un ensemble complet autonome, avec socle, hall, portique, tour d’horloge et toit. Son ancrage est `(0, 0, 0)`, sa base reste à `Y=0` et sa hauteur propre est `1.08`. Il ne respecte pas volontairement la hauteur de `0.48` et ne doit pas recevoir automatiquement un étage ou un toit générique.

## Catalogue — 45 modules

| Groupe | Clés | Nombre | Contenu |
|---|---|---:|---|
| Habitations RDC | `base_house_{banks\|works\|gardens}_{0\|1\|2}` | 9 | Neuf géométries de façade et trois systèmes constructifs |
| Ateliers RDC | `base_workshop_{banks\|works\|gardens}_{0\|1}` | 6 | Portes d’atelier, éclairage de travail, auvent ou palan |
| Entrepôts RDC | `base_warehouse_{banks\|works\|gardens}` | 3 | Deux quais, portes segmentées, claire-voie |
| Commerces RDC | `base_shop_{banks\|works\|gardens}` | 3 | Vitrine divisée, enseigne, auvent rayé |
| Civique | `base_civic` | 1 | Hall complet et tour d’horloge, hauteur propre |
| Étages | `floor_{banks\|works\|gardens}_{0\|1\|2}` | 9 | Reprise des neuf façades sans socle |
| Toits traditionnels | `roof_traditional_{banks\|works\|gardens}_{0\|1}` | 6 | Ardoise, croupe, dents de scie, verrière, tuiles, pavillon |
| Toits jardins | `roof_garden_{banks\|works\|gardens}` | 3 | Cultures sur plots, citerne, local technique ou pergola |
| Toits productifs | `roof_productive_{banks\|works\|gardens}` | 3 | Solaire/eau, solaire/ventilation ou serre |
| Conversions | `conversion_workshop_repair`, `conversion_warehouse_hall` | 2 | RDC complets de `0.48`, atelier de réparation et hall public |

### Silhouettes résidentielles

Les trois variantes ne sont pas de simples changements de couleur :

- **Variante 0** : volume large, galerie et travées symétriques. Banks ajoute une galerie bois et une chaîne d’eau, Works des poteaux rivetés, Gardens un espalier et des herbes.
- **Variante 1** : volume plus étroit et profond, baie réellement en saillie. Banks ajoute balcon et balustres, Works un auvent acier, Gardens une jardinière fleurie.
- **Variante 2** : volume large et peu profond, entrée décalée, fenêtres inégales, cordon horizontal et pilastres ou treillis selon la famille.

Chaque variante possède un étage correspondant et deux choix de toit traditionnel par famille, ce qui donne au moins six silhouettes assemblées nettement distinctes avant même de changer le nombre de niveaux.

### Familles

- **Banks** : craie `#DFE5E2`, ardoise `#465F78`, eau `#4F9DA6`, pans de bois, galeries, volets et récupération d’eau.
- **Works** : brique `#A4523E`, graphite `#35394A`, laiton `#D9A047`, acier, grandes baies, dents de scie et verrières.
- **Gardens** : prune `#806484`, sauge `#82A48B`, lin `#E0D8C6`, terrasses, treillis, jardinières et serres.

## Dix-huit motifs de décor intégrés

1. Socles et joints de pierre.
2. Fenêtres à petits bois, appuis et volets.
3. Galeries, balcons, poteaux et balustres.
4. Couvertures ardoise à nervures et faitières.
5. Gouttières, descentes, barils et citernes.
6. Chaînages de brique, mortier et linteaux.
7. Poteaux acier et rivets.
8. Dents de scie et verrières de toiture.
9. Portes de quai, palans et outils de réparation.
10. Auvents rayés et enseignes commerciales.
11. Jardinières et cultures sur toiture.
12. Treillis et vignes.
13. Serres, chevrons et faîtages.
14. Panneaux solaires avec bus et rangées de cellules.
15. Réserves d’eau et irrigation.
16. Portique et horloge civique.
17. Ventilations, volutes et capots techniques.
18. Pergolas, lockers et claires-voies de hall.

## Palette et budget

Les matériaux sont créés une fois puis réutilisés dans toutes les collections. À l’export, chaque module est fusionné puis séparé par matériau, sans texture externe.

| Teinte | Hexadécimal | Usage principal |
|---|---|---|
| Craie | `#DFE5E2` | Enduits Banks et pierre claire |
| Ardoise | `#465F78` | Toitures Banks |
| Eau | `#4F9DA6` | Volets, récupération et plans d’eau |
| Brique | `#A4523E` | Maçonnerie Works et jardinières |
| Graphite | `#35394A` | Structure, acier et menuiseries |
| Laiton | `#D9A047` | Enseignes et détails Works |
| Prune | `#806484` | Terrasses, toitures et menuiseries Gardens |
| Sauge | `#82A48B` | Végétation, treillis et serres |
| Lin | `#E0D8C6` | Enduits Gardens, mortier et pierre |
| Verre | `#A7C4D2` | Baies et verrières |

Le générateur refuse tout module de plus de 12 000 triangles, 20 meshes ou 512 Kio. Les sorties actuelles sont bien en dessous de ces plafonds. La validation lit réellement chaque GLB, parcourt ses transformations de nœuds et contrôle les limites XYZ, la base `Y=0`, le sommet `Y=0.48` des niveaux et l’absence de ressources externes.

## Ajouter un étage, un toit ou une famille

### Étage

1. Ajouter une fonction de construction ou une variante dans `build_house()` pour une base compatible, avec `ground=False`.
2. Conserver le corps entre `Z=0` et `Z=0.455`, puis appeler `floor_deck()` pour obtenir un sommet à `0.48`.
3. Ne créer ni socle ni toit. Garder chaque accessoire dans la parcelle et au-dessus de `Z=0`.
4. Ajouter la clé à `module_keys()` et à la liste de contrôle `layerKeys` de `game/build-diorama-assets.mjs`.
5. Régénérer et vérifier l’assemblage au-dessus de la base prévue.

### Toit

1. Créer une fonction `build_*_roof()` avec la partie la plus basse à `Z=0`.
2. Utiliser `gable_roof()`, `hip_roof()`, `roof_deck()`, `solar_panel()` ou une géométrie dédiée.
3. Ne pas inclure de niveau habitable sous le toit. Vérifier que son empreinte couvre la base sans dépasser `0.95`.
4. Ajouter la clé aux deux listes de contrôle et tester chaque hauteur d’assemblage pertinente.

### Famille

1. Ajouter son identifiant à `FAMILIES`, sa combinaison de matériaux à `family_style()` et ses détails aux constructeurs.
2. Réutiliser les matériaux de `MAT` ou ajouter les teintes nécessaires dans `make_palette()`.
3. Fournir toutes les bases, tous les étages et tous les toits attendus pour la famille, pas seulement une variante résidentielle.
4. Mettre à jour les listes de clés Node et ce catalogue, régénérer, puis inspecter le rendu et les contrôles de raccords.
