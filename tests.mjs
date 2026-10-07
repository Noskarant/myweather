import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateSnowLevel, confidenceForHorizon, riskForPoint, weatherCodeInfo, weatherVisualProfile, haversineKm, nearestIndex } from './js/utils.js';
import { sampleRoute } from './js/route.js';
import { createDemoForecast, HOURLY_VARS, CURRENT_VARS, DAILY_VARS, estimateEffectiveSunshineSeconds, precipitationSignal, presentationWeatherCode } from './js/weather.js';

assert.ok(HOURLY_VARS.length >= 20);
assert.ok(CURRENT_VARS.includes('temperature_2m'));
assert.ok(DAILY_VARS.includes('temperature_2m_max'));
assert.ok(DAILY_VARS.includes('sunshine_duration'));
assert.ok(HOURLY_VARS.includes('freezing_level_height'));
assert.ok(HOURLY_VARS.includes('sunshine_duration'));


const clearHours = Array.from({length:10}, (_,i) => ({
  time:`2026-10-05T${String(i+9).padStart(2,'0')}:00`,
  sunshine_duration:3600, cloud_cover:0, cloud_cover_low:0, cloud_cover_mid:0, cloud_cover_high:0,
  precipitation:0, weather_code:0
}));
const clearDay = {time:'2026-10-05', sunrise:'2026-10-05T08:30', sunset:'2026-10-05T17:30', sunshineDuration:36000};
assert.equal(estimateEffectiveSunshineSeconds(clearDay, clearHours), 9*3600, 'Clear-day sunshine must be clipped to sunrise/sunset');

const overcastHours = clearHours.map(h => ({...h, cloud_cover:100, cloud_cover_low:100, weather_code:3}));
assert.equal(estimateEffectiveSunshineSeconds(clearDay, overcastHours), 0, 'Fully overcast day must not show many sunshine hours');

const rainyHours = clearHours.map(h => ({...h, cloud_cover:85, cloud_cover_low:80, precipitation:1.2, weather_code:63}));
assert.ok(estimateEffectiveSunshineSeconds(clearDay, rainyHours) < 3600, 'Rainy overcast day should show very little effective sunshine');

assert.equal(
  estimateEffectiveSunshineSeconds({time:'2026-10-05', sunrise:'2026-10-05T08:00', sunset:'2026-10-05T18:00', sunshineDuration:12*3600}, []),
  10*3600,
  'Fallback daily sunshine must never exceed astronomical daylight'
);

const localizedShower = {
  weather_code:80, precipitation:0.1, precipitation_probability:72, cloud_cover:35,
  localConsensus:{modelWetRatio:.25, spatialWetRatio:.2, localized:true}
};
assert.equal(precipitationSignal(localizedShower).robust, false);
assert.equal(presentationWeatherCode(localizedShower), 2, 'Localized weak shower should not look like continuous rain');

const widespreadRain = {
  weather_code:63, precipitation:1.2, precipitation_probability:85, cloud_cover:92,
  localConsensus:{modelWetRatio:.75, spatialWetRatio:.8}
};
assert.equal(precipitationSignal(widespreadRain).robust, true);
assert.equal(presentationWeatherCode(widespreadRain), 63, 'Widespread supported rain must remain rain');

const missingModelRatio = {
  weather_code:63, precipitation:1.1, precipitation_probability:85, cloud_cover:90,
  localConsensus:{modelWetRatio:null, spatialWetRatio:.8}
};
assert.equal(precipitationSignal(missingModelRatio).localized, false);
assert.equal(precipitationSignal(missingModelRatio).robust, true);

const standardForecastShower = {weather_code:80, precipitation:0.1, precipitation_probability:30, cloud_cover:35};
assert.equal(
  presentationWeatherCode(standardForecastShower),
  80,
  'Without island/local consensus, standard forecast presentation must stay unchanged'
);

const lpn = estimateSnowLevel({freezingLevel:1600, wetBulb:0, precipitation:2, elevation:900});
assert.ok(lpn >= 1100 && lpn <= 1400, `LPN plausible attendue, reçu ${lpn}`);
assert.equal(confidenceForHorizon(6), 94);
assert.ok(confidenceForHorizon(300) < confidenceForHorizon(24));
assert.equal(weatherCodeInfo(73).theme, 'snow');
assert.deepEqual(
  [weatherVisualProfile(61).intensity, weatherVisualProfile(63).intensity, weatherVisualProfile(65).intensity],
  ['light','moderate','heavy'],
  'Rain icon intensity must follow WMO rain codes'
);
assert.deepEqual(
  [weatherVisualProfile(71).intensity, weatherVisualProfile(73).intensity, weatherVisualProfile(75).intensity],
  ['light','moderate','heavy'],
  'Snow icon intensity must follow WMO snow codes'
);
assert.equal(weatherVisualProfile({weather_code:66,rain:.4}).kind, 'ice', 'Freezing rain must have a dedicated icon kind');
assert.equal(weatherVisualProfile({weather_code:96,precipitation:4,cape:900}).hail, true, 'Hail thunderstorm must expose hail');
assert.equal(weatherVisualProfile({weather_code:99,precipitation:8,cape:1600}).intensity, 'heavy', 'Violent hail thunderstorm must be visually heavy');
assert.equal(weatherVisualProfile({weather_code:95,precipitation:.8,cape:300}).intensity, 'light', 'Weak thunderstorm signal must stay visually light');
assert.equal(weatherVisualProfile({weather_code:95,precipitation:4,cape:900}).intensity, 'moderate', 'Moderate thunderstorm signal must be visually moderate');
assert.equal(weatherVisualProfile({weather_code:95,precipitation:8,cape:1600}).intensity, 'heavy', 'Strong thunderstorm signal must be visually heavy');
assert.equal(weatherVisualProfile({weather_code:61,rain:.5,snowfall:.2}).kind, 'mixed', 'Simultaneous rain and snow must use a mixed icon');
assert.ok(haversineKm({lat:45.75,lon:4.85},{lat:45.9,lon:6.1}) > 90);
assert.equal(nearestIndex(['2026-09-22T10:00','2026-09-22T11:00'], new Date('2026-09-22T10:40')), 1);

const risk = riskForPoint({temperature:-1, wetBulb:-1, precipitation:2, snowfall:1, gust:75, visibility:700, snowLevel:600, elevation:1000, cape:50});
assert.equal(risk.level, 'high');

const route = { geometry:{ coordinates:Array.from({length:101},(_,i)=>[4+i*0.01,45+i*0.005]) }, distance:120000, duration:7200 };
const samples = sampleRoute(route, 20);
assert.ok(samples.length >= 10 && samples.length <= 20);
assert.equal(samples[0].fraction, 0);
assert.ok(samples.at(-1).fraction > .95);

const demo = createDemoForecast();
assert.equal(demo.daily.length, 16);
assert.equal(demo.hourly.length, 384);
assert.ok(demo.hourly.some(h => h.snowfall > 0));
assert.ok(demo.hourly.every(h => 'snowLevel' in h));

console.log('✓ MyWeather unit tests passed');


// selector helper regression: collection selectors must use $$
const appSource = fs.readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
assert.equal(appSource.includes('$$$('), false, 'Unexpected $$$ helper in app.js');
for (const good of [
  "$$('[data-future-offset]').forEach",
  "$$('[data-bulletin-period]').forEach",
  "$$('.bottom-nav [data-nav]').forEach",
  "$$('#mapTabs [data-overlay]').forEach",
  "$$('[data-nav]').forEach"
]) {
  assert.equal(appSource.includes(good), true, 'Expected collection selector missing: ' + good);
}
console.log('✓ selector helper regression checks passed');
assert.equal(appSource.includes("precipitationSignal"), true, 'Microclimate precipitation helper import missing');
assert.equal(appSource.includes("Averses localisées possibles"), true, 'Microclimate wording missing');
assert.equal(appSource.includes("d.effectiveSunshineDuration ?? d.sunshineDuration"), true, 'Sunshine correction must remain active');
console.log('✓ microclimate + sunshine regression checks passed');

for (const required of [
  'weatherVisualProfile(data)',
  "kind==='mixed'",
  "kind==='ice'",
  'scene-hail',
  'scene-lightning-secondary',
  'container.dataset.sceneIntensity'
]) {
  assert.equal(appSource.includes(required), true, 'Intensity-aware hero scene logic missing: ' + required);
}
const stylesSceneSource = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
for (const required of [
  '.hero-scene.mixed .scene-rain,.hero-scene.mixed .scene-snow',
  '.hero-scene.ice .scene-rain,.hero-scene.ice .scene-hail',
  '.hero-scene.storm.hail .scene-hail',
  '@keyframes mwHailFall',
  '.hero-scene.intensity-3 .scene-rain'
]) {
  assert.equal(stylesSceneSource.includes(required), true, 'Intensity-aware hero scene CSS missing: ' + required);
}
console.log('✓ intensity-aware hero scene regression checks passed');

for (const required of [
  "const snowHaze=kind==='snow'&&intensity===3",
  "blizzardLevel=snowHaze",
  "scene-snow-haze",
  "--snow-drift-half",
  "--snow-haze-alpha"
]) {
  assert.equal(appSource.includes(required), true, 'Heavy snow/blizzard scene logic missing: ' + required);
}
for (const required of [
  '.hero-scene.snow-haze .scene-snow-haze',
  '.hero-scene.blizzard-1 .scene-horizon',
  '.hero-scene.blizzard-2 .scene-horizon',
  '@keyframes mwSnowHaze',
  'var(--snow-drift-half,0px)'
]) {
  assert.equal(stylesSceneSource.includes(required), true, 'Heavy snow/blizzard CSS missing: ' + required);
}
console.log('✓ heavy snow visibility + blizzard regression checks passed');

for (const required of [
  "const rainCurtain=(kind==='rain'||kind==='storm')&&intensity===3",
  "rainCurtainLevel=rainCurtain",
  "scene-rain-curtain",
  "--rain-curtain-alpha",
  "--rain-slant"
]) {
  assert.equal(appSource.includes(required), true, 'Torrential rain curtain logic missing: ' + required);
}
for (const required of [
  '.hero-scene.rain-curtain .scene-rain-curtain',
  '.hero-scene.rain-curtain-1 .scene-glow',
  '.hero-scene.rain-curtain-2 .scene-horizon',
  '@keyframes mwRainCurtain'
]) {
  assert.equal(stylesSceneSource.includes(required), true, 'Torrential rain curtain CSS missing: ' + required);
}
console.log('✓ torrential rain curtain regression checks passed');


// map picker regression checks
const indexSource = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
for (const required of ['id="mapPickerBtn"','id="locationPickerModal"','id="locationPickerMap"','id="locationPickerName"','id="locationPickerUse"']) {
  assert.equal(indexSource.includes(required), true, 'Map picker markup missing: ' + required);
}
for (const required of [
  "mapPickerBtn:$('#mapPickerBtn')",
  'function openLocationPicker()',
  'async function selectLocationPickerPoint',
  'async function useLocationPickerSelection',
  'reverseGeocodeApprox(lat, lon)',
  "type:'Point carte'"
]) {
  assert.equal(appSource.includes(required), true, 'Map picker logic missing: ' + required);
}
console.log('✓ map location picker regression checks passed');


// map picker search and map layers regression checks
for (const required of [
  'id="locationPickerSearchInput"',
  'id="locationPickerSearchResults"',
  'data-picker-layer="street"',
  'data-picker-layer="satellite"',
  'data-picker-layer="topo"'
]) {
  assert.equal(indexSource.includes(required), true, 'Map picker search/layer markup missing: ' + required);
}
for (const required of [
  'const searchLocationPicker = debounce',
  'geocode(query, 7)',
  'function setLocationPickerLayer(mode)',
  'World_Imagery/MapServer/tile',
  'World_Transportation/MapServer/tile',
  'World_Boundaries_and_Places/MapServer/tile',
  'tile.opentopomap.org',
  "localStorage.setItem('myweather:picker-layer'"
]) {
  assert.equal(appSource.includes(required), true, 'Map picker search/layer logic missing: ' + required);
}
console.log('✓ map search, satellite labels and topography regression checks passed');

// picker geolocation + PWA update regression checks
assert.equal(indexSource.includes('id="locationPickerLocate"'), true, 'Map picker self-location button missing');
for (const required of [
  'async function locateLocationPickerSelf()',
  'enableHighAccuracy:true',
  "locationPickerLocate:$('#locationPickerLocate')",
  "refs.locationPickerLocate?.addEventListener('click',locateLocationPickerSelf)",
  "navigator.serviceWorker.register('./sw.js?v=1.8.5', {updateViaCache:'none'})",
  "window.addEventListener('pageshow', checkForUpdate)",
  "document.visibilityState === 'visible'",
  "navigator.serviceWorker.addEventListener('controllerchange'"
]) assert.equal(appSource.includes(required), true, 'Geolocation/PWA update logic missing: ' + required);
const swSource = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.equal(swSource.includes("const CACHE = 'myweather-v1.8.5'"), true, 'PWA cache version not bumped');
assert.equal(swSource.includes("fetch(event.request, {cache:'no-store'})"), true, 'PWA fresh-network strategy missing');
assert.equal(swSource.includes("caches.match(event.request, {ignoreSearch:true})"), true, 'PWA offline query fallback missing');
console.log('✓ picker geolocation and PWA update regression checks passed');

const manifestSource = fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestSource);
assert.equal(manifest.display, 'fullscreen', 'Installed PWA must request fullscreen display');
assert.deepEqual(manifest.display_override, ['fullscreen','standalone'], 'Fullscreen must fall back to standalone');
assert.equal(indexSource.includes('maximum-scale=1,user-scalable=no'), true, 'Mobile page zoom must be disabled');
assert.equal(indexSource.includes('./styles.css?v=1.8.5'), true, 'Fullscreen CSS cache-bust missing');
assert.equal(indexSource.includes('./js/app.js?v=1.8.5'), true, 'Fullscreen app cache-bust missing');
assert.equal(appSource.includes('function preventDocumentZoom()'), false, 'Global touch interception must stay removed');
const stylesSource = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
assert.equal(stylesSource.includes('min-height:100dvh'), true, 'Dynamic viewport height hardening missing');
assert.equal(stylesSource.includes('env(safe-area-inset-top)'), true, 'Top safe-area handling missing');
assert.equal(stylesSource.includes('env(safe-area-inset-bottom)'), true, 'Bottom safe-area handling missing');
assert.equal(stylesSource.includes('touch-action:pan-x pan-y'), true, 'Document must allow one-finger panning while blocking page pinch zoom');
assert.equal(stylesSource.includes('.leaflet-container{\n  touch-action:none;'), true, 'Leaflet maps must keep custom touch gestures');
assert.equal(stylesSource.includes('overflow-y:auto'), true, 'Document vertical scrolling must be explicitly enabled');

for (const required of [
  "view.addEventListener('touchstart'",
  'dx > 85',
  'const availableDates = new Set',
  'date >= state.dayDetailDate',
  'hour % step === 0',
  'day-detail-date-divider'
]) assert.equal(appSource.includes(required), true, 'Continuous day-detail scrolling feature missing: ' + required);
for (const forbidden of [
  'data-day-shift=',
  'function shiftDayDetail(delta)',
  'id="dayWebcamLink"',
  'function updateDayWebcam(view)',
  'day-webcam-card'
]) assert.equal(appSource.includes(forbidden), false, 'Removed day navigation/webcam feature still present: ' + forbidden);
assert.equal(stylesSource.includes('.day-detail-date-divider'), true, 'Continuous-day separator styles missing');
assert.equal(stylesSource.includes('.day-date-nav'), false, 'Removed day navigation styles still present');
assert.equal(stylesSource.includes('.day-webcam-card'), false, 'Removed webcam styles still present');
assert.equal(stylesSource.includes('touch-action:pan-y'), true, 'Day-detail swipe touch policy missing');
for (const required of [
  'const items=f.hourly.slice',
  'hour-day-divider',
  'syncVisibleDayHeader',
  "view.addEventListener('scroll'",
  'dateLabel.textContent = formatDetailDate(visibleDate)'
]) assert.equal(appSource.includes(required), true, 'Multi-day hourly rail/sticky date feature missing: ' + required);
assert.equal(stylesSource.includes('.hour-day-divider'), true, 'Horizontal hourly day-divider styles missing');
assert.equal(stylesSource.includes('.day-detail-place small{\n  font-size:14px'), true, 'Larger sticky day/date text missing');
console.log('✓ multi-day horizontal hours and sticky visible date regression checks passed');

console.log('✓ continuous hourly day scrolling, webcam removal and swipe return regression checks passed');

console.log('✓ Android installed-PWA fullscreen regression checks passed');

