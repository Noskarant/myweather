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
