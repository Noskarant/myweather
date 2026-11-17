import assert from 'node:assert/strict';
import { CNE_ZONES,cneGrid,cneFinite,cneAt,cneValue,cneInterpolate,cneNearest,cneSnowline,cneColor } from './js/cne3d-model.js';
import { cneChartPoints } from './js/cne3d-timeline.js';

const area=CNE_ZONES.lyonnais;
assert.equal(cneGrid(area.bounds).length,25);
assert.equal(cneGrid(area.bounds)[0].lon,area.bounds[0][0]);
assert.equal(cneGrid(area.bounds).at(-1).lat,area.bounds[0][1]);
assert.ok(area.points.some(p=>p.name==='Saint-Martin-en-Haut'));
assert.ok(CNE_ZONES.valmorel.points.some(p=>p.name==='Le Meiller'));
assert.ok(CNE_ZONES.pilat.points.some(p=>p.name==='Crêt de la Perdrix'));
assert.equal(cneFinite(null),null);
assert.equal(cneFinite(''),null);
assert.equal(cneFinite('abc'),null);
assert.equal(cneFinite(0),0);
const times=Array.from({length:72},(_,i)=>{
  const day=String(17+Math.floor(i/24)).padStart(2,'0');
  const hour=String(i%24).padStart(2,'0');
  return '2026-11-'+day+'T'+hour+':00';
});
const row={latitude:45.66,longitude:4.59,hourly:{
  time:times,
  snow_depth:times.map((_,i)=>i/1000),
  snowfall:times.map(()=>0.5),
  temperature_2m:times.map((_,i)=>-2+i/24),
  freezing_level_height:times.map(()=>1650)
}};
assert.equal(cneAt(row,'temperature_2m',0),-2);
assert.equal(cneAt(row,'bad',1),null);
assert.equal(cneValue(row,'depth',20),2);
assert.equal(cneValue(row,'fresh',0),null);
assert.equal(cneValue(row,'fresh',23),12);
assert.equal(cneValue(row,'fresh',24),12);
assert.equal(cneValue(row,'fresh',-1),null);
assert.equal(cneValue(row,'temp',0),-2);
assert.equal(cneValue(row,'iso0',0),1650);
assert.equal(cneSnowline(null),null);
assert.equal(cneSnowline(1650),1350);
assert.equal(cneInterpolate([row],4.59,45.66,20,'depth'),2);
assert.equal(cneInterpolate([row],4.59,45.66,20,'temp'),-2+20/24);
assert.equal(cneInterpolate([row],4.59,45.66,20,'lpn'),null);
assert.equal(cneNearest([row],45.661,4.591),row);
assert.equal(cneInterpolate([],4.59,45.66,20,'depth'),null);
assert.equal(cneInterpolate([{...row,hourly:{...row.hourly,snow_depth:[]}}],4.59,45.66,20,'depth'),null);
const wet={...row,hourly:{...row.hourly,snowfall:row.hourly.snowfall.map((v,i)=>i===4?null:v)}};
assert.equal(cneValue(wet,'fresh',24),null);
assert.equal(cneColor(null,'depth')[3],0);
assert.ok(cneColor(50,'depth')[3]>0);
assert.notDeepEqual(cneColor(300,'lpn'),cneColor(2200,'lpn'));
const pos={lon:4.59,lat:45.66};
const hourly=cneChartPoints([row],times,pos,'depth','hour');
assert.equal(hourly.length,72);
assert.equal(hourly[24].value,2.4);
const daily=cneChartPoints([row],times,pos,'depth','day');
assert.equal(daily.length,3);
assert.ok(daily.every(p=>p.time.endsWith('T12:00')));
const missing=cneChartPoints([],times,pos,'temp','day');
assert.ok(missing.every(p=>p.value===null));
console.log('3D CNE: geographic zones, model values, snowline, timeline: OK');
