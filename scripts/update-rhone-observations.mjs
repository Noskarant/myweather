// Build a same-origin public-data snapshot at Pages deployment time (no API keys).
// Data sources: Grand Lyon hourly meteorological observations and openSenseMap public outdoor sensors.
// Never publishes stale data as current. NOAA/official SYNOP archives are deliberately excluded
// because an openly accessible, sufficiently fresh feed is not established.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const AREA={west:4.24,south:45.38,east:5.24,north:46.35};
const MAX_AGE_MS=100*60*1000;
const STATIONS={
  '69029001':{name:'Lyon-Bron',lat:45.7213333333,lon:4.9491666667,elevation:202},
  '69123002':{name:'Lyon Tête d’Or',lat:45.7728333333,lon:4.8551666667,elevation:170},
  '69204002':{name:'Saint-Genis-Laval',lat:45.6946666667,lon:4.7823333333,elevation:290}
};
const TEMP_TEST=/temp[eé]rature|temperature|^temp(\.|$)|^t$/i;
const validTemp=n=>Number.isFinite(n)&&n>=-42&&n<=48;
const finite=value=>value===undefined||value===null||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const ageValid=(time,now,minutes=100)=>{
  const age=now-Date.parse(time||'');
  return Number.isFinite(age)&&age>=-5*60e3&&age<=minutes*60e3;
};
const validCoordinates=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&
  lat>=AREA.south&&lat<=AREA.north&&lon>=AREA.west&&lon<=AREA.east;
const first=(obj,names)=>{
  for(const key of names){
    const hit=Object.keys(obj||{}).find(k=>k.toLowerCase()===key.toLowerCase());
    if(hit!==undefined&&obj[hit]!==undefined&&obj[hit]!==null)return obj[hit];
  }
  return null;
};
async function fetchJSON(url,timeout=10500,fetcher=fetch) {
  try{
    const r=await fetcher(url,{signal:AbortSignal.timeout(timeout),headers:{accept:'application/json','user-agent':'MyWeather-RhoneStations/1.0 (https://github.com/Noskarant/myweather)'}});
    if(!r.ok)return null;
    const len=Number(r.headers.get('content-length')||0);
    if(len>6e6)return null;
    const text=await r.text();
    if(text.length>6e6)return null;
    return JSON.parse(text);
  }catch{return null;}
}
export function parseGrandLyon(payload,now=Date.now()) {
  const rows=Array.isArray(payload)?payload:
    Array.isArray(payload?.results)?payload.results:
    Array.isArray(payload?.features)?payload.features:
    Array.isArray(payload?.records)?payload.records:
    Array.isArray(payload?.data)?payload.data:[];
  const map=new Map();
  for(const row of rows){
    const p=row?.properties||row?.fields||row;
    if(!p||typeof p!=='object')continue;
    const ident=String(first(p,['identifiant','id_station','numer_sta','num_station','station','code_station','code'])||'');
    const metadata=STATIONS[ident];
    if(!metadata)continue;
    const measured=first(p,['date','dateheure','date_heure','date_mesure','date_observation','datetime','date_utc','timestamp','heure']);
    const date=measured instanceof Date?measured.toISOString():String(measured||'');
    if(!ageValid(date,now))continue;
    let temp=finite(first(p,['T','temperature','temperature_c','temp','t_c']));
    // A second tenths-of-degree column is used only if labelled explicitly.
    if(temp===null){const tenths=finite(first(p,['T10','temp_dixieme','temperature_dixieme']));if(tenths!==null)temp=tenths/10;}
    if(!validTemp(temp))continue;
    const observation={id:'grandlyon-'+ident,source:'Grand Lyon / Météo-France',
      name:metadata.name,...metadata,temperature:temp,measuredAt:new Date(date).toISOString()};
    const old=map.get(observation.id);
    if(!old||Date.parse(old.measuredAt)<Date.parse(observation.measuredAt))map.set(observation.id,observation);
  }
  return [...map.values()];
}
export function parseSenseBoxes(payload,now=Date.now()) {
  const boxes=Array.isArray(payload)?payload:Array.isArray(payload?.features)?payload.features:[];
  const result=[];
  for(const box of boxes) {
    const point=box.currentLocation?.coordinates||box.geometry?.coordinates||box.properties?.currentLocation?.coordinates||[];
    const lon=finite(point[0]),lat=finite(point[1]),elev=finite(point[2]);
    if(!validCoordinates(lat,lon))continue;
    if(['indoor','mobile'].includes(String(box.exposure||box.properties?.exposure||'').toLowerCase()))continue;
    const sensors=box.sensors||box.properties?.sensors||[];
    const sensor=sensors.filter(s=>TEMP_TEST.test(String(s.title||s.phenomenon||''))&&
        /(°c|celsius|^c$)/i.test(String(s.unit||'°C').replace(/\s/g,'')))
      .map(s=>{
        const val=finite(s.lastMeasurement?.value);
        const date=s.lastMeasurement?.createdAt;
        return {value:val,date};
      }).filter(s=>validTemp(s.value)&&ageValid(s.date,now,80))
      .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
    if(!sensor)continue;
    result.push({
      id:'sensebox-'+String(box._id||box.id||''),
      name:String(box.name||box.properties?.name||'Station openSenseMap').slice(0,80),
      source:'openSenseMap',lat,lon,elevation:elev,
      temperature:sensor.value,measuredAt:new Date(sensor.date).toISOString()
    });
  }
  return result.filter(s=>s.id!=='sensebox-').slice(0,120);
}
const GRAND_LYON='https://data.grandlyon.com/fr/datapusher/ws/timeseries/meteofrance.climatologie_mesure_horaire/all.json?maxfeatures=200';
const SENSE_BOXES='https://api.opensensemap.org/boxes?bbox=4.24,45.38,5.24,46.35&exposure=outdoor&limit=300';

async function getSenseBoxReadings(now,fetcher) {
  const boxes=await fetchJSON(SENSE_BOXES,11500,fetcher);
  if(!Array.isArray(boxes))return [];
  let fresh=parseSenseBoxes(boxes,now);
  if(fresh.length>=12)return fresh;
  // Station metadata may lack lastMeasurement; read the documented sensors endpoint.
  const possible=boxes.filter(b=>b?._id&&!['indoor','mobile'].includes(b.exposure))
    .filter(b=>(b.sensors||[]).some(s=>TEMP_TEST.test(String(s.title||''))))
    .slice(0,35);
  for(let i=0;i<possible.length;i+=6) {
    const chunk=possible.slice(i,i+6);
    const details=await Promise.all(chunk.map(async b=>{
      const data=await fetchJSON('https://api.opensensemap.org/boxes/'+encodeURIComponent(b._id)+'/sensors',6500,fetcher);
      return data?{...b,sensors:data.sensors||[]}:null;
    }));
    fresh.push(...parseSenseBoxes(details.filter(Boolean),now));
  }
  return [...new Map(fresh.map(x=>[x.id,x])).values()].slice(0,120);
}
async function enrichModelBaselines(stations,now,fetcher) {
  // Co-located model temperatures allow residual (observation minus background) interpolation.
  const done=[];
  for(let i=0;i<stations.length;i+=30) {
    const batch=stations.slice(i,i+30);
    const params=new URLSearchParams({
      latitude:batch.map(s=>s.lat).join(','),longitude:batch.map(s=>s.lon).join(','),
      current:'temperature_2m',timezone:'UTC',forecast_days:'1'
    });
    const payload=await fetchJSON('https://api.open-meteo.com/v1/forecast?'+params,11500,fetcher);
    const models=Array.isArray(payload)?payload:payload?[payload]:[];
    batch.forEach((station,index)=>{
      const model=models[index];
      const value=finite(model?.current?.temperature_2m);
      const modelAt=Date.parse((model?.current?.time||'')+'Z');
      if(!validTemp(value)||!Number.isFinite(modelAt)||
        Math.abs(Date.parse(station.measuredAt)-modelAt)>90*60e3) return;
      const discrepancy=station.temperature-value;
      if(Math.abs(discrepancy)>7) return;
      done.push({...station,modelTemperature:value,
        elevation:station.elevation??finite(model?.elevation)});
    });
  }
  return done;
}
export async function collectRhoneObservations(now=Date.now(),fetcher=fetch) {
  const [grandlyon,senseboxes]=await Promise.all([
    fetchJSON(GRAND_LYON,11500,fetcher),
    getSenseBoxReadings(now,fetcher)
  ]);
  const official=parseGrandLyon(grandlyon,now);
  const collected=[...official,...senseboxes]
    .filter(s=>ageValid(s.measuredAt,now))
    .sort((a,b)=>(a.source==='Grand Lyon / Météo-France'?0:1)-(b.source==='Grand Lyon / Météo-France'?0:1))
    .slice(0,110);
  const stations=await enrichModelBaselines(collected,now,fetcher);
  return {version:1,generatedAt:new Date(now).toISOString(),stations,
    sources:{grandlyon:official.length,opensensemap:senseboxes.length,
      validated:stations.length},
    note:'Observations météorologiques publiques ; températures locales corrigées uniquement si stations récentes et modèle de référence disponibles.'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const data=await collectRhoneObservations();
  await mkdir('data',{recursive:true});
  await writeFile('data/rhone-observations.json',JSON.stringify(data,null,2)+'\n');
  console.log('Rhone stations:',JSON.stringify(data.sources));
  if(data.stations.length===0) console.warn('No fresh usable stations: app falls back to original forecast.');
}
