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
