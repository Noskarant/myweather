import assert from 'node:assert/strict';
import { SNOW_RESORTS, lookupSnowResort, extractSnowDays, createMountainSnowChart } from './js/mountain-snow-chart.js';

assert.equal(SNOW_RESORTS.length,8);
assert.equal(new Set(SNOW_RESORTS.map(x=>x.key)).size,SNOW_RESORTS.length);
for (const resort of SNOW_RESORTS) {
  assert.equal(resort.levels.length,3);
  assert.ok(resort.levels[0].altitude < resort.levels[1].altitude);
  assert.ok(resort.levels[1].altitude < resort.levels[2].altitude);
  assert.equal(lookupSnowResort({name:resort.name})?.key,resort.key);
}
assert.equal(lookupSnowResort({name:'Le Meiller, Valmorel'})?.key,'valmorel');
assert.equal(lookupSnowResort({name:'Planchamp'})?.levels[1].altitude,1920);
assert.equal(lookupSnowResort({name:'Oullins'}),null);
const selected = [
  ["L’Alpe d’Huez", "alpe-dhuez", [1860,2300,3330]],
  ["Alpe d'Huez", "alpe-dhuez", [1860,2300,3330]],
  ["VAL-THORENS", "val-thorens", [2300,2850,3200]],
  ["Chalmazel-Jeansagnière", "chalmazel", [1110,1350,1600]],
  ["Les Ménuires", "les-menuires", [1850,2320,2850]],
  ["Orelle / Val Thorens", "orelle", [900,2350,3230]],
  ["Val Thorens / Orelle", "val-thorens", [2300,2850,3200]]
];
for (const [name,key,heights] of selected) {
  const found=lookupSnowResort({name});
  assert.equal(found?.key,key,'Failed resort lookup '+name);
  assert.deepEqual(found.levels.map(x=>x.altitude),heights,'Invalid heights '+name);
}


const dateStrings=Array.from({length:16},(_,i) => '2026-11-'+String(i+3).padStart(2,'0'));
const values=[0,1.5,null,12.38,-4,...Array(11).fill(0)];
const first=extractSnowDays({daily:{time:dateStrings,snowfall_sum:values}});
assert.equal(first.length,14);
assert.deepEqual(first.slice(0,5).map(x=>x.snow),[0,1.5,null,12.4,null]);
assert.equal(first[0].time,'2026-11-03');
const other=extractSnowDays({daily:[{time:'2026-11-03',snowfall:0},{time:'2026-11-04',snowfall:3.2}]});
assert.deepEqual(other.map(x=>x.snow),[0,3.2]);
assert.deepEqual(extractSnowDays({}),[]);

// Integration-like test: ensure the selected station elevation changes the actual
// Open-Meteo request, not only the label shown above the histogram.
class FakeNode {
  constructor() {
    this.innerHTML='';
    this.textContent='';
    this.style={setProperty(){}};
    this.attributes={};
  }
  setAttribute(name,value){this.attributes[name]=value;}
  querySelector(){return null;}
}
const nodes=Object.fromEntries([
  '#mountainSnowControls','#mountainSnowMessage','#mountainSnowBars',
  '#mountainSnowNote','#mountainSnowTotal'
].map(key=>[key,new FakeNode()]));
let handleClick;
const root={
  querySelector(selector){return nodes[selector] || null;},
  addEventListener(type,listener){if(type==='click')handleClick=listener;},
  contains(){return true;}
};
const originalFetch=globalThis.fetch;
const requests=[];
globalThis.fetch=async url => {
  const parsed=new URL(url);
  requests.push(parsed.searchParams);
  return {ok:true,json:async()=>({daily:{
    time:['2026-11-03','2026-11-04'],
    snowfall_sum:[2,3]
  }})};
};
try {
  const widget=createMountainSnowChart(root);
  const forecast={daily:[{time:'2026-11-03',snowfall:0}]};
  widget.render({name:"L'Alpe d'Huez",lat:45.09,lon:6.07,elevation:1860},forecast);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests[0]?.get('elevation'),'1860');
  assert.equal(requests[0]?.get('forecast_days'),'14');
  assert.ok(nodes['#mountainSnowBars'].innerHTML.includes('mountain-snow-slot'));
  assert.match(nodes['#mountainSnowControls'].innerHTML,/3[\s\u202f]330/);

  handleClick({target:{closest(selector) {
    return selector==='[data-snow-level]'?{dataset:{snowLevel:'summit'}}:null;
  }}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests[1]?.get('elevation'),'3330');
  assert.equal(requests[1]?.get('latitude'),'45.124993');
  assert.ok(nodes['#mountainSnowTotal'].textContent.includes('5 cm'));

  widget.render({name:'Orelle',lat:45.209421,lon:6.536404,elevation:900},forecast);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests[2]?.get('elevation'),'900');
  handleClick({target:{closest(selector) {
    return selector==='[data-snow-level]'?{dataset:{snowLevel:'mid'}}:null;
  }}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests[3]?.get('elevation'),'2350');
} finally {
  globalThis.fetch=originalFetch;
}

console.log('Mountain snow histogram tests passed.');
