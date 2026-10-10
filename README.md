# MyWeather

Cockpit météo scientifique et visuel conçu pour fonctionner directement sur GitHub Pages, sans backend obligatoire.

## Fonctionnalités V1

- Prévisions jusqu'à 15 jours avec recherche mondiale de lieux.
- Favoris persistants dans le navigateur.
- Prévisions horaires cliquables avec température, ressenti, pluie, neige, probabilité, vent, rafales, humidité, pression, visibilité, couverture nuageuse, UV, CAPE, température humide, ISO 0 °C et LPN estimée.
- Cockpit météo avec mode expert.
- Module montagne/hiver avec profil altitude, ISO 0 °C et LPN estimée.
- Cartes interactives radar, précipitations, vent, satellite et orages/foudre via intégration Windy.
- Mode « Météo sur mon trajet » : départ, destination, date/heure, itinéraire OSRM, échantillonnage météo spatial et temporel, risque neige/verglas/vent/visibilité point par point.
- Design glassmorphism + cockpit météo, animations dépendantes de la météo et adaptation saisonnière.
- Responsive mobile et desktop.
- PWA légère avec service worker.
- Mode de démonstration automatique si l'API météo est temporairement indisponible.

## Sources de données

- Open-Meteo : prévisions, géocodage et variables scientifiques.
- OSRM : calcul d'itinéraire routier.
- Windy Embed : cartes météo interactives.
- OpenStreetMap : cartographie sous-jacente via les services intégrés.

## Île-de-France, Vendée et La Réunion : stations officielles locales

MyWeather exploite désormais les **deux clés Météo-France déjà présentes dans GitHub
Actions**, sans secret supplémentaire, pour les zones suivantes :

- **Île-de-France** : Paris (75), Seine-et-Marne (77), Yvelines (78),
  Essonne (91), Hauts-de-Seine (92), Seine-Saint-Denis (93),
  Val-de-Marne (94), Val-d'Oise (95).
- **Vendée (85)** : La Roche-sur-Yon, Les Sables-d'Olonne, Noirmoutier,
  Challans, Fontenay-le-Comte et communes voisines.
- **Île de La Réunion (974)** : Saint-Denis, Saint-Paul, Saint-Pierre,
  Saint-Benoît, Cilaos, Salazie, Plaine des Cafres et les Hauts.

À chaque déploiement, les données horaires des paquets départementaux
Météo-France DPPaquetObs v2 sont récupérées. Un seul catalogue DPObs v2 est
utilisé pour associer l'altitude réelle et les coordonnées aux stations.
L'API DPObs v2 peut servir de repli ciblé quand une région n'a pas de
données fraîches dans ses paquets. Les relevés de moins de **100 minutes**
sont comparés aux prévisions Open-Meteo **à la même altitude**, puis
leurs écarts corrigent modérément la température actuelle et
les prévisions de courte échéance (jusqu'à 30 heures, avec atténuation).

Sur La Réunion, les variations rapides d'altitude imposent une pondération
nettement plus stricte (maximum 18 km et forte pénalisation des dénivelés).
**Une station côtière ne doit pas servir de mesure directe pour un sommet.**
Les stations sans altitude officielle, les valeurs aberrantes et les
mesures trop anciennes sont exclues. Les cumuls de pluie/neige, le manteau
neigeux et SnowFusion ne sont pas directement recalculés à partir de ces
relevés de température.

Les fichiers de stations sont indépendants de ceux du Rhône,
de Savoie et de Québec : `data/ile-de-france-observations.json`,
`data/vendee-observations.json` et `data/reunion-observations.json`.
Une panne partielle laisse le modèle normal en place. Les compteurs
`Regional stations:` dans GitHub Actions indiquent les stations réellement
validées après chaque collecte. Les limites de quota et la couverture
géographique officielle sont vérifiées en production ; aucune amélioration
statistique de précision n'est garantie avant comparaison dans le temps.

## Québec City, Lévis, Beauport, Sainte-Foy et Stoneham : stations gratuites sans compte

MyWeather collecte en parallèle trois sources publiques **sans inscription ni clé** :

- **Environnement et Changement climatique Canada (SWOB / GeoMet OGC API)** :
  données d'observation de surface récentes, filtrées par emprise et heure.
  [Documentation GeoMet](https://api.weather.gc.ca/collections/swob-realtime?f=html).
- **Gouvernement du Québec (RSCQ)** : métadonnées du jeu « Données
  météorologiques horaires récentes », téléchargement du CSV horaire groupé
  et du catalogue des stations, lorsque les ressources sont publiquement
  disponibles via Données Québec. [Jeu de données](https://donneesquebec.ca/recherche/dataset/rscq-donnees-meteorologiques-horaires-recentes).
- **METAR aéronautiques** : observations de CYQB (Québec–Jean-Lesage)
  et aéroports voisins dans la zone. [AviationWeather](https://aviationweather.gov/data/api/).

Le collecteur produit `data/quebec-observations.json` séparément des fichiers
Rhône et Savoie. Il dédoublonne les stations, garde les relevés de moins de
100 minutes et vérifie la température contre la prévision Open-Meteo au
même endroit. La zone s'étend approximativement de 46,35 à 47,45° N,
et de 72,15 à 70,15° O (Québec, Lévis, Beauport, Charlesbourg,
Sainte-Foy, Stoneham, Île d'Orléans, Forêt-Montmorency).

Pour ces localités, les anomalies observées alimentent la température actuelle
et les **30 premières heures** de prévision, avec influence décroissante
en fonction de la distance, de l'altitude et de la fraîcheur. **Aucune donnée
observée ne modifie directement les quantités de neige, le manteau neigeux
ou les précipitations**. Si aucune station récente/fiable n'est disponible
ou si un service est indisponible, les prévisions de base sont conservées.

Les sources sont indépendantes. Le journal d'Actions indique les comptes
`Quebec stations:` et les états `swob / rscq / metar`, sans publier
d'informations d'authentification. La disponibilité effective des sources
et la précision des corrections ne sont pas garanties sans validation
comparative en conditions réelles. Les flux peuvent être interrompus,
et les déclenchements GitHub Actions restent best-effort.

## Extension Savoie (73) : stations officielles et microclimats alpins

MyWeather utilise aussi les **deux API Météo-France déjà configurées**, sans
nouvelle clé, pour la Savoie et les communes/lieux de montagne situés dans sa
zone géographique. La collecte programmée génère un second fichier
`data/savoie-observations.json` séparé du Rhône.

- **DPObs v2** sélectionne jusqu'à 32 stations de Savoie avec priorité aux
  stations proches et une répartition géographique. **Package Observations v2**
  récupère en plus les relevés horaires du département **73**.
- Le collecteur conserve, pour chaque station, l'observation la plus récente,
  sans la comptabiliser plusieurs fois, et vérifie sa fraîcheur (100 minutes
  maximum). Les températures officielles sont converties de kelvins en °C.
- Pour comparer une station située en altitude au modèle Open-Meteo, la
  température du modèle est demandée **à l'altitude de cette station**. Une
  observation n'est assimilée que si l'écart au modèle est plausible (≤7 °C).
- À Valmorel, Planchamp, dans la vallée de la Tarentaise, en Maurienne et
  autour de Chambéry/Aix-les-Bains, MyWeather corrige les **températures
  actuelles et de courte échéance** via des anomalies pondérées par distance,
  altitude et fraîcheur. La zone couvre une enveloppe géographique savoyarde
  et quelques marges ; ce n'est pas un découpage administratif exact.
- En montagne, la pondération est **plus restrictive** (distance maximale
  de 25 km, pénalisation renforcée du dénivelé, correction bornée à 2,5 °C).
  Un relevé de vallée ne devient jamais arbitrairement une observation à
  2 000 ou 3 000 m. Une mesure est dite directe seulement à moins de 350 m
  et avec une différence d'altitude inférieure à 30 m.
- Le panneau SnowFusion continue de fournir les cumuls de neige et le manteau
  neigeux. Les relevés de **température** ne recalculent pas artificiellement
  les chutes de neige ni la hauteur au sol.
- Aucune mesure récente, station trop éloignée, altitude incomparable, API
  indisponible ? La prévision météorologique antérieure est préservée.
- Le rafraîchissement du site est programmé toutes les 30 minutes via
  GitHub Actions / Pages, sans garantie d'exécution à la minute près.

Le compteur et les statuts Savoie apparaissent dans le journal GitHub Actions
sous `Savoie stations:`. Les corrections nécessitent des stations
effectivement reçues et validées ; aucune amélioration de précision n'est
revendiquée avant vérification sur un historique de mesures.


**Fraîcheur des relevés (Rhône et Savoie)** : seules des mesures prises depuis
moins de 100 minutes peuvent corriger le modèle, et le badge station n'apparaît
que si une correction a réellement été appliquée. GitHub Actions est une
planification *best effort* : certains déclenchements peuvent être retardés
ou supprimés par GitHub. Le workflow essaie désormais toutes les 15 minutes
aux minutes 07, 22, 37 et 52 (UTC), sans garantir un rafraîchissement
permanent. En cas de trou de collecte, la prévision de base est conservée.
Pour une régularité contractuelle, prévoir un ordonnanceur externe fiable
et une API serveur sécurisée : aucune clé Météo-France dans le navigateur.

## Météo-France Package Observations v2 — Rhône entier

L'API Package Observations fournit en une requête les dernières 24 heures de
mesures horaires des stations d'un département. MyWeather demande le paquet
`/public/DPPaquetObs/v2/paquet/horaire?id-departement=69&format=json`,
puis garde seulement les observations fraîches (maximum 100 minutes), dont
les températures en kelvins sont converties en degrés Celsius.

**Secret GitHub Actions distinct :** `METEOFRANCE_PACKAGE_API_KEY`.
Ajoute une API Key pour **Package Observations** dans Settings → Secrets and
variables → Actions → New repository secret. Ne pas utiliser le secret
`METEOFRANCE_API_KEY` réservé à **Données d'observation v2**,
ni publier aucun jeton dans le code, le site ou les journaux.

Les données Package et v2 sont fusionnées **sans doublonner les stations** :
on conserve la mesure la plus récente par identifiant. Les autres flux
(Grand Lyon, METAR, openSenseMap) restent disponibles. Sans clé Package,
avec une erreur réseau, un rejet d'authentification, ou un paquet vide/périmé,
l'application garde son comportement actuel grâce à l'API v2 existante.

Le diagnostic sans secret dans GitHub Actions présente
`Météo-France package API status` et les compteurs validés.
Le temps réel exact et le gain de précision ne sont pas garantis avant
un test de collecte authentifié.

Références : [documentation officielle](https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/pages/854851588/)
et [spécification des données d'observation](https://donneespubliques.meteofrance.fr/client/document/descriptiftechnique_observations_donneespubliques_v2_20250315_403.pdf).
## Connexion Météo-France DPObs v2 (observations officielles)

Le collecteur supporte **l'API Données d'observation v2** de Météo-France
pour les stations du Rhône et de ses abords, notamment Saint-Genis-Laval
(identifiant 69204002 si disponible dans le catalogue actif).

Configuration **obligatoire pour activer Météo-France** :
- Souscrire à l'API Données d'observation v2 sur le portail Météo-France.
- Dans GitHub : Settings → Secrets and variables → Actions → New repository secret.
- Nom : `METEOFRANCE_API_KEY`. Valeur : nouvelle API Key Météo-France. **Ne
  jamais placer la clé dans Git, dans un commit ou dans une variable publique.**
- Au déploiement suivant (ou via Actions → Deploy MyWeather to GitHub Pages
  → Run workflow), le collecteur s'authentifie côté GitHub Actions avec
  l'en-tête `apikey`, détecte les stations par catalogue et récupère leurs
  observations GeoJSON horaires ; il essaie aussi les données 6 minutes de
  Saint-Genis-Laval. Les températures officielles sont en **kelvins** et sont
  converties en °C pour MyWeather. Aucune clé n'est incluse dans le site publié.
- Jusqu'à 32 stations sont consultées à chaque exécution. Toutes les mesures
  doivent être fraîches (moins de 100 minutes) et passer le contrôle du modèle
  avant assimilation.
- Le diagnostic dans les logs du job montre le nombre de stations trouvées,
  échantillonnées et valides ; jamais le secret.
- Si le secret manque, l'API est indisponible, une station ne publie aucune
  température ou la mesure est périmée, les données existantes restent inchangées.

**Important :** une clé API envoyée dans une conversation doit être régénérée
avant utilisation de production. Les mesures ne sont pas une preuve de
meilleure précision des prévisions : cette amélioration doit être vérifiée.

## Observations locales du Rhône (météo générale)

Sans clé API : collecte des stations openSenseMap extérieures, des mesures
horaires ouvertes Grand Lyon / Météo-France et des observations aéronautiques
METAR de Lyon-Bron / Lyon Saint-Exupéry. Pendant le déploiement GitHub
Pages (planifié toutes les 30 minutes), un fichier JSON de mesures fraîches est créé.
Le moteur météo principal utilise ces mesures pour les villes et lieux du Rhône.

- Les stations âgées de plus de 100 minutes, les capteurs aberrants et
  les observations sans modèle co-localisé sont rejetées.
- Le moteur corrige les températures via les **anomalies station - modèle**
  pondérées par distance, différence d'altitude et fraîcheur.
- Pour une commune sans station, on interpole les anomalies voisines. Une
  station très proche et d'altitude comparable permet une mesure directe.
- Les corrections s'atténuent sous 30 heures. Les cumuls neige/pluie restent
  fournis par les modèles : on ne les déduit pas artificiellement des capteurs.
- Si les flux échouent ou ne fournissent aucune station fiable, MyWeather
  conserve les prévisions habituelles et n'invente pas de mesure.
- Les archives SYNOP ouvertes ne sont pas un flux temps réel utilisable ici ;
  l'API Météo-France temps réel exige un compte.

**Sources et licences :** Métropole de Lyon / Météo-France (Licence Ouverte 2.0),
openSenseMap (PDDL 1.0). La disponibilité réelle des flux et des déploiements
reste à vérifier, et les gains de précision doivent être évalués sur observations.
## SnowFusion France (moteur principal)

Sur les coordonnées de France métropolitaine et leurs abords alpins, le flux de prévisions principal tente
de fusionner les modèles AROME France HD / AROME France, ICON Europe, ECMWF IFS et ARPEGE Europe
via Open-Meteo. La pondération **heuristique** change selon la portée. Les données fusionnées
alimentent directement la vue actuelle (température), les heures, les prévisions quotidiennes
et le panneau accessible via « ❄️ Neige ». **Il ne s'agit pas d'un nouveau modèle de physique atmosphérique
ni d'une prévision validée comme meilleure que Météo-France ou ECMWF.**

- Les cumuls de neige (cm) quotidiens sont calculés à partir des heures fusionnées.
- Si disponible, un ensemble ECMWF indépendant fournit une fréquence des scénarios qui
  dépassent les seuils 0,1 / 1 / 5 / 10 / 20 cm (ce n'est pas une probabilité calibrée).
  Sans membres suffisants, les probabilités affichent « — ».
- La neige **au sol** utilise le niveau initial du modèle en mètres, puis une simulation
  simplifiée de tassement, d'ensoleillement, de températures, de pluie et de vent.
  La fraction « ancienne/tassée » n'est **pas** une mesure de dureté. Si le niveau initial est
  inconnu, le panneau n'invente pas une épaisseur initiale de zéro.
- Le relief est d'abord pris en compte dans les modèles haute résolution et l'altitude
  transmise à l'API. Un ajustement nocturne plafonné à 0,65 °C est possible dans des
  vallées détectées approximativement sur le terrain environnant, sous ciel clair et
  faible vent. La pente, l'orientation et l'ombrage réel ne sont **pas** résolus.
- Si les appels supplémentaires échouent, le flux Best Match original reste
  affiché. En dehors de la zone couverte, il demeure l'unique source.
- La météo sur trajet conserve son fonctionnement initial. Les probabilités et hauteurs
  de manteau neigeux ne constituent pas un bulletin local de risque d'avalanches.

**Avant toute diffusion commerciale** : vérifier les licences et quotas Open-Meteo
(multi-modèles et ensemble), prévoir une infrastructure autorisée pour le volume réel,
et évaluer la qualité sur des observations de stations météo/nivologiques.
L'affichage de pourcentages n'est pas une validation scientifique.

## Important

La LPN affichée est une estimation calculée à partir du niveau 0 °C, de la température humide et de l'intensité des précipitations. Elle ne doit pas être interprétée comme une altitude garantie au mètre près.

L'indice de confiance affiché dans la V1 est indicatif et dépend principalement de l'échéance de prévision. Il ne remplace pas une analyse d'ensemble probabiliste complète.

Les API publiques utilisées peuvent imposer des conditions d'usage spécifiques. Pour un produit commercial ou à fort trafic, vérifier les licences et basculer vers les offres commerciales/self-hosted appropriées.

## Développement local

Le projet est volontairement statique et n'a aucune dépendance npm obligatoire.

```bash
python3 -m http.server 4173
```

Puis ouvrir `http://localhost:4173`.

Tests :

```bash
npm test
npm run check
```

Pour forcer le mode démo hors ligne : `?offline=1`.

## GitHub Pages

Le workflow `.github/workflows/pages.yml` publie le contenu statique du dépôt sur GitHub Pages à chaque push sur `main`.
