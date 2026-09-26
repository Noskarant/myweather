import { geocode, getBatchForecast } from './weather.js';
import { estimateSnowLevel, haversineKm, nearestIndex, riskForPoint } from './utils.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

export async function resolvePlace(query, nearby = null) {
  const results = await geocode(query, 12);
  if (!results.length) throw new Error(`Lieu introuvable : ${query}`);
  if (!nearby) return results[0];
  // An unqualified destination usually refers to a place near the departure.
  // Preserve explicit country/region queries, which the geocoder already filters.
  const sameCountry = results.filter(place => place.countryCode && place.countryCode === nearby.countryCode);
  const candidates = sameCountry.length ? sameCountry : results;
  return candidates.reduce((best, place) =>
    haversineKm(nearby, place) < haversineKm(nearby, best) ? place : best
  );
}

export async function fetchRoute(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=false&annotations=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Calcul d’itinéraire indisponible (${r.status})`);
  const data = await r.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('Aucun itinéraire routier trouvé.');
  return data.routes[0];
}

function cumulativeRoute(coords) {
  let total = 0;
  const arr = coords.map((c,i) => {
    if (i) total += haversineKm({lat:coords[i-1][1],lon:coords[i-1][0]}, {lat:c[1],lon:c[0]});
    return {lon:c[0],lat:c[1],cumKm:total};
  });
  return { arr, total };
}

export function sampleRoute(route, maxPoints = 24) {
  const coords = route.geometry.coordinates;
  const { arr, total } = cumulativeRoute(coords);
  const wanted = Math.max(10, Math.min(maxPoints, Math.ceil(total / 10) + 1));
  const samples = [];
  for (let i=0;i<wanted;i++) {
    const target = total * (i/(wanted-1));
    let best = arr[0];
    for (const p of arr) {
      if (Math.abs(p.cumKm-target) < Math.abs(best.cumKm-target)) best = p;
    }
    if (!samples.length || samples[samples.length-1].cumKm !== best.cumKm) samples.push({...best, fraction: total ? best.cumKm/total : 0});
  }
  return samples;
}

export async function analyzeRoute(fromQuery, toQuery, departureDate) {
  const from = await resolvePlace(fromQuery);
  const to = await resolvePlace(toQuery, from);
  const route = await fetchRoute(from, to);
  const points = sampleRoute(route);
  const weather = await getBatchForecast(points, Math.max(2, Math.min(16, Math.ceil((departureDate.getTime()-Date.now())/86400000)+2)));
  const analyzed = weather.map((w,i) => {
    const point = points[i];
    const eta = new Date(departureDate.getTime() + route.duration*1000*point.fraction);
    const idx = nearestIndex(w.hourly.time, eta);
    const h = w.hourly;
    const p = {
      ...point, eta, elevation:w.elevation ?? 0,
      temperature:h.temperature_2m?.[idx], apparent:h.apparent_temperature?.[idx],
      precipitation:h.precipitation?.[idx], precipProb:h.precipitation_probability?.[idx], snowfall:h.snowfall?.[idx],
      code:h.weather_code?.[idx], visibility:h.visibility?.[idx], wind:h.wind_speed_10m?.[idx], windDir:h.wind_direction_10m?.[idx],
      gust:h.wind_gusts_10m?.[idx], wetBulb:h.wet_bulb_temperature_2m?.[idx], freezingLevel:h.freezing_level_height?.[idx], cape:h.cape?.[idx]
    };
    p.snowLevel = estimateSnowLevel({freezingLevel:p.freezingLevel, wetBulb:p.wetBulb, precipitation:p.precipitation, elevation:p.elevation});
    p.risk = riskForPoint(p);
    return p;
  });
  return { from, to, route, points:analyzed, departureDate };
}
