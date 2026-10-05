import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateSnowLevel, confidenceForHorizon, riskForPoint, weatherCodeInfo, haversineKm, nearestIndex } from './js/utils.js';
import { sampleRoute } from './js/route.js';
import { createDemoForecast, HOURLY_VARS, CURRENT_VARS, DAILY_VARS, precipitationSignal, presentationWeatherCode } from './js/weather.js';

assert.ok(HOURLY_VARS.length >= 20);
assert.ok(CURRENT_VARS.includes('temperature_2m'));
assert.ok(DAILY_VARS.includes('temperature_2m_max'));
assert.ok(DAILY_VARS.includes('sunshine_duration'));
assert.ok(HOURLY_VARS.includes('freezing_level_height'));

const localizedShower = {weather_code:80, precipitation:0.1, precipitation_probability:72, cloud_cover:35, localConsensus:{modelWetRatio:.25, spatialWetRatio:.2, localized:true}};
assert.equal(precipitationSignal(localizedShower).robust, false);
assert.equal(presentationWeatherCode(localizedShower), 2);
const widespreadRain = {weather_code:63, precipitation:1.2, precipitation_probability:85, cloud_cover:92, localConsensus:{modelWetRatio:.75, spatialWetRatio:.8}};
assert.equal(precipitationSignal(widespreadRain).robust, true);
assert.equal(presentationWeatherCode(widespreadRain), 63);

const lpn = estimateSnowLevel({freezingLevel:1600, wetBulb:0, precipitation:2, elevation:900});
assert.ok(lpn >= 1100 && lpn <= 1400, `LPN plausible attendue, reçu ${lpn}`);
assert.equal(confidenceForHorizon(6), 94);
assert.ok(confidenceForHorizon(300) < confidenceForHorizon(24));
assert.equal(weatherCodeInfo(73).theme, 'snow');
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
  "navigator.serviceWorker.register('./sw.js?v=1.7.5', {updateViaCache:'none'})",
  "window.addEventListener('pageshow', checkForUpdate)",
  "document.visibilityState === 'visible'",
  "navigator.serviceWorker.addEventListener('controllerchange'"
]) assert.equal(appSource.includes(required), true, 'Geolocation/PWA update logic missing: ' + required);
const swSource = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.equal(swSource.includes("const CACHE = 'myweather-v1.7.5'"), true, 'PWA cache version not bumped');
assert.equal(swSource.includes("fetch(event.request, {cache:'no-store'})"), true, 'PWA fresh-network strategy missing');
assert.equal(swSource.includes("caches.match(event.request, {ignoreSearch:true})"), true, 'PWA offline query fallback missing');
console.log('✓ picker geolocation and PWA update regression checks passed');
