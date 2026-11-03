import assert from 'node:assert/strict';
import { SNOW_RESORTS, lookupSnowResort, extractSnowDays } from './js/mountain-snow-chart.js';

assert.equal(SNOW_RESORTS.length,4);
for (const resort of SNOW_RESORTS) {
  assert.equal(resort.levels.length,3);
  assert.ok(resort.levels[0].altitude < resort.levels[1].altitude);
  assert.ok(resort.levels[1].altitude < resort.levels[2].altitude);
  assert.equal(lookupSnowResort({name:resort.name})?.key,resort.key);
}
assert.equal(lookupSnowResort({name:'Le Meiller, Valmorel'})?.key,'valmorel');
assert.equal(lookupSnowResort({name:'Planchamp'})?.levels[1].altitude,1920);
assert.equal(lookupSnowResort({name:'Oullins'}),null);

const dateStrings=Array.from({length:16},(_,i) => '2026-11-'+String(i+3).padStart(2,'0'));
const values=[0,1.5,null,12.38,-4,...Array(11).fill(0)];
const first=extractSnowDays({daily:{time:dateStrings,snowfall_sum:values}});
assert.equal(first.length,14);
assert.deepEqual(first.slice(0,5).map(x=>x.snow),[0,1.5,null,12.4,null]);
assert.equal(first[0].time,'2026-11-03');
const other=extractSnowDays({daily:[{time:'2026-11-03',snowfall:0},{time:'2026-11-04',snowfall:3.2}]});
assert.deepEqual(other.map(x=>x.snow),[0,3.2]);
assert.deepEqual(extractSnowDays({}),[]);
console.log('Mountain snow histogram tests passed.');
