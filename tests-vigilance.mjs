import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildVigilance,computeDayHazards,officialForDay,parseOfficialSnapshot,resolveFrenchDepartment} from './js/weather-vigilance.js';
import {sanitizeVigilance,collectVigilance} from './scripts/update-vigilance.mjs';

const start='2026-10-19T12:00';
const offset=7200;
const now=Date.parse('2026-10-19T10:30:00Z');
function hourly(date,overrides={}){
  return Array.from({length:24},(_,i)=>({
    time:date+'T'+String(i).padStart(2,'0')+':00',temperature_2m:8,
    precipitation:0,rain:0,showers:0,snowfall:0,weather_code:3,
    cape:0,wind_gusts_10m:20,...overrides
  }));
}
const plain={hourly:[...hourly('2026-10-19'),...hourly('2026-10-20')],utc_offset_seconds:offset};
const p={country:'France',lat:45.7,lon:4.8,elevation:180};
assert.equal(buildVigilance(plain,p,null,null,now).displayLevel,0);
assert.equal(buildVigilance(plain,p,null,null,now).tomorrowMessage,null);
assert.equal(computeDayHazards([],p,'2026-10-19').length,0);
const storm={...plain,hourly:[
  ...hourly('2026-10-19'),
  ...hourly('2026-10-20',{weather_code:99,cape:1200,precipitation:4,rain:4,wind_gusts_10m:75})
]};
const tomorrow=buildVigilance(storm,p,null,null,now);
assert.equal(tomorrow.today.level,0);
assert.equal(tomorrow.tomorrow.level,2);
assert.equal(tomorrow.displayDay,'tomorrow');
assert.match(tomorrow.tomorrowMessage,/Demain/);
assert.equal(tomorrow.primary.kind,'hail'); // The leading local hazard is hail when hail-coded storms are forecast.
const extreme=buildVigilance({...plain,hourly:[...hourly('2026-10-19'),
  ...hourly('2026-10-20',{weather_code:99,cape:2600,precipitation:25,rain:25,wind_gusts_10m:130})]},p,null,null,now);
assert.equal(extreme.tomorrow.level,3,'Red storm requires truly exceptional combined evidence');
assert.equal(tomorrow.tomorrow.items.find(i=>i.kind==='hail')?.level,2);
// Positive CAPE alone must not claim hail.
assert.equal(computeDayHazards(hourly('2026-10-19',{cape:1900}),p,'2026-10-19').some(i=>i.kind==='hail'),false);
// Snow alone is not transformed into rain.
const snowfall=computeDayHazards(hourly('2026-10-19',{snowfall:1.5,precipitation:2,weather_code:73}),p,'2026-10-19');
assert.ok(snowfall.some(i=>i.kind==='snow'));
assert.equal(snowfall.some(i=>i.kind==='rain'),false);
const officialPayload={
  meta:{product_datetime:'2026-10-19T10:00:00Z'},
  product:{periods:[
    {begin_validity_time:'2026-10-19T06:00:00Z',timelaps:{domain_ids:[
      {domain_id:'69',phenomenon_items:[{phenomenon_id:'2',phenomenon_max_color_id:3,timelaps_items:[]}]}
    ]}},
    {begin_validity_time:'2026-10-20T06:00:00Z',timelaps:{domain_ids:[
      {domain_id:'73',phenomenon_items:[{phenomenon_id:'5',phenomenon_max_color_id:4,timelaps_items:[]}]}
    ]}}
  ]}
};
const sanitized=sanitizeVigilance(officialPayload,now);
assert.equal(sanitized.days[0].departments['69'][0].level,2);
assert.equal(sanitized.days[1].departments['73'][0].level,3);
assert.equal(parseOfficialSnapshot(sanitized,now)?.schema,1);
assert.equal(officialForDay(sanitized,'69','2026-10-19')[0].level,2);
assert.equal(officialForDay(sanitized,'73','2026-10-19').length,0);
assert.equal(buildVigilance(plain,p,sanitized,'69',now).today.level,2);
assert.equal(parseOfficialSnapshot(sanitized,now+15*3600000),null);
assert.equal(sanitizeVigilance(officialPayload,now+15*3600000),null);
assert.equal(await collectVigilance(''),null);
assert.equal(await resolveFrenchDepartment({...p,country:'Canada'}),null);
assert.equal(await resolveFrenchDepartment(p,async()=>({ok:true,json:async()=>[{codeDepartement:'69'}]})),'69');
console.log('✓ vigilance local, official, geographic, today/tomorrow, stale data and hail tests passed');

const appSource=fs.readFileSync(new URL('./js/app.js',import.meta.url),'utf8');
const indexSource=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const cssSource=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
assert.match(indexSource,/id="vigilanceToggle"[^>]*\bhidden\b/,'Vigilance button must be hidden before first forecast load');
assert.ok(appSource.includes('const showAlert=lvl>=1&&!outdated;'));
assert.ok(appSource.includes('refs.vigilanceToggle.hidden=!showAlert;'));
assert.ok(appSource.includes('if(d.level<1)return'), 'Calm days must not show a green section in alert details');
assert.ok(cssSource.includes('.vigilance-toggle[hidden]{display:none!important}'),
  'CSS display:flex must not override the hidden attribute');
console.log('✓ Calm weather hides the badge, and the detail panel only shows alert days');
