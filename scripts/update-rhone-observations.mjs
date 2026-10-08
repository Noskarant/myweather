// Build a same-origin public-data snapshot at Pages deployment time (no API keys).
// Data sources: Grand Lyon hourly meteorological observations and openSenseMap public outdoor sensors.
// Never publishes stale data as current. NOAA/official SYNOP archives are deliberately excluded
// because an openly accessible, sufficiently fresh feed is not established.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {collectMeteoFranceStations} from './meteo-france-observations.mjs';
import {collectMeteoFrancePackage} from './meteo-france-package.mjs';

const AREA={west:4.24,south:45.38,east:5.24,north:46.35};
const MAX_AGE_MS=100*60*1000;
const STATIONS={
  '69029001':{name:'Lyon-Bron',lat:45.7213333333,lon:4.9491666667,elevation:202},
  '69123002':{name:'Lyon Tête d’Or',lat:45.7728333333,lon:4.8551666667,elevation:170},
  '69204002':{name:'Saint-Genis-Laval',lat:45.6946666667,lon:4.7823333333,elevation:290}
};
const TEMP_TEST=/temp[eé]ratur|^temp(\.|$)|^t$/i;
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
    if(!r.ok){
      const errorText=await r.text().catch(()=>'');
      console.warn('Weather source HTTP',new URL(url).host,r.status,errorText.slice(0,320));
      return null;
    }
    const len=Number(r.headers.get('content-length')||0);
    if(len>6e6)return null;
    const text=await r.text();
    if(text.length>6e6)return null;
    return JSON.parse(text);
  }catch(err){console.warn('Weather source unavailable',new URL(url).host,String(err?.message||err).slice(0,140));return null;}
}
export function parseGrandLyon(payload,now=Date.now()) {
  const rows=Array.isArray(payload)?payload:
    Array.isArray(payload?.values)?payload.values.map(row=>{
      if(!Array.isArray(row))return row;
      const keys=Array.isArray(payload.fields)?payload.fields.map(x=>typeof x==='string'?x:x.name||x.field||x.id):Object.keys(payload.fields||{});
      return Object.fromEntries(row.map((value,i)=>[keys[i]||('field'+i),value]));
    }):
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
    if(first(p,['observation']) && String(first(p,['observation'])).toUpperCase()!=='T')continue;
    const measured=first(p,['horodate','date','dateheure','date_heure','date_mesure','date_observation','datetime','date_utc','timestamp','heure']);
    const date=measured instanceof Date?measured.toISOString():String(measured||'');
    if(!ageValid(date,now))continue;
    let temp=finite(first(p,['T','temperature','temperature_c','temp','t_c','measurement']));
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
const GRAND_LYON='https://data.grandlyon.com/fr/datapusher/ws/timeseries/meteofrance.climatologie_mesure_horaire/all.json';
const SENSE_BOXES=[
  '4.24,45.38,4.74,45.86','4.74,45.38,5.24,45.86',
  '4.24,45.86,4.74,46.35','4.74,45.86,5.24,46.35'
].map(bbox=>'https://api.opensensemap.org/boxes?'+new URLSearchParams({bbox,exposure:'outdoor',limit:'20'}));
const METAR_URL='https://aviationweather.gov/api/data/metar?ids=LFLY,LFLL&format=json';
const SAINT_GENIS_ID='69204002';

// Grand Lyon's open timeseries is checked directly for the closest official
// station to Oullins. A catalog entry is not evidence of a live measurement.
export function parseSaintGenisObservations(payload, now=Date.now()) {
  return parseGrandLyon(payload,now).filter(station=>station.id==='grandlyon-'+SAINT_GENIS_ID);
}
async function fetchSaintGenisObservations(now,fetcher) {
  const params=new URLSearchParams({
    identifiant__eq:SAINT_GENIS_ID,
    observation__eq:'T',
    horodate__gte:new Date(now-110*60*1000).toISOString(),
    maxfeatures:'80'
  });
  const payload=await fetchJSON(GRAND_LYON+'?'+params,9500,fetcher);
  const stations=parseSaintGenisObservations(payload,now);
  const station=stations[0]||null;
  return {
    stations,
    status:{stationId:SAINT_GENIS_ID,source:'Grand Lyon / Météo-France',
      available:Boolean(station),measuredAt:station?.measuredAt||null,
      checkedAt:new Date(now).toISOString(),
      note:station
        ? 'Mesure officielle récente détectée. Contrôle qualité du modèle requis avant assimilation.'
        : 'Aucune mesure officielle récente disponible sur le flux ouvert. Prévisions inchangées.'}
  };
}


const METAR_STATIONS={
  LFLY:{name:'Lyon-Bron (aéroport)',lat:45.73015,lon:4.938569,elevation:200},
  LFLL:{name:'Lyon Saint-Exupéry',lat:45.725556,lon:5.081111,elevation:250}
};
export function parseMetars(payload,now=Date.now()) {
  if(!Array.isArray(payload))return [];
  const byCode=new Map();
  for(const item of payload){
    const code=String(item.icaoId||item.station_id||item.station||'').toUpperCase();
    const site=METAR_STATIONS[code];
    if(!site)continue;
    const temp=finite(item.temp??item.tempC??item.temperature);
    let obsTime=item.obsTime??item.observation_time??item.reportTime??item.validTime;
    if(typeof obsTime==='number'&&Number.isFinite(obsTime)) obsTime=new Date(obsTime*(obsTime<1e12?1000:1)).toISOString();
    const measuredAt=typeof obsTime==='string'?obsTime:null;
    if(!validTemp(temp)||!ageValid(measuredAt,now,100))continue;
    const entry={id:'metar-'+code,source:'METAR aviation',
      ...site,temperature:temp,measuredAt:new Date(measuredAt).toISOString()};
    if(!byCode.has(code)||Date.parse(byCode.get(code).measuredAt)<Date.parse(entry.measuredAt))
      byCode.set(code,entry);
  }
  return [...byCode.values()];
}

async function getSenseBoxReadings(now,fetcher) {
  const chunks=await Promise.all(SENSE_BOXES.map(url=>fetchJSON(url,9000,fetcher)));
  const boxes=[...new Map(chunks.flatMap(x=>Array.isArray(x)?x:[])
    .filter(b=>b?._id).map(b=>[b._id,b])).values()];
  if(!boxes.length)return [];
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
  const [grandlyon,senseboxes,metar,saintGenis,meteoFrance]=await Promise.all([
    fetchJSON(GRAND_LYON+'?'+new URLSearchParams({
      horodate__gte:new Date(now-110*60*1000).toISOString(),
      observation__eq:'T',maxfeatures:'200'
    }),11500,fetcher),
    getSenseBoxReadings(now,fetcher),
    fetchJSON(METAR_URL,11500,fetcher),
    fetchSaintGenisObservations(now,fetcher),
    collectMeteoFranceStations(process.env.METEOFRANCE_API_KEY,now,fetcher)
  ]);
  console.log('Grand Lyon sample',JSON.stringify(grandlyon?.values?.[0]||null).slice(0,500), 'field sample', JSON.stringify(grandlyon?.fields||null).slice(0,500));
  const official=[...new Map([...parseGrandLyon(grandlyon,now),...saintGenis.stations]
    .map(entry=>[entry.id,entry])).values()];
  const airport=parseMetars(metar,now);
  // The department-wide package complements DPObs v2 without double counting stations.
  // Choose the freshest valid sample per station (preserving 6-minute Saint-Genis data).
  const packageObs=await collectMeteoFrancePackage(
    process.env.METEOFRANCE_PACKAGE_API_KEY,now,fetcher,meteoFrance.stations);
  const officialById=new Map(meteoFrance.stations.map(st=>[st.id,st]));
  for(const reading of packageObs.stations){
    const current=officialById.get(reading.id);
    if(!current||Date.parse(reading.measuredAt)>Date.parse(current.measuredAt)){
      officialById.set(reading.id,reading);
    }
  }
  const officialMeteo=[...officialById.values()];
  console.log('Source responses:',JSON.stringify({
    grandlyon:grandlyon==null?'none':Array.isArray(grandlyon)?grandlyon.length:Object.keys(grandlyon),
    opensensemap:senseboxes.length,
    metar:metar==null?'none':Array.isArray(metar)?metar.length:Object.keys(metar)
  }));
  const collected=[...officialMeteo,...official.filter(st=>!officialById.has('mf-'+st.id.replace('grandlyon-',''))),...airport,...senseboxes]
    .filter(s=>ageValid(s.measuredAt,now))
    .sort((a,b)=>(a.source==='Grand Lyon / Météo-France'?0:1)-(b.source==='Grand Lyon / Météo-France'?0:1))
    .slice(0,110);
  const stations=await enrichModelBaselines(collected,now,fetcher);
  const stGenisValidated=stations.find(st=>st.id==='grandlyon-'+SAINT_GENIS_ID);
  const officialStGenis=stations.find(st=>st.id==='mf-'+SAINT_GENIS_ID);
  const saintGenisStatus={
    ...saintGenis.status,
    source:officialStGenis?'Météo-France':saintGenis.status.source,
    available:Boolean(officialStGenis)||saintGenis.status.available,
    assimilable:Boolean(officialStGenis||stGenisValidated),
    measuredAt:officialStGenis?.measuredAt||saintGenis.status.measuredAt,
    note:officialStGenis
      ? 'Observation Météo-France récente, authentifiée et validée avec la référence Open-Meteo.'
      : saintGenis.status.note
  };
  console.log('Météo-France package API status:',JSON.stringify({
    state:packageObs.status,department:packageObs.department,
    recent:packageObs.stations.length,combinedOfficial:officialMeteo.length
  }));
  console.log('Météo-France API status:',JSON.stringify({
    state:meteoFrance.status,listed:meteoFrance.available,
    sampled:meteoFrance.selected,recent:meteoFrance.stations.length
  }));
  console.log('Saint-Genis-Laval official feed:',JSON.stringify(saintGenisStatus));
  return {version:1,generatedAt:new Date(now).toISOString(),stations,
    sources:{meteofrance:officialMeteo.length,meteofranceV2:meteoFrance.stations.length,
      meteofrancePackage:packageObs.stations.length,
      grandlyon:official.length,metar:airport.length,opensensemap:senseboxes.length,
      validated:stations.length},
    stationChecks:{saintGenisLaval:saintGenisStatus,meteoFranceApi:meteoFrance.status,
      meteoFrancePackageApi:packageObs.status},
    note:'Observations météorologiques publiques ; températures locales corrigées uniquement si stations récentes et modèle de référence disponibles.'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const data=await collectRhoneObservations();
  await mkdir('data',{recursive:true});
  await writeFile('data/rhone-observations.json',JSON.stringify(data,null,2)+'\n');
  console.log('Rhone stations:',JSON.stringify(data.sources));
  if(data.stations.length===0) console.warn('No fresh usable stations: app falls back to original forecast.');
}
