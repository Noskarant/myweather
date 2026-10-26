import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULT_WIDGET_PLACE,finite,rounded,isValidPlace,normalizePlace,
 locationLabel,placeSuggestion,chooseHours,shouldShowMountain,futureSnowSum,
 parseDepartmentCode,mergeUniquePlaces
} from '../../js/widget-model.js';

test('location values: invalid coordinates or empty names cannot enter widget state',()=>{
 assert.equal(isValidPlace({name:'',lat:2,lon:3}),false);
 assert.equal(isValidPlace({name:'Oullins',lat:92,lon:4}),false);
 assert.equal(isValidPlace({name:'Oullins',lat:45.714,lon:4.807}),true);
 assert.equal(normalizePlace({name:' Oullins ',lat:45.714,lon:4.807}).name,'Oullins');
 assert.equal(normalizePlace({name:'Bad',lat:'nan',lon:6}),null);
 assert.equal(finite(null),null);
 assert.equal(finite(''),null);
 assert.equal(rounded(10.6),'11');
 assert.equal(DEFAULT_WIDGET_PLACE.name,'Oullins');
});
test('search suggestions display actual administrative information',()=>{
 const place={name:'Oullins',department:'Rhône',departmentCode:'69',admin1:'Auvergne-Rhône-Alpes',country:'France'};
 assert.equal(locationLabel(place),'Rhône (69) · Auvergne-Rhône-Alpes');
 assert.deepEqual(placeSuggestion(place),{name:'Oullins',detail:'Rhône (69) · Auvergne-Rhône-Alpes'});
 assert.equal(locationLabel({admin1:'Auvergne-Rhône-Alpes',country:'France'}),'Auvergne-Rhône-Alpes');
 assert.equal(parseDepartmentCode({postcode:'69600'}),'69');
 assert.equal(parseDepartmentCode({isoDepartment:'FR-73'}),'73');
 assert.equal(parseDepartmentCode({departmentCode:'2A'}),'2A');
 assert.equal(parseDepartmentCode({postcode:'97400'}),'974');
 assert.equal(parseDepartmentCode({postcode:'not-a-code'}),'');
});
test('hourly forecast uses the location-local wall clock, supports 36 scrollable hours',()=>{
 const start=Array.from({length:48},(_,i)=>({
  time:'2026-10-'+String(i>=24?'27':'26')+'T'+String(i%24).padStart(2,'0')+':00',
  temperature_2m:i
 }));
 const items=chooseHours({current:{time:'2026-10-26T11:47'},hourly:start},36);
 assert.equal(items.length,36);
 assert.equal(items[0].time,'2026-10-26T11:00');
 assert.equal(items.at(-1).time,'2026-10-27T22:00');
 assert.equal(chooseHours({hourly:[]}).length,0);
});
test('mountain LPN visibility and snow accumulation',()=>{
 assert.equal(shouldShowMountain({elevation:1150},{snowLevel:2100}),true);
 assert.equal(shouldShowMountain({elevation:180},{snowLevel:2100}),false);
 assert.equal(shouldShowMountain({elevation:700},{snowLevel:null}),true);
 assert.equal(futureSnowSum([{snowfall:1.3},{snowfall:0.7},{snowfall:null}]),2);
 assert.equal(futureSnowSum([{snowfall:1},{snowfall:2}],1),1);
});
test('nearby identical geocodes appear only once while keeping distinct places',()=>{
 const places=[
  {name:'A',lat:45.7100001,lon:4.800001},
  {name:'B',lat:45.7100002,lon:4.800001},
  {name:'C',lat:45.7109,lon:4.800001}
 ];
 assert.deepEqual(mergeUniquePlaces(places).map(p=>p.name),['A','C']);
});
