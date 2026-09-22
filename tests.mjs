import assert from 'node:assert/strict';
import { estimateSnowLevel, confidenceForHorizon, riskForPoint, weatherCodeInfo, haversineKm, nearestIndex } from './js/utils.js';
import { sampleRoute } from './js/route.js';
import { createDemoForecast, HOURLY_VARS, CURRENT_VARS, DAILY_VARS } from './js/weather.js';

assert.ok(HOURLY_VARS.length >= 20);
assert.ok(CURRENT_VARS.includes('temperature_2m'));
assert.ok(DAILY_VARS.includes('temperature_2m_max'));
assert.ok(HOURLY_VARS.includes('freezing_level_height'));

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
