import assert from 'node:assert/strict';
import { distanceKm,generateCandidates,evaluateCandidate,rankCandidates } from './js/discovery.js';
import {buildStationMetrics} from './js/weather-station.js';
import {readFileSync} from 'node:fs';

const a={name:'Point de départ',lat:45.714,lon:4.807};
assert.ok(distanceKm(a,{lat:45.714,lon:4.807})<.001);
const points=generateCandidates(a,25,[{name:'Mont',lat:45.75,lon:4.81}]);
assert.ok(points.length>40 && points.length<120,'Nearby exploration should stay bounded');
assert.ok(points.every(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)));
const sample=(snowDepth,sunshine,lat=45.75)=>({
  point:{name:'Échantillon',lat,lon:4.81},
  forecast:{elevation:950,current:{time:'2026-10-20T10:00',temperature_2m:2},
    hourly:{time:['2026-10-20T09:00','2026-10-20T10:00','2026-10-20T11:00','2026-10-21T09:00'],
      snow_depth:[snowDepth,snowDepth,snowDepth,snowDepth],snowfall:[0,0.4,0,0],
      sunshine_duration:[0,sunshine,sunshine,0],cloud_cover:[80,40,20,0]},
    daily:{time:['2026-10-20','2026-10-21']}}
});
const s1=sample(.13,1800);
const s2=sample(.0,3500,45.9);
const p1=evaluateCandidate(s1.point,s1.forecast);
const p2=evaluateCandidate(s2.point,s2.forecast);
assert.ok(p1.snowCm>12&&p1.snowCm<14,'Snow depth meters must be converted to cm');
assert.equal(p1.sunHours,1);
assert.ok(p2.sunHours>p1.sunHours,'Sunshine duration must be ranked in hours');
const winners=rankCandidates(a,[p1,p2]);
assert.equal(winners.snow.name,'Échantillon');
assert.equal(winners.sun.lat,p2.lat);
assert.equal(evaluateCandidate(s1.point,s1.forecast,'tomorrow').sunHours,0);
assert.ok(evaluateCandidate(s1.point,s1.forecast,'48h').sampledHours>=1);
const station=buildStationMetrics({
  current:{time:'2026-10-20T10:00',temperature_2m:4,relative_humidity_2m:77,pressure_msl:1016},
  daily:[{time:'2026-10-20',min:0,max:12,sunshineDuration:14400,sunrise:'2026-10-20T08:10',sunset:'2026-10-20T18:50'}],
  hourly:Array.from({length:30},(_,i)=>({
    time:'2026-10-20T'+String(i).padStart(2,'0')+':00',
    temperature_2m:i*.2,pressure_msl:1012+i*.4,precipitation:0.2,
    snow_depth:.07,wind_speed_10m:14
  }))
});
assert.equal(station.temperature,4);
assert.equal(station.humidity,77);
assert.ok(station.snowDepth>=6.9&&station.snowDepth<=7.1);
assert.ok(station.pressureTrend!=null,'Pressure trend should use historic hourly values');
assert.ok(station.accumulation>0);
assert.equal(buildStationMetrics(null),null);
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('./js/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
for(const id of ['exploreView','stationView','discoverRun','stationDashboard','stationOrientation'])
  assert.ok(html.includes('id="'+id+'"'),'Missing independent page element: '+id);
assert.ok(html.includes('data-nav="explore"')&&html.includes('data-nav="station"'));
assert.ok(app.includes('createDiscoveryController')&&app.includes('createStationController'));
assert.ok(css.includes('.station-page[data-orientation="vertical"]'));
console.log('✓ Explorer neige/soleil + station météo checks passed');
