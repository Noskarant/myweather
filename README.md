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
