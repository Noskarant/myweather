export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const round = (n, d = 0) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : null;
export const safe = (v, fallback = '—') => (v === null || v === undefined || Number.isNaN(v)) ? fallback : v;
export const pad = n => String(n).padStart(2, '0');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDay(dateStr, long = false) {
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat('fr-FR', long ? { weekday:'long', day:'numeric', month:'long' } : { weekday:'short', day:'numeric' }).format(d);
}

export function formatHour(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('fr-FR', { hour:'2-digit', minute:'2-digit' }).format(d).replace(':00','h');
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('fr-FR', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).format(d);
}

export function cardinal(deg) {
  if (!Number.isFinite(deg)) return '—';
  const dirs = ['N','NE','E','SE','S','SO','O','NO'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function seasonFor(lat, date = new Date()) {
  const m = date.getMonth() + 1;
  const north = lat >= 0;
  if (north) {
    if ([12,1,2].includes(m)) return 'winter';
    if ([3,4,5].includes(m)) return 'spring';
    if ([6,7,8].includes(m)) return 'summer';
    return 'autumn';
  }
  if ([12,1,2].includes(m)) return 'summer';
  if ([3,4,5].includes(m)) return 'autumn';
  if ([6,7,8].includes(m)) return 'winter';
  return 'spring';
}

export function estimateSnowLevel({ freezingLevel, wetBulb, precipitation = 0, elevation = 0 }) {
  if (!Number.isFinite(freezingLevel)) return null;
  const wb = Number.isFinite(wetBulb) ? wetBulb : 2;
  let depression = 240;
  if (wb <= 2) depression += (2 - wb) * 65;
  if (precipitation >= 1) depression += Math.min(130, precipitation * 25);
  const result = freezingLevel - clamp(depression, 180, 500);
  return Math.max(0, Math.round(result / 50) * 50);
}

export function confidenceForHorizon(hoursAhead) {
  if (hoursAhead <= 12) return 94;
  if (hoursAhead <= 24) return 91;
  if (hoursAhead <= 48) return 86;
  if (hoursAhead <= 72) return 81;
  if (hoursAhead <= 120) return 74;
  if (hoursAhead <= 168) return 67;
  if (hoursAhead <= 240) return 59;
  return 52;
}

export function weatherCodeInfo(code = 0, isDay = 1) {
  const day = isDay !== 0;
  const map = {
    0: ['Ciel dégagé', day ? '☀' : '☾', 'clear'],
    1: ['Globalement dégagé', day ? '🌤' : '☾', 'clear'],
    2: ['Partiellement nuageux', '⛅', 'cloudy'],
    3: ['Couvert', '☁', 'cloudy'],
    45: ['Brouillard', '≋', 'fog'], 48: ['Brouillard givrant', '≋', 'fog'],
    51: ['Bruine faible', '🌦', 'rain'], 53: ['Bruine', '🌦', 'rain'], 55: ['Bruine forte', '🌧', 'rain'],
    56: ['Bruine verglaçante', '🌧', 'ice'], 57: ['Bruine verglaçante forte', '🌧', 'ice'],
    61: ['Pluie faible', '🌧', 'rain'], 63: ['Pluie modérée', '🌧', 'rain'], 65: ['Pluie forte', '🌧', 'rain'],
    66: ['Pluie verglaçante', '🌧', 'ice'], 67: ['Pluie verglaçante forte', '🌧', 'ice'],
    71: ['Neige faible', '❄', 'snow'], 73: ['Neige modérée', '❄', 'snow'], 75: ['Neige forte', '❄', 'snow'], 77: ['Grains de neige', '❄', 'snow'],
    80: ['Averses faibles', '🌦', 'rain'], 81: ['Averses', '🌧', 'rain'], 82: ['Fortes averses', '🌧', 'rain'],
    85: ['Averses de neige', '🌨', 'snow'], 86: ['Fortes averses de neige', '🌨', 'snow'],
    95: ['Orage', '⚡', 'storm'], 96: ['Orage avec grêle', '⛈', 'storm'], 99: ['Orage violent avec grêle', '⛈', 'storm']
  };
  const [label, glyph, theme] = map[code] || ['Conditions variables', '☁', 'cloudy'];
  return { label, glyph, theme };
}

// Open-Meteo snowfall is in cm. Its liquid equivalent uses an approximate
// 0.7 cm/mm conversion; apply it only when a snow weather code and precipitation
// disagree with a zero or missing snowfall field.
export function snowfallFor(data = {}) {
  const reported = data.snowfall == null ? NaN : Number(data.snowfall);
  if (Number.isFinite(reported) && reported > 0) return {amount:reported, estimated:Boolean(data.snowfallEstimated)};
  const code = Number(data.weather_code ?? data.code);
  const precipitation = data.precipitation == null ? NaN : Number(data.precipitation);
  if ([71,73,75,77,85,86].includes(code) && Number.isFinite(precipitation) && precipitation > 0) {
    return {amount:precipitation * 0.7, estimated:true};
  }
  return {amount:Number.isFinite(reported) ? Math.max(reported, 0) : null, estimated:false};
}

export function isSnowForecast(data = {}) {
  return snowfallFor(data).amount > 0 || [71,73,75,77,85,86].includes(Number(data.weather_code ?? data.code));
}

export function precipitationLabel(data = {}) {
  return isSnowForecast(data) ? 'Neige' : 'Précipitations';
}

export function formatPrecipitation(data = {}, { rate = false, icon = false } = {}) {
  const snow = isSnowForecast(data);
  const snowfall = snowfallFor(data);
  const raw = snow ? snowfall.amount : data.precipitation;
  const amount = raw == null ? NaN : Number(raw);
  const value = Number.isFinite(amount) && amount >= 0 ? (amount > 0 && amount < 0.05 ? '<0,1' : String(round(amount, 1))) : '—';
  return `${icon ? (snow ? '❄ ' : '◌ ') : ''}${snow && snowfall.estimated ? '≈' : ''}${value} ${snow ? 'cm' : 'mm'}${rate ? '/h' : ''}`;
}

export function riskForPoint(p) {
  let score = 0;
  const reasons = [];
  const temp = Number(p.temperature ?? 99);
  const wet = Number(p.wetBulb ?? temp);
  const precip = Number(p.precipitation ?? 0);
  const snowfall = Number(p.snowfall ?? 0);
  const gust = Number(p.gust ?? 0);
  const vis = Number(p.visibility ?? 99999);
  const lpn = Number(p.snowLevel ?? 99999);
  const elevation = Number(p.elevation ?? 0);

  if (precip >= 0.2) { score += 1; reasons.push('chaussée humide'); }
  if (precip >= 2) { score += 1; reasons.push('précipitations soutenues'); }
  if (snowfall > 0 || (precip > 0 && (wet <= 1.2 || lpn <= elevation + 150))) { score += 2; reasons.push('neige possible'); }
  if (temp <= 1 && precip > 0) { score += 2; reasons.push('risque de gel/verglas'); }
  if (temp <= -1) { score += 1; reasons.push('température négative'); }
  if (gust >= 60) { score += gust >= 85 ? 2 : 1; reasons.push('fortes rafales'); }
  if (vis < 2000) { score += vis < 800 ? 2 : 1; reasons.push('visibilité réduite'); }
  if (Number(p.cape ?? 0) >= 700) { score += 1; reasons.push('convection'); }

  const level = score >= 6 ? 'high' : score >= 3 ? 'medium' : score >= 1 ? 'low' : 'minimal';
  return { score, level, reasons: [...new Set(reasons)] };
}

export function svgPath(values, width = 720, height = 150, padY = 14) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return { path:'', min:0, max:0, points:[] };
  let min = Math.min(...valid), max = Math.max(...valid);
  if (min === max) { min -= 1; max += 1; }
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = padY + (height - padY*2) * (1 - ((Number(v) - min) / (max - min)));
    return [x, y];
  });
  const path = points.map((p,i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return { path, min, max, points };
}

export function nearestIndex(times, target) {
  const t = target instanceof Date ? target.getTime() : new Date(target).getTime();
  let best = 0, diff = Infinity;
  times.forEach((x, i) => {
    const d = Math.abs(new Date(x).getTime() - t);
    if (d < diff) { diff = d; best = i; }
  });
  return best;
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m ? `${m} min` : ''}` : `${m} min`;
}

export function escapeHtml(str='') {
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
