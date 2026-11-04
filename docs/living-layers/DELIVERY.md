# Living Layers — livraison et preuves

## Fonctionnalités terminées

- Architecture propre à chaque bâtiment transformable, avec jusqu’à **quatre niveaux au total**, initialisée à la pose ou paresseusement pour les anciennes instances.
- Boutiques en rez-de-chaussée conservant les logements supérieurs, avec consommation, ventes, énergie et distribution réellement simulées.
- Trois familles constructives — **Banks**, **Works**, **Gardens** — et trois variantes résidentielles géométriques, avec étages correspondants.
- Toits **traditionnel**, **jardin** et **productif**, sans ancien toit emprisonné entre les niveaux ; effets économiques et environnementaux distincts.
- Deux conversions complètes : **Maintenance workshop** et **Neighborhood hall**, avec coûts, ancienneté minimale, historique et changement de rôle réel.
- **Commons**, bâtiment civique autonome à tour d’horloge, sans empilement ni toit générique.
- Inspecteur bilingue avec profils avant/après, confirmation atomique, historique et suivi de l’investissement pour le remboursement de démolition.
- **Focus building**, visibilité des toits, qualités **High / Balanced / Low**, **Reduced effects**, mode photo et quatre ambiances lumineuses.
- Interface anglaise par défaut et française à la demande, y compris offres, différences de profil et raisons de blocage.

## Architecture technique

Le moteur conserve `b.architecture` par instance et ne mute jamais le catalogue `BUILDINGS`. `profileOf`, `transformationOptions`, `transformationBlockReason` et `transformBuilding` constituent l’API commune ; les offres portent des profils effectifs `before/after` complets et clonés. Les conversions existantes restent distinctes via `conversionOptions` et `convertBuilding`.

Le manifeste `game/art/diorama/asset-manifest.json` référence **84 GLB** : les assets existants et **45 modules Living Layers**. Les 18 bâtiments legacy gardent leurs modèles ; Commons utilise le module civique autonome. La hauteur d’un niveau est `0.48`. Le renderer assemble la base à `Y=0`, les étages à `Y=i×0.48`, puis un toit à `Y=floors×0.48`. Les bâtiments non modulaires continuent d’utiliser leur modèle legacy.

Le kit procédural est décrit dans le [catalogue Living Layers](../../game/art/LIVING_LAYERS.md). Les 45 modules couvrent neuf bases de maisons, six ateliers, trois entrepôts, trois boutiques, neuf étages, six toits traditionnels, trois toits jardins, trois toits productifs, le civique et deux conversions.

## Commandes

Depuis `game/` :

```sh
npm test                            # 100 tests exécutés et réussis
npm run test:artifact               # correspondance source / standalone
npm run test:living-layers-browser # recette standalone complète et captures natives
npm run assets:diorama              # régénération, BLENDER_EXE requis
npm run build                       # reconstruction du standalone sans Blender
```

Avec `npm run dev` dans un autre terminal :

```sh
npm run test:first-house-4k         # ancrages, quatre niveaux, picking, focus et DPR 2
npm run test:renderer-visual        # Commons autonome et visibilité des toits
```

La recette `test:living-layers-browser` utilise directement `dist/palimpsity-mvp.html`, hors ligne, dans un profil Chrome temporaire. `CHROME_EXE` peut sélectionner le navigateur et `LIVING_LAYERS_FRAMES` le nombre d’intervalles mesurés, 30 par défaut. Les rapports bruts sont [`results.json`](results.json) et [`observed-results.md`](observed-results.md) ; le contrôle fournisseur détaillé est dans [`first-house-4k.md`](first-house-4k.md).

## Captures comparables

Les liens ouvrent les PNG natifs, sans redimensionnement documentaire.

| Sujet | Avant | Après / rapprochement |
|---|---|---|
| Maison Banks, un puis quatre niveaux, même cadrage DPR 2 | [Un niveau](captures/first-house-1-level.png) | [Quatre niveaux](captures/first-house-general.png) · [Zoom maximal](captures/first-house-zoom-max.png) |
| Ville surélevée, 1280×720, même cadrage général | [Avant](captures/elevated-before-general.png) | [Après](captures/elevated-after-general.png) · [Inspecteur trois niveaux](captures/elevated-after-close-inspector.png) |
| Ville mixte, 1280×720, même cadrage général | [Avant](captures/mixed-before-general.png) | [Après](captures/mixed-after-general.png) |
| Conversions | [Maintenance workshop](captures/mixed-workshop-repair-close-inspector.png) | [Neighborhood hall](captures/mixed-warehouse-hall-close-inspector.png) |
| Mobile, viewport CSS 390×844 à DPR 2 | [Vue générale 780×1688](captures/mixed-390x844-high-general.png) | [Inspecteur 780×1688](captures/mixed-390x844-high-close-inspector.png) |
| Ville dense, même viewport et cadrage | [High, buffer 3840×2160](captures/dense-1920x1080-high-general.png) | [Low, buffer 1920×1080](captures/dense-1920x1080-low-general.png) |
| Grand écran natif | [3840×2160 général](captures/mixed-3840x2160-general.png) | [3840×2160 rapproché](captures/mixed-3840x2160-close-inspector.png) |
| River Pact | [Choix Garden commons](captures/river-gardens-after-charter.png) · [Victoire](captures/river-gardens-success-dialog.png) | [Choix Makers quarter](captures/river-workshops-after-charter.png) · [Victoire](captures/river-workshops-success-dialog.png) |

L’inspection visuelle a porté sur les raccords de niveaux, l’absence de toits intermédiaires, les deux conversions, la netteté native, le mobile et la ville dense. Les captures `high/low` ont les mêmes dimensions de PNG ; seul le drawing buffer et la politique d’effets changent.

## Mesures effectivement observées

Conditions : Windows x64, AMD Ryzen 9 5950X, Node 24.22.1, Chrome 156 headless, profil isolé, simulation en pause, **SwiftShader**. Chaque échantillon contient 30 intervalles `requestAnimationFrame` après 15 frames de préchauffage. Ce sont des observations de rendu logiciel, pas des objectifs ni des mesures de GPU matériel.

| Vue | FPS | Frame moyen | p95 | Draw calls | Triangles | DPR écran / renderer | Drawing buffer | JS heap utilisé |
|---|---:|---:|---:|---:|---:|---|---|---:|
| Mixte 1280×720 | 3,85 | 259,99 ms | 266,70 ms | 905 | 185 424 | 1 / 1 | 1280×720 | 56 800 000 o |
| Mixte 1920×1080 High | 0,88 | 1131,64 ms | 1183,40 ms | 905 | 185 424 | 2 / 2 | 3840×2160 | 56 800 000 o |
| Mixte mobile 390×844 High | 4,27 | 234,44 ms | 250,00 ms | 914 | 186 580 | 2 / 2 | 780×1688 | 56 800 000 o |
| Mixte 3840×2160 | 0,89 | 1118,30 ms | 1150,00 ms | 905 | 185 424 | 1 / 1 | 3840×2160 | 56 800 000 o |
| Dense 1920×1080 High | 0,77 | 1296,07 ms | 1350,00 ms | 1 311 | 235 799 | 2 / 2 | 3840×2160 | 56 800 000 o |
| Dense 1920×1080 Low | 3,65 | 273,88 ms | 283,40 ms | 1 301 | 235 559 | 2 / 1 | 1920×1080 | 56 800 000 o |

Le standalone mesuré fait **16 445 352 octets** (**2 668 053 octets gzip**), SHA-256 `49fba91a84a7c44da980f0bc228c2c0e04e49ab84e2fc666aef5ff3b2e64f4f0`.

La recette navigateur finale passe les cinq scénarios : ville surélevée, ville mixte avec deux conversions et cycles caméra/inspection, ville dense `high/low`, puis les deux chartes River Pact. Les chartes conservent le budget naturel de 600 € et gagnent au tour 161. Aucune exception de page, erreur CDP ou requête externe n’a été observée.

## Limites honnêtes

- **SwiftShader ne valide pas 60 FPS ni 30 FPS sur GPU.** Les valeurs ci-dessus sont lentes par construction et ne préjugent pas des pilotes ou performances matérielles.
- Les scènes élevée, mixte et dense préparent explicitement phase 4 et ressources pour tester les contrats visuels ; elles ne démontrent pas une progression naturelle. Les routes River Pact et les playthroughs Node prouvent séparément la jouabilité à budget normal.
- Pas de grandes emprises multi-cases, de passerelles ou de vue éclatée interactive dans cette livraison.
- Les `.blend` sont régénérables par les scripts Blender ; ils ne constituent pas des sources indépendantes à éditer manuellement. Blender n’est nécessaire qu’à la régénération, pas au jeu ni au build HTML.
- Les tests statiques et les captures ne remplacent pas une inspection sur d’autres GPU, navigateurs ou appareils tactiles physiques.

## Ajouter un module ou une famille

Suivre la procédure du [catalogue `game/art/LIVING_LAYERS.md`](../../game/art/LIVING_LAYERS.md#ajouter-un-étage-un-toit-ou-une-famille) : conserver l’empreinte `0.95×0.95`, les bases à `Y=0`, les niveaux à `0.48`, ajouter les clés au générateur et aux contrôles Node, régénérer puis vérifier géométrie, picking, assemblage et captures. Le catalogue reste la référence pour les clés, matériaux, exceptions civiques et plafonds de complexité.
