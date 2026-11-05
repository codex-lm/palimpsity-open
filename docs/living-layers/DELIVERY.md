# Living Layers — livraison du socle A–D et du lot 015

## Périmètre terminé

Cette passe consolide les chantiers **A, B et C**, les retours **NILO-001 à NILO-012**, les validations **D1, D2 et D3**, puis le lot **015 / retours028** sur les quais et les barges. Elle ajoute notamment :

- architecture par instance avec jusqu’à **quatre niveaux au total**, boutiques en rez-de-chaussée et effets économiques réels ;
- familles **Banks**, **Works**, **Gardens**, variantes géométriques et étages correspondants ;
- toits **traditionnel**, **jardin** et **productif**, sans toit intermédiaire emprisonné ;
- conversions **Maintenance workshop** et **Neighborhood hall**, historique et investissement suivi pour la démolition ;
- **Commons** civique autonome, sans empilement ni toit générique ;
- inspecteur bilingue avec avant/après complet, prévisualisation, confirmation atomique et focus bâtiment ;
- palette de familles, qualités **High / Balanced / Low**, effets réduits, visibilité des toits, mode photo et ambiances ;
- environnement enrichi avec **14 modules environment**, séparés des 45 modules Living Layers ;
- quais avec équipages, capacité partagée, import/export réel, inspecteur concordant et barges sur leurs chemins d’eau ;
- corrections de revue incluant le **LOD orthographique**, le cadrage mobile, la sélection des modules et le banc de mesure RAF.

Les preuves de revue sont notamment conservées dans les captures River mobile bilingues (`NILO-001`), Commons (`NILO-006`), familles mobiles (`NILO-010`) et projections orthographiques (`NILO-011`). Le retour `NILO-012` concerne l’attribution : le statut `review`, refusé par le parseur LOB7, est remplacé par `included`, accepté avec les trois crédits conservés. Les cinq tests du calcul RAF et la méthode D2 finale couvrent séparément les corrections du banc de mesure.

L’attribution est **included** : `LOB7-ATTRIBUTION.json` contient les contributions LOB7 Enhancement et la contribution Kimi Living Layers avec ce statut. Aucune attribution n’est déduite d’un nom de branche ou d’un ancien HEAD.

## Architecture et assets

Le moteur conserve `b.architecture` par instance sans mutation de `BUILDINGS`. Les transformations passent par `profileOf`, `transformationOptions`, `transformationBlockReason` et `transformBuilding` ; les conversions existantes utilisent `conversionOptions` et `convertBuilding`. Les offres contiennent des profils `before/after` complets et clonés.

Le manifeste référence **102 GLB embarqués** :

- **18 modèles legacy** ;
- **45 modules Living Layers** ;
- **14 modules environment** ;
- **4 assets dédiés aux quais, barges et cargaisons** ;
- les autres références existantes du diorama.

La hauteur d’un niveau est `0.48`. Le renderer assemble la base à `Y=0`, chaque étage à `Y=i×0.48`, puis un toit unique à `Y=floors×0.48`. Les bâtiments non modulaires conservent leur modèle legacy. Le LOD orthographique conserve une échelle apparente cohérente lors des changements de projection et du zoom.

Le [catalogue `game/art/LIVING_LAYERS.md`](../../game/art/LIVING_LAYERS.md) reste la référence pour les clés, ancrages, familles, matériaux et plafonds. Les `.blend` sont régénérables par les scripts Blender et ne constituent pas des sources indépendantes.

## Vérifications et preuves

| Contrôle | Résultat consigné | Preuve |
|---|---|---|
| Suite npm | **157/157 tests** | simulation, moteur, renderer, UI, localisation, assets, quais et River Pact |
| Calcul RAF | **5/5 tests**, comptés séparément des 157 | `test/d2-performance-calculation.mjs` |
| Recette navigateur | **5/5 scénarios PASS** | [`observed-results.md`](observed-results.md) et [`results.json`](results.json) |
| D1 — matrice étages/toits | **12 combinaisons PASS**, 1–4 niveaux × 3 toits | [`d1-roof-matrix-4k.md`](d1-roof-matrix-4k.md) |
| D2 — comparaison finale | baseline/courant sur **RTX 3080 D3D11**, 8 vues, 601 intervalles/vue | [`d2-performance-comparison.md`](d2-performance-comparison.md) |
| D3 — route naturelle automatisée | 600 €, charte Gardens, transformations et conversions par UI, victoire au tour 161 | [`d3-natural-results.json`](d3-natural-results.json) |
| 015 — route naturelle Makers | 600 €, quais t27, flux t28, capacité saturée t120, victoire t161 | [`015-natural-summary.md`](015-natural-summary.md) et [`015-natural-results.json`](015-natural-results.json) |
| Partie jouée par Nilo, agent, via les commandes du navigateur | victoire au tour 161, **distincte** de D3 automatisée et non présentée comme un essai humain | non comptée comme assertion automatique ni comme mesure supplémentaire de cette consolidation |

Les scènes élevée, mixte et dense de la recette préparent explicitement phase et ressources pour leurs fixtures. Elles ne remplacent pas les routes naturelles. D3 automatisée et la partie jouée par Nilo via les commandes du navigateur ne sont pas fusionnées en une seule preuve.

## Commandes

Depuis `game/` :

```sh
npm test                         # 157 tests, sans les 5 tests RAF séparés
npm run test:d2-calculation      # 5 tests du calcul RAF
npm run test:artifact            # correspondance source / standalone
npm run test:living-layers-browser
npm run test:d1                  # matrice des 12 combinaisons
npm run test:d2                  # comparaison baseline/courant
npm run test:d3                  # route naturelle automatisée
npm run test:015                 # route naturelle quais/barges et surcoût graphique
npm run assets:diorama           # régénération, BLENDER_EXE requis
npm run build                    # build HTML sans Blender
```

D1 et les recettes `test:first-house-4k` / `test:renderer-visual` utilisent le serveur de développement lorsqu’elles sont configurées avec leur URL par défaut. D2 charge directement les deux HTML autonomes. `LIVING_LAYERS_RENDERER=default` laisse Chrome choisir son renderer ; `swiftshader` reste une option explicite et distincte.

## Captures principales

| Sujet | Liens |
|---|---|
| Premier bâtiment, un puis quatre niveaux | [Un niveau](captures/first-house-1-level.png) · [Quatre niveaux](captures/first-house-general.png) · [Zoom](captures/first-house-zoom-max.png) |
| Prévisualisation architecturale | [Cartes](captures/architecture-preview-cards.png) · [Avant](captures/architecture-preview-before.png) · [Après](captures/architecture-preview-after.png) |
| Neuf maisons et familles | [Neuf maisons](captures/c1-nine-houses.png) · [Familles jour](captures/environment-families-day.png) · [Familles golden hour](captures/environment-families-golden.png) |
| Environnement et construction | [Avant](captures/environment-before-construction.png) · [Après](captures/environment-after-construction.png) · [Rapprochement golden hour](captures/environment-close-golden.png) |
| D1, toit productif au niveau 4 | [Général 4K](captures/d1-house-4-productive-general.png) · [Zoom 4K](captures/d1-house-4-productive-zoom.png) · [Prévisualisation](captures/d1-preview-traditional-after.png) |
| Deux conversions | [Maintenance workshop](captures/mixed-workshop-repair-close-inspector.png) · [Neighborhood hall](captures/mixed-warehouse-hall-close-inspector.png) |
| Mobile | [Ville 390 CSS px, PNG 780×1688](captures/mixed-390x844-high-general.png) · [Inspecteur](captures/mixed-390x844-high-close-inspector.png) · [Familles NILO-010](captures/nilo-010-mobile-family.png) |
| LOD orthographique | [Perspective équivalente](captures/nilo-011-perspective-equivalent.png) · [Perspective vers ortho](captures/nilo-011-perspective-close-to-ortho.png) · [Ortho vallée](captures/nilo-011-ortho-valley.png) · [Ortho zoom](captures/nilo-011-ortho-zoom.png) · [Ortho dézoom](captures/nilo-011-ortho-dezoom.png) |
| D3 automatisée | [Inspecteur](captures/d3-natural-inspector.png) · [Photo golden hour](captures/d3-natural-photo-golden.png) · [Victoire](captures/d3-natural-victory.png) |
| 015, route et transport fluvial | [Inspecteur t28](captures/015-natural-t28-inspector.png) · [FR mobile](captures/015-natural-mobile-fr.png) · [Saturation t120](captures/015-natural-t120-saturated.png) · [Victoire](captures/015-natural-victory.png) |
| 015, coût quais et barges | [Présents](captures/015-quays-barges-present.png) · [Absents](captures/015-quays-barges-absent.png) |
| D2 final, ville dense courante | [High](captures/d2/d2-current-dense-high.png) · [Low](captures/d2/d2-current-dense-low.png) |

Les preuves D2 initiales sont préservées dans [`d2-performance-initial.md`](d2-performance-initial.md), [`d2-performance-initial.json`](d2-performance-initial.json) et `captures/d2-initial/`.

## Performance finale D2 — RTX 3080

Méthode : un seul Chrome avec `LIVING_LAYERS_RENDERER=default`, baseline puis courant chargés séquentiellement, mêmes scènes/caméra/fixtures/qualité/résolution et même renderer effectif. Viewport 1920×1080 à DPR 2, simulation en pause. Après au moins 5 s d’échauffement réel, chaque fenêtre exige au moins 10 s et 20 intervalles RAF. Durée et FPS sont calculés depuis la même somme d’intervalles bruts, conservés dans [`d2-performance-results.json`](d2-performance-results.json).

Renderer commun relevé : **ANGLE / NVIDIA GeForce RTX 3080 / Direct3D11**. Chaque vue contient **601 intervalles RAF**.

| Scène | Qualité | FPS baseline / courant | Médiane baseline / courant | p95 baseline / courant | Delta p95 |
|---|---|---|---|---|---:|
| Petite ville | High | 60,00 / 60,00 | 16,70 / 16,70 ms | 16,80 / 16,80 ms | 0,000 % |
| Petite ville | Low | 60,00 / 60,00 | 16,70 / 16,70 ms | 16,80 / 16,80 ms | 0,000 % |
| Dense | High | 60,00 / 60,00 | 16,70 / 16,70 ms | 16,90 / 16,80 ms | **−0,592 %** |
| Dense | Low | 60,00 / 60,00 | 16,70 / 16,70 ms | 16,80 / 16,90 ms | **+0,595 %** |

Les deltas exacts vont de **−0,591716 % à +0,595238 %**. Les deux builds sont synchronisés autour de 60 FPS **sur ces scènes et dans ces conditions seulement**. Cela ne mesure pas une marge GPU disponible, ne garantit pas 60 FPS dans d’autres villes ou résolutions et ne constitue pas une validation matérielle générale.

### Anciens résultats SwiftShader

Les anciennes mesures SwiftShader sont des preuves de rendu logiciel distinctes, conservées dans [`observed-results.md`](observed-results.md) et les rapports D2 initiaux. Elles ne sont **pas mélangées** à la comparaison RTX 3080 et ne servent pas à estimer la performance matérielle.

## Route naturelle et surcoût graphique 015

La route démarre avec **600 €, zéro matériau, population et phase initiaux**, sans injection ultérieure. Les quais sont payés à **t27 en NW(2,5) et SW(4,6)**. À **t28**, le registre et les deux barges concordent : **4 food** de SW vers NW et **1,7496597908508473 water** de NW vers SW ; l’inspecteur affiche l’arrondi cohérent `1.7 water`. Le quai secondaire ne change ni capacité ni registre daté. Le focus partenaire et l’inspecteur FR mobile sont vérifiés.

À **t120**, la sécheresse réduit la capacité à **6**, saturée par **3,896157598306317 food + 2,103842401693683 water**. Trois puits de secours SW sont construits en `(0,10)`, `(1,10)` et `(2,10)`. Des achats réels de logements créent le déficit, puis une ferme et deux puits NW stabilisent la suite. La victoire arrive à **t161**, avec 155,51994 habitants, 3 157,04370 € et 67,45682 matériaux.

La mesure graphique est séparée de D2 et utilise le build 015 actuel. À t120, la même ville, caméra et qualité High est mesurée avec trois quais et deux barges, puis sans quai ni barge. Renderer Chrome `default` commun : **RTX 3080 D3D11**, viewport 1920×1080 à DPR 2 et buffer 3840×2160. Chaque vue dépasse 10 s et contient 601 intervalles RAF bruts.

| État | Durée | FPS | Médiane | p95 | Draw calls | Triangles |
|---|---:|---:|---:|---:|---:|---:|
| Quais et barges présents | 10,0163 s | 60,0022 | 16,70 ms | 16,90 ms | 1 295 | 319 908 |
| Quais et barges absents | 10,0164 s | 60,0016 | 16,70 ms | 16,90 ms | 1 256 | 310 526 |
| **Addition** | — | — | — | **0 ms / 0 %** | **+39** | **+9 382** |

Le delta p95 nul constate uniquement deux vues synchronisées à 60 FPS ; il ne démontre pas un coût GPU nul ni une marge disponible. Aucune optimisation n’a été ajoutée pour cette mesure.

## Artefact exact

Les derniers raccords intègrent le partenaire depuis un quai secondaire, des représentations stationnaires réduites et séparées dans leur case d’eau, le retrait des anciens fallbacks de test et les tests de volumes réels pour une à six barges.

- Fichier : `dist/palimpsity-mvp.html`
- Taille : **17 378 796 octets**
- SHA-256 : `e64d86ca4db435f693f26fbc90380b720032ba9700bc21a902e0ad5341979fb8`

L’identifiant du build mesuré est le couple taille/SHA-256 de l’artefact, pas un ancien HEAD. Cette variante source reste **non publiée** : `publicationFilesAreExplicitExport=false`.

## Limites et ajout de modules

- Pas de grandes emprises multi-cases, de passerelles ou de vue éclatée interactive dans ce socle.
- Les fixtures visuelles ne prouvent pas une progression naturelle ; D3 et les playthroughs Node conservent cette preuve séparément.
- La partie manuelle de Nilo n’est pas revendiquée comme automatisation.
- Les captures et un GPU ne remplacent pas d’autres navigateurs, GPU ou appareils tactiles physiques.
- Blender est nécessaire uniquement pour régénérer les assets, pas pour jouer ou reconstruire le HTML.

Pour ajouter un étage, un toit ou une famille, suivre la [procédure du catalogue](../../game/art/LIVING_LAYERS.md#ajouter-un-étage-un-toit-ou-une-famille) : conserver l’empreinte `0.95×0.95`, les bases à `Y=0`, les niveaux à `0.48`, enregistrer les clés dans le générateur et les contrôles Node, puis vérifier assemblage, picking et captures.
