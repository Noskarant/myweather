import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateSnowLevel, confidenceForHorizon, riskForPoint, weatherCodeInfo, weatherVisualProfile, haversineKm, nearestIndex } from './js/utils.js';
import { sampleRoute } from './js/route.js';
import { inRhoneArea, eligibleRhoneStations, applyRhoneObservations } from './js/rhone-observations.js';
import { parseSenseBoxes, parseGrandLyon, parseMetars, collectRhoneObservations } from './scripts/update-rhone-observations.mjs';
import { parseMeteoFranceStationList, selectMeteoFranceStations, parseMeteoFranceObservation, collectMeteoFranceStations } from './scripts/meteo-france-observations.mjs';
import {parsePackageObservations, collectMeteoFrancePackage} from './scripts/meteo-france-package.mjs';
import { isFrance, applySnowFusion, ensembleSnowDaily } from './js/snowfusion.js';
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
  "navigator.serviceWorker.register('./sw.js?v=1.8.10', {updateViaCache:'none'})",
  "window.addEventListener('pageshow', checkForUpdate)",
  "document.visibilityState === 'visible'",
  "navigator.serviceWorker.addEventListener('controllerchange'"
]) assert.equal(appSource.includes(required), true, 'Geolocation/PWA update logic missing: ' + required);
const swSource = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.equal(swSource.includes("const CACHE = 'myweather-v1.8.10'"), true, 'PWA cache version not bumped');
assert.equal(swSource.includes("fetch(event.request, {cache:'no-store'})"), true, 'PWA fresh-network strategy missing');
assert.equal(swSource.includes("caches.match(event.request, {ignoreSearch:true})"), true, 'PWA offline query fallback missing');
console.log('✓ picker geolocation and PWA update regression checks passed');

const manifestSource = fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestSource);
assert.equal(manifest.display, 'fullscreen', 'Installed PWA must request fullscreen display');
assert.deepEqual(manifest.display_override, ['fullscreen','standalone'], 'Fullscreen must fall back to standalone');
assert.equal(indexSource.includes('maximum-scale=1,user-scalable=no'), true, 'Mobile page zoom must be disabled');
assert.equal(indexSource.includes('./styles.css?v=1.8.10'), true, 'Fullscreen CSS cache-bust missing');
assert.equal(indexSource.includes('./js/app.js?v=1.8.10'), true, 'Fullscreen app cache-bust missing');
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
  'syncVisibleDayHeader',
  "view.addEventListener('scroll'",
  'dateLabel.textContent = formatDetailDate(visibleDate)'
]) assert.equal(appSource.includes(required), true, 'Multi-day hourly rail/sticky date feature missing: ' + required);
assert.equal(appSource.includes('hour-day-divider'), false, 'Main hourly rail day dividers should be removed');
assert.equal(stylesSource.includes('.hour-day-divider'), false, 'Main hourly rail divider styles should be removed');
assert.equal(stylesSource.includes('.day-detail-place small{\n  font-size:14px'), true, 'Larger sticky day/date text missing');
console.log('✓ multi-day horizontal hours and sticky visible date regression checks passed');

console.log('✓ continuous hourly day scrolling, webcam removal and swipe return regression checks passed');

console.log('✓ Android installed-PWA fullscreen regression checks passed');



// SnowFusion science / consistency / fallback regressions.
assert.equal(isFrance({lat:45.714,lon:4.807}),true,'Oullins must be eligible');
assert.equal(isFrance({lat:45.4,lon:6.6}),true,'French Alps must be eligible');
assert.equal(isFrance({lat:40.4,lon:-3.7}),false,'Outside the France region, use provider forecast');
const makeSnowFixture=()=>{
  const times=Array.from({length:48},(_,i)=>'2026-01-03T'+String(i%24).padStart(2,'0')+':00')
    .map((t,i)=>i>=24?'2026-01-04'+t.slice(10):t);
  const h={
    time:times,temperature_2m:Array(48).fill(-1),precipitation:Array(48).fill(0),
    snowfall:Array(48).fill(0),rain:Array(48).fill(0),
    weather_code:Array(48).fill(3),snow_depth:Array(48).fill(.5),
    wind_speed_10m:Array(48).fill(3),cloud_cover:Array(48).fill(10),
    apparent_temperature:Array(48).fill(-2),wet_bulb_temperature_2m:Array(48).fill(-1),
    shortwave_radiation:Array(48).fill(0)
  };
  const model={
    time:times,
    temperature_2m_meteofrance_arome_france_hd:Array(48).fill(-2),
    temperature_2m_meteofrance_arome_france:Array(48).fill(-1.8),
    temperature_2m_icon_eu:Array(48).fill(-2.5),
    temperature_2m_ecmwf_ifs:Array(48).fill(-1),
    precipitation_meteofrance_arome_france_hd:Array(48).fill(.7),
    precipitation_icon_eu:Array(48).fill(.7),
    snowfall_meteofrance_arome_france_hd:Array(48).fill(.5),
    snowfall_icon_eu:Array(48).fill(.5),
    rain_meteofrance_arome_france_hd:Array(48).fill(0),
    rain_icon_eu:Array(48).fill(0)
  };
  const members={time:times};
  for(let m=0;m<20;m++)members['snowfall_member'+String(m).padStart(2,'0')]=
    Array.from({length:48},(_,i)=>i>=24 && i<28 && m<10? .5:0);
  const daily={time:['2026-01-03','2026-01-04'],
    sunrise:['2026-01-03T08:00','2026-01-04T08:00'],
    sunset:['2026-01-03T17:00','2026-01-04T17:00'],
    temperature_2m_max:[-1,-1],temperature_2m_min:[-1,-1],
    precipitation_sum:[0,0],snowfall_sum:[0,0],rain_sum:[0,0],weather_code:[3,3]};
  return {base:{hourly:h,daily,current:{time:times[0],temperature_2m:-1,apparent_temperature:-2,weather_code:3}},
    models:{hourly:model},ensemble:{hourly:members}};
};
const fixture=makeSnowFixture();
const untouched=structuredClone(fixture.base);
assert.equal(applySnowFusion(fixture.base,null,null),false,'Missing model feed must be a no-op');
assert.deepEqual(fixture.base,untouched,'A failed fusion must not damage provider data');
const terrain={valleyDepth:300,rugged:true,elevationRange:800};
assert.equal(applySnowFusion(fixture.base,fixture.models,fixture.ensemble,terrain),true);
assert.equal(fixture.base.snowFusion.active,true);
assert.ok(fixture.base.hourly.temperature_2m[0] < -1,'Multi-model/cold valley guidance must affect UI temperature');
assert.ok(fixture.base.hourly.snowfall[0] > 0,'Multi-model snow should replace fallback snow');
assert.ok(fixture.base.daily.snowfall_sum[0] > 0,'Daily snow accumulation must sum fused hourly snow');
assert.ok(fixture.base._snowFusionHourly[23].depth > 0,'Snowpack must use known baseline depth');
assert.ok(fixture.base.snowFusion.days['2026-01-03'].snowpack,'15-day table must have snowpack');
assert.equal(fixture.base.snowFusion.days['2026-01-04'].ensemble.probability,50);
assert.equal(fixture.base.snowFusion.days['2026-01-04'].ensemble.p1,50);
assert.equal(fixture.base.snowFusion.days['2026-01-04'].ensemble.p5,0);
assert.ok(fixture.base.current.temperature_2m < -1,'Current temperature must use the same fused hourly forecast');
const noDepth=makeSnowFixture();
noDepth.base.hourly.snow_depth=Array(48).fill(null);
assert.equal(applySnowFusion(noDepth.base,noDepth.models,noDepth.ensemble,null),true);
assert.equal(noDepth.base.snowFusion.days['2026-01-03'].snowpack,null,
  'Unknown starting depth must not be misrepresented as 0 cm');
const badEnsemble=ensembleSnowDaily({hourly:{time:['2026-01-03T00:00'],snowfall_member00:[5]}});
assert.deepEqual(badEnsemble,{},'Insufficient ensemble members must produce no probability');
const newApp=fs.readFileSync(new URL('./js/app.js',import.meta.url),'utf8');
const newIndex=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const newSw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
assert.ok(newApp.includes('renderSnowFusion();'),'The classic UI must render SnowFusion details');
assert.ok(newIndex.includes('id="snowFusionToggle"')&&newIndex.includes('id="snowFusionPanel"'));
const snowTopActions=newIndex.match(/<div class="current-top-actions">([\s\S]*?)<\/div>/)?.[1]||'';
assert.ok(snowTopActions.includes('id="snowFusionToggle"') &&
  snowTopActions.indexOf('id="snowFusionToggle"')<snowTopActions.indexOf('id="bulletinBtn"'),
  'SnowFusion icon must appear immediately before Bulletin in the top-right actions');
assert.ok(newIndex.includes('class="snowfusion-icon-button"') &&
  newIndex.includes('aria-controls="snowFusionPanel"'),
  'The snowflake must be a real, accessible button controlling the original panel');
assert.ok(!newIndex.includes('class="snowfusion-trigger"') &&
  !newIndex.includes('Neige · prévisions et manteau neigeux'),
  'Remove only the large snow trigger; keep the detailed snow panel');
const snowCss=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
assert.ok(snowCss.includes('minmax(235px,41%)!important') &&
  snowCss.includes('minmax(0,1fr) 136px!important') &&
  snowCss.includes('minmax(0,1fr) 275px!important'),
  'Future +2h/+3h/+4h/+6h panel should be slightly wider on desktop and mobile');
assert.ok(snowCss.includes('.snowfusion-icon-button{') &&
  !snowCss.includes('.snowfusion-trigger{'),
  'The new header snowflake should replace the obsolete full-width snow banner');
assert.ok(newSw.includes("'./js/snowfusion.js'"),'SnowFusion must work with PWA asset caching');
console.log('✓ SnowFusion fusion/fallback/ensemble/terrain/snowpack/UI tests passed');


// Rhône / Métropole of Lyon local temperature assimilation regressions.
const observationNow=Date.parse('2026-10-08T08:00:00Z');
const obsAt='2026-10-08T07:48:00Z';
const lyon={lat:45.714,lon:4.807,elevation:190};
const saintGenis={name:'Saint-Genis-Laval',source:'Grand Lyon / Météo-France',
  lat:45.6946666667,lon:4.7823333333,elevation:290,
  temperature:15,modelTemperature:13,measuredAt:obsAt};
const localSnapshot={version:1,stations:[saintGenis]};
assert.equal(inRhoneArea(lyon),true);
assert.equal(inRhoneArea({lat:46.8,lon:6.1}),false,'Rhône processing is geographic and limited');
assert.equal(eligibleRhoneStations(localSnapshot,lyon,observationNow).length,1);
assert.equal(eligibleRhoneStations(localSnapshot,lyon,observationNow+110*60*1000).length,0,'Old observations must be rejected');
assert.equal(eligibleRhoneStations({stations:[{...saintGenis,temperature:45,modelTemperature:12}]},lyon,observationNow).length,0,
  'Extreme sensor-model disagreement must be rejected');
const baseObs=()=>{
  const times=Array.from({length:6},(_,i)=>'2026-10-08T'+String(i+10).padStart(2,'0')+':00');
  return {utc_offset_seconds:7200,
    hourly:{time:times,temperature_2m:Array(6).fill(13),apparent_temperature:Array(6).fill(12),
      wet_bulb_temperature_2m:Array(6).fill(10),freezing_level_height:Array(6).fill(2400),
      snowfall:Array(6).fill(.5),precipitation:Array(6).fill(1)},
    current:{time:times[0],temperature_2m:13,apparent_temperature:12},
    daily:{time:['2026-10-08'],temperature_2m_max:[13],temperature_2m_min:[13],
      apparent_temperature_max:[12],apparent_temperature_min:[12],snowfall_sum:[3]}};
};
const corrected=baseObs();
const meta=applyRhoneObservations(corrected,lyon,localSnapshot,observationNow);
assert.ok(meta?.applied && !meta.direct,'A neighbouring station should correct the forecast, not impersonate a direct measurement');
assert.ok(corrected.current.temperature_2m>13,'Local Rhône station residual should correct current temperature');
assert.ok(corrected.hourly.temperature_2m[0]>13,'Correction must feed classic hourly forecast');
assert.ok(corrected.daily.temperature_2m_max[0]>13,'Daily display must share corrected hourly temperatures');
assert.equal(corrected.daily.snowfall_sum[0],3,'Temperature correction must not invent new snowfall amounts');
assert.ok(corrected.hourly.temperature_2m[5]-13<corrected.hourly.temperature_2m[0]-13,
  'Correction must decay with forecast horizon');
const directForecast=baseObs();
const directStation={...saintGenis,lat:lyon.lat,lon:lyon.lon,elevation:lyon.elevation};
assert.equal(applyRhoneObservations(directForecast,lyon,{stations:[directStation]},observationNow).direct,true);
assert.equal(directForecast.current.temperature_2m,15,'Co-located fresh station should report observed current temperature');
const stale=baseObs();
assert.equal(applyRhoneObservations(stale,lyon,localSnapshot,observationNow+110*60*1000),null);
assert.equal(stale.current.temperature_2m,13,'Stale snapshots must preserve Best Match/SnowFusion data');
const thirdParty=baseObs();
assert.equal(applyRhoneObservations(thirdParty,{lat:43.6,lon:1.4,elevation:140},localSnapshot,observationNow),null);
const sampleGrandLyon={results:[
  {identifiant:'69204002',date:obsAt,T:14.8},
  {identifiant:'69204002',date:'2020-01-01T00:00:00Z',T:0}]};
const grandlyonArray={
  fields:['identifiant','date','T'],
  values:[['69204002',obsAt,14.8],['69029001','2020-01-01T00:00:00Z',1]]
};
const measuredGrandLyon={
  fields:['identifiant','observation','horodate','measurement'],
  values:[
    {identifiant:'69204002',observation:'T',horodate:obsAt,measurement:13.8},
    {identifiant:'69029001',observation:'RR1',horodate:obsAt,measurement:5}
  ]
};
const recorded=parseGrandLyon(measuredGrandLyon,observationNow);
assert.equal(recorded.length,1,'Only observed temperature records should be used from Grand Lyon');
assert.equal(recorded[0].temperature,13.8);
assert.equal(parseGrandLyon(grandlyonArray,observationNow).length,1,
  'Grand Lyon timeseries column-array response must be supported');
const parsedOfficial=parseGrandLyon(sampleGrandLyon,observationNow);
assert.equal(parsedOfficial.length,1);
assert.equal(parsedOfficial[0].temperature,14.8);
const metars=parseMetars([
  {icaoId:'LFLL',temp:11,obsTime:Math.floor(Date.parse(obsAt)/1000)},
  {icaoId:'LFLY',temp:12,obsTime:'2020-01-01T00:00:00Z'},
  {icaoId:'XXXX',temp:18,obsTime:Math.floor(Date.parse(obsAt)/1000)}
],observationNow);
assert.equal(metars.length,1,'Recent official Lyon airport METAR should be accepted');
assert.equal(metars[0].source,'METAR aviation');
assert.equal(metars[0].temperature,11);
const sensed=parseSenseBoxes([{_id:'aaaaaaaaaaaaaaaaaaaaaaaa',name:'Station test Rhône',
  exposure:'outdoor',currentLocation:{coordinates:[4.807,45.714,185]},
  sensors:[{title:'Temperatur',unit:'°C',
    lastMeasurement:{createdAt:obsAt,value:'14.1'}}]}],observationNow);
assert.equal(sensed.length,1,'OpenSenseMap German-language temperature labels must be parsed');
assert.equal(sensed[0].temperature,14.1);
const appSourceObs=fs.readFileSync(new URL('./js/app.js',import.meta.url),'utf8');
const weatherSourceObs=fs.readFileSync(new URL('./js/weather.js',import.meta.url),'utf8');
const indexSourceObs=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const pagesSourceObs=fs.readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
const swSourceObs=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
assert.ok(weatherSourceObs.includes('applyRhoneObservations(data,location,observations)'));
assert.ok(indexSourceObs.includes('id="localObservationIndicator"') &&
  indexSourceObs.includes('id="localObservationInfo"') &&
  indexSourceObs.includes('id="localObservationTooltip"'),
  'Station indicator must be a focusable, labelled control in the top-right of Now card');
assert.ok(!indexSourceObs.includes('id="localObservationStatus"'),
  'The old permanent observation banner must be removed');
assert.ok(appSourceObs.includes('refs.localObservationIndicator.hidden=!active'),
  'The station icon must only appear for an actual applied correction');
assert.ok(appSourceObs.includes("refs.localObservationTooltip.textContent=explanation+source"),
  'Station methodology must remain available on demand');
assert.ok(appSourceObs.includes("refs.localObservationInfo?.addEventListener('click'"),
  'Mobile visitors must be able to tap the information icon');
assert.ok(!appSourceObs.includes('Température corrigée grâce aux stations'),
  'No permanent corrective message must remain');
const obsStyleSource=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
assert.ok(obsStyleSource.includes('.local-observation-indicator{') &&
  obsStyleSource.includes('.local-observation-indicator[hidden]') &&
  obsStyleSource.includes(':focus-within .local-observation-tooltip'),
  'Responsive/icon-only station info must support mouse and keyboard');
assert.ok(!obsStyleSource.includes('.local-observation-status'),
  'Remove the unused status banner CSS');
assert.ok(appSourceObs.includes('local.stationSource') && appSourceObs.includes('local.station'),
  'The on-demand tooltip should identify the nearest observed station and its provider');
assert.ok(pagesSourceObs.includes('schedule:')&&pagesSourceObs.includes('node scripts/update-rhone-observations.mjs'));
assert.ok(swSourceObs.includes("'./js/rhone-observations.js'"));
assert.ok(swSourceObs.includes("'./data/rhone-observations.json'"));
console.log('✓ Rhône station parsing, freshness, observation assimilation, hourly/daily UI and fail-safe tests passed');


// Official Météo-France DPObs v2 regression tests; no real credentials used.
const mfCsv='\ufeffId_station;Nom_usuel;Latitude;Longitude;Altitude\r\n'+
 '69204002;ST-GENIS-LAVAL;45.694667;4.782333;290\r\n'+
 '69029001;LYON-BRON;45.721333;4.949167;202\r\n'+
 '12345678;OUTSIDE RHONE;48.0;2.3;70\r\n';
const mfSites=parseMeteoFranceStationList(mfCsv);
assert.equal(mfSites.length,2,'Official station catalogue must filter to Rhône vicinity');
assert.equal(mfSites[0].id,'69204002','Station identifier must not be mangled');
assert.equal(selectMeteoFranceStations(mfSites)[0].id,'69204002',
 'Saint-Genis-Laval has priority among suitable official stations');
const mfExample={type:'FeatureCollection',features:[{
 type:'Feature',geometry:{type:'Point',coordinates:[4.782333,45.694667]},
 properties:{geo_id_insee:'69204002',validity_time:obsAt,t:284.15,u:82,ff:2,rr1:0}
}]};
const mfReading=parseMeteoFranceObservation(mfExample,mfSites[0],observationNow);
assert.equal(mfReading.temperature,11,'Observed Météo-France temperature is Kelvin, not Celsius');
assert.equal(mfReading.source,'Météo-France');
assert.equal(mfReading.humidity,82);
assert.equal(parseMeteoFranceObservation(mfExample,mfSites[0],observationNow+110*60000),null,
 'Official observations older than 100 minutes must not be assimilated');
assert.equal(parseMeteoFranceObservation({features:[{...mfExample.features[0],
 properties:{...mfExample.features[0].properties,t:11}}]},mfSites[0],observationNow),null,
 'Wrong temperature unit cannot be misinterpreted as Celsius');
assert.equal(parseMeteoFranceObservation({features:[{...mfExample.features[0],
 properties:{...mfExample.features[0].properties,geo_id_insee:'99999999'}}]},
 mfSites[0],observationNow),null,'The station id in the returned feature must match the request');
assert.equal((await collectMeteoFranceStations('',observationNow)).status,'not_configured',
 'Missing private GitHub Actions secret must not break the build');
let mockCalls=0;
const mockMF=async (url,options)=>{
  assert.equal(options.headers.apikey,'FAKE_TEST_KEY_NOT_A_SECRET');
  mockCalls++;
  const path=new URL(url).pathname;
  const body=path.endsWith('/liste-stations')?mfCsv:JSON.stringify(mfExample);
  return {ok:true,status:200,text:async()=>body};
};
const sample=await collectMeteoFranceStations('FAKE_TEST_KEY_NOT_A_SECRET',observationNow,mockMF);
assert.equal(sample.status,'ready');
assert.equal(sample.stations.length,1);
assert.equal(sample.stations[0].name,'ST-GENIS-LAVAL');
assert.ok(mockCalls>=2,'Station list and measurements must be retrieved');
assert.ok(!JSON.stringify(sample).includes('FAKE_TEST_KEY_NOT_A_SECRET'),
 'No credential may enter public station snapshot');
const workflowMF=fs.readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
const scriptMF=fs.readFileSync(new URL('./scripts/update-rhone-observations.mjs',import.meta.url),'utf8');
assert.ok(workflowMF.includes('METEOFRANCE_API_KEY:')&&workflowMF.includes('secrets.METEOFRANCE_API_KEY'),
 'Météo-France API key must be read from the private GitHub Actions secret');
assert.ok(scriptMF.includes('collectMeteoFranceStations(process.env.METEOFRANCE_API_KEY'));
assert.ok(!fs.readFileSync(new URL('./index.html',import.meta.url),'utf8').includes('METEOFRANCE_API_KEY'));
console.log('✓ Météo-France DPObs v2 parsing, Kelvin conversion, station selection and secret boundaries passed');


// Rhône department-wide authenticated observations must be safe and consistent.
const pkgAt1='2026-10-08T07:00:00Z';
const pkgAt2='2026-10-08T07:50:00Z';
const pkgFrame=[
  {geo_id_insee:'69204002',lat:45.694667,lon:4.782333,t:283.15,
    validity_time:pkgAt1,u:79},
  {geo_id_insee:'69204002',lat:45.694667,lon:4.782333,t:284.15,
    validity_time:pkgAt2,u:80,rr1:0.5},
  {geo_id_insee:'69029001',lat:45.721333,lon:4.949167,t:282.15,
    validity_time:pkgAt2},
  {geo_id_insee:'69204002',lat:45.694667,lon:4.782333,t:298.15,
    validity_time:'2020-01-01T00:00:00Z'},
  {geo_id_insee:'69204003',lat:45.694667,lon:4.782333,t:null,
    validity_time:pkgAt2},
  {geo_id_insee:'75106001',lat:48.84,lon:2.33,t:280,
    validity_time:pkgAt2}
];
const pkgParsed=parsePackageObservations(pkgFrame,observationNow,
  [{id:'mf-69204002',name:'Saint-Genis-Laval',lat:45.694667,lon:4.782333,elevation:290}]);
assert.equal(pkgParsed.length,2,'One fresh Rhône reading per official station; reject old/foreign/null records');
const pkgSaintGenis=pkgParsed.find(s=>s.id==='mf-69204002');
assert.equal(pkgSaintGenis.temperature,11,'Kelvin to Celsius must be accurate');
assert.equal(pkgSaintGenis.name,'Saint-Genis-Laval');
assert.equal(pkgSaintGenis.elevation,290);
assert.equal(pkgSaintGenis.measuredAt,new Date(pkgAt2).toISOString(),'Use the most recent valid hourly observation');
assert.equal(pkgSaintGenis.source,'Météo-France');
assert.equal(pkgSaintGenis.rainMm,0.5);
assert.deepEqual(parsePackageObservations(pkgFrame,observationNow+3*60*60000),[],
  'Expired package must not change temperature');
assert.equal((await collectMeteoFrancePackage('',observationNow)).status,
  'not_configured','Missing package secret must preserve existing station sources');
let packageCalls=0;
const mockPkg=async (url,options)=>{
  packageCalls++;
  assert.equal(options.headers.apikey,'FAKE_PACKAGE_KEY_NOT_A_SECRET');
  const actual=new URL(url);
  assert.equal(actual.pathname,'/public/DPPaquetObs/v2/paquet/horaire');
  assert.equal(actual.searchParams.get('id-departement'),'69');
  assert.equal(actual.searchParams.get('format'),'json');
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(pkgFrame)};
};
const pkgResult=await collectMeteoFrancePackage('FAKE_PACKAGE_KEY_NOT_A_SECRET',
  observationNow,mockPkg,mfSites);
assert.equal(pkgResult.status,'ready');
assert.equal(pkgResult.stations.length,2);
assert.equal(packageCalls,1,'One API request should collect the entire Rhône hourly package');
assert.ok(!JSON.stringify(pkgResult).includes('FAKE_PACKAGE_KEY_NOT_A_SECRET'),
  'No Package Observations key must reach the public snapshot');
const authFail=await collectMeteoFrancePackage('FAKE',observationNow,async()=>({
  ok:false,status:401,headers:{get:()=>null}
}));
assert.equal(authFail.status,'authentication_failed');
assert.equal(authFail.stations.length,0);
const emptyPkg=await collectMeteoFrancePackage('FAKE',observationNow,async()=>({
  ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(pkgFrame.slice(3))
}));
assert.equal(emptyPkg.status,'no_fresh_readings','Do not invent a station from empty or stale data');
const packageWorkflow=fs.readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
const packageCollector=fs.readFileSync(new URL('./scripts/update-rhone-observations.mjs',import.meta.url),'utf8');
assert.ok(packageWorkflow.includes('METEOFRANCE_PACKAGE_API_KEY:')&&
  packageWorkflow.includes('secrets.METEOFRANCE_PACKAGE_API_KEY'));
assert.ok(packageCollector.includes('process.env.METEOFRANCE_PACKAGE_API_KEY'));
assert.ok(packageCollector.includes('officialById.set(reading.id,reading)'),
  'Package and v2 observations must be deduplicated by station');
console.log('✓ DPPaquetObs v2 package/hourly: department 69, freshness, units, dedup, fallback, secret isolation passed');
