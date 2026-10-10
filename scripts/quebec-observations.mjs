// Canada/Québec station observations for public GitHub Pages builds.
// No API keys: ECCC GeoMet SWOB, Quebec RSCQ open data, NOAA AviationWeather METAR.
// Keep the model baseline at the observation's coordinates/elevation. Never invent readings.
import {parseCsv} from './meteo-france-observations.mjs';

const AREA={south:46.35,north:47.45,west:-72.15,east:-70.15};
const SWOB='https://api.weather.gc.ca/collections/swob-realtime/items';
const METAR='https://aviationweather.gov/api/data/metar';
const RSCQ_META='https://www.donneesquebec.ca/recherche/api/3/action/package_show';
const DATASET='rscq-donnees-meteorologiques-horaires-recentes';
const MODEL='https://api.open-meteo.com/v1/forecast';
const MAX_AGE=100*60_000;
const finite=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const within=(lat,lon)=>lat!==null&&lon!==null&&lat>=AREA.south&&
  lat<=AREA.north&&lon>=AREA.west&&lon<=AREA.east;
const dateTime=v=>{
  if(typeof v==='number'&&Number.isFinite(v))return new Date(v<1e11?v*1000:v).toISOString();
  if(typeof v!=='string'||!v.trim())return null;
  // Timestamps without timezone must not silently be interpreted as server-local.
  const stamp=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(v)
    ?v.replace(' ','T')+'Z':v;
  const ms=Date.parse(stamp);
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
};
const fresh=(stamp,now)=>{
  const dt=Date.parse(stamp||'');const age=now-dt;
  return Number.isFinite(age)&&age>=-5*60_000&&age<=MAX_AGE;
};
const box=(lat,lon,temp,stamp,now)=>within(lat,lon)&&temp!==null&&
  temp>=-55&&temp<=45&&fresh(stamp,now);
const pick=(p,fields)=>{for(const key of fields){
  const value=p?.[key];if(value!==undefined&&value!==null&&value!=='')return value;
}return null;};
const cleanId=x=>String(x??'').trim().slice(0,70);
const cleanName=x=>String(x||'Station météorologique').trim().slice(0,95);
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function celsius(value,unit){
  const n=finite(value);if(n===null)return null;
  const u=norm(unit);
  if(/\bkelvin\b|\bkel\b|^k$/.test(u))return n-273.15;
  if(/\bfahrenheit\b|^f$/.test(u))return (n-32)*5/9;
  // Canadian SWOB air_temp and RSCQ temperature are in degrees Celsius.
  return n;
}
function selectLatest(stations){
  const byId=new Map();
  for(const st of stations){
    if(!st||!st.id)continue;
    const prev=byId.get(st.id);
    if(!prev||Date.parse(st.measuredAt)>Date.parse(prev.measuredAt))byId.set(st.id,st);
  }
  return [...byId.values()];
}
// One SWOB observation may use 'air_temp' and 'date_tm-value' (published GeoMet schema).
export function parseSwobObservations(payload,now=Date.now()){
  const rows=Array.isArray(payload?.features)?payload.features:[];
  return selectLatest(rows.flatMap(feature=>{
    const p=feature?.properties||{};
    const coords=feature?.geometry?.coordinates||[];
    const lat=finite(coords[1]??p.lat??p.latitude);
    const lon=finite(coords[0]??p.long??p.longitude);
    const temp=celsius(pick(p,['air_temp','air_temp-value','avg_air_temp_pst1hr']),
      pick(p,['air_temp-uom','avg_air_temp_pst1hr-uom']));
    const stamp=dateTime(pick(p,['date_tm-value','obs_date_tm','date_tm','datetime','valid_time']));
    if(!box(lat,lon,temp,stamp,now))return [];
    const id=cleanId(pick(p,['stn_id-value','tc_id-value','clim_id-value',
      'msc_id-value','icao_stn_id-value']));
    if(!id)return [];
    const name=cleanName(pick(p,['stn_nam-value','name','station_name'])||id);
    const elev=finite(pick(p,['stn_elev','stn_elev-value','elevation','elev']));
    return [{id:'swob-'+id,name,source:'Environnement Canada (SWOB)',
      lat,lon,elevation:elev,temperature:Math.round(temp*100)/100,
      measuredAt:stamp}];
  }));
}
export function parseMetarQuebec(payload,now=Date.now()){
  if(!Array.isArray(payload))return [];
  return selectLatest(payload.flatMap(p=>{
    if(!['CYQB','CYML','CYFE','CYBG'].includes(String(p.icaoId||'').toUpperCase()))return [];
    const lat=finite(p.lat),lon=finite(p.lon),temp=finite(p.temp);
    const stamp=dateTime(p.obsTime??p.reportTime??p.receiptTime);
    if(!box(lat,lon,temp,stamp,now))return [];
    return [{id:'metar-'+p.icaoId.toUpperCase(),name:cleanName(p.name||p.icaoId),
      source:'METAR aviation',lat,lon,elevation:finite(p.elev),
      temperature:temp,measuredAt:stamp}];
  }));
}
function normalizedRow(row){
  return Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[norm(k).replace(/ /g,'_'),v]));
}
// RSCQ hourly group CSV has one record per station / time / meteorological phenomenon.
// Only explicit temperature phenomena are accepted: other fields must never become air temp.
export function parseRscqObservations(hourlyText,stationText,now=Date.now()){
  const stations=parseCsv(stationText).map(normalizedRow);
  const sites=new Map();
  for(const p of stations){
    const id=cleanId(pick(p,['no_station','numero_station','station','id_station','code_station']));
    const lat=finite(pick(p,['latitude','lat','latitude_n','lat_deg']));
    const lon=finite(pick(p,['longitude','long','lon','longitude_o']));
    if(!id||!within(lat,lon))continue;
    sites.set(id,{
      id,name:cleanName(pick(p,['nom_station','nom','station_nom','nom_usuel'])||id),
      lat,lon,elevation:finite(pick(p,['altitude','elevation','altitude_m']))
    });
  }
  const rows=parseCsv(hourlyText).map(normalizedRow);
  return selectLatest(rows.flatMap(p=>{
    const id=cleanId(pick(p,['no_station','numero_station','station','id_station','code_station']));
    const site=sites.get(id);
    if(!site)return [];
    const phenomenon=norm(pick(p,['nom_phenomene','phenomene','parametre',
      'code_phenomene','code_donnee','type_donnee','variable','nom_variable']));
    if(!/\btemp(?:erature)?\b|^ta$|^temp_air$|^temperature_air$/.test(phenomenon))return [];
    const value=pick(p,['valeur','valeur_mesure','valeur_observee','val','mesure','resultat']);
    const temp=celsius(value,pick(p,['unite','unite_mesure']));
    const stamp=dateTime(pick(p,['date_heure','date_heure_utc','date_observation',
      'datetime','horodate','date','date_mesure']));
    if(!box(site.lat,site.lon,temp,stamp,now))return [];
    return [{...site,id:'rscq-'+id,source:'RSCQ Québec',
      temperature:Math.round(temp*100)/100,measuredAt:stamp}];
  }));
}
async function safeJson(url,fetcher,timeout=14000,max=5_000_000){
  try{
    const r=await fetcher(url,{signal:AbortSignal.timeout(timeout),headers:{
      accept:'application/geo+json, application/json','user-agent':'MyWeather-open-stations/1.0 (https://github.com/Noskarant/myweather)'
    }});
    if(!r.ok){console.warn('Québec feed HTTP',new URL(url).host,r.status);return null;}
    if(Number(r.headers?.get?.('content-length')||0)>max)return null;
    const text=await r.text();if(text.length>max)return null;
    return JSON.parse(text);
  }catch(e){console.warn('Québec feed unavailable',new URL(url).host,e?.name||'error');return null;}
}
async function safeText(url,fetcher,limit=3_000_000){
  try{
    const r=await fetcher(url,{signal:AbortSignal.timeout(14000),headers:{
      accept:'text/csv, text/plain, */*','user-agent':'MyWeather-open-stations/1.0 (https://github.com/Noskarant/myweather)'
    }});
    if(!r.ok||Number(r.headers?.get?.('content-length')||0)>limit)return null;
    const text=await r.text();return text.length<=limit?text:null;
  }catch{return null;}
}
function approvedDownload(url){
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&(
      u.hostname==='donneesquebec.ca'||u.hostname==='www.donneesquebec.ca'||
      u.hostname==='environnement.gouv.qc.ca'||u.hostname.endsWith('.environnement.gouv.qc.ca')||
      u.hostname==='storage.googleapis.com'
    );
  }catch{return false;}
}
export function identifyRscqResources(resources=[]){
  const csv=resources.filter(r=>String(r.format||'').toUpperCase()==='CSV'&&
    typeof r.url==='string'&&approvedDownload(r.url));
  const named=r=>norm(r.name||r.name_fr||r.description||'');
  const stations=csv.find(r=>/liste des stations|station list/.test(named(r)));
  const hourly=csv.find(r=>/24 dernier/.test(named(r))&&/groupe/.test(named(r))&&
    !/30 dernier/.test(named(r)));
  return {stations:stations?.url||null,hourly:hourly?.url||null};
}
export async function fetchRscqObservations(now=Date.now(),fetcher=fetch){
  const url=RSCQ_META+'?'+new URLSearchParams({id:DATASET});
  const meta=await safeJson(url,fetcher,11000,1_000_000);
  if(meta?.success!==true||!Array.isArray(meta.result?.resources))
    return {stations:[],status:'metadata_unavailable'};
  const resources=identifyRscqResources(meta.result.resources);
  if(!resources.stations||!resources.hourly)
    return {stations:[],status:'resource_unavailable'};
  const [hourly,stations]=await Promise.all([
    safeText(resources.hourly,fetcher),safeText(resources.stations,fetcher)
  ]);
  if(!hourly||!stations)return {stations:[],status:'download_unavailable'};
  const parsed=parseRscqObservations(hourly,stations,now);
  return {stations:parsed,status:parsed.length?'ready':'no_fresh_temperature'};
}
export async function fetchSwobObservations(now=Date.now(),fetcher=fetch){
  // OGC API bbox and UTC datetime keep the request regional & limited.
  const query=new URLSearchParams({
    f:'json',bbox:[AREA.west,AREA.south,AREA.east,AREA.north].join(','),
    datetime:new Date(now-100*60_000).toISOString()+'/'+new Date(now).toISOString(),
    limit:'1000'
  });
  const payload=await safeJson(SWOB+'?'+query,fetcher,16000,12_000_000);
  const stations=parseSwobObservations(payload,now);
  return {stations,status:stations.length?'ready':payload?'no_fresh_temperature':'unavailable'};
}
export async function fetchMetarQuebec(now=Date.now(),fetcher=fetch){
  const query=new URLSearchParams({ids:'CYQB,CYML,CYFE,CYBG',format:'json',hours:'2'});
  const payload=await safeJson(METAR+'?'+query,fetcher,12000,250_000);
  const stations=parseMetarQuebec(payload,now);
  return {stations,status:stations.length?'ready':payload?'no_fresh_temperature':'unavailable'};
}
export function dedupeQuebecStations(groups){
  const stations=selectLatest(groups.flat());
  // Prefer SWOB if it repeats a METAR position within 400 m.
  const priority=st=>st.source==='RSCQ Québec'?3:st.source.startsWith('Environnement Canada')?2:1;
  const sorted=stations.slice().sort((a,b)=>priority(b)-priority(a));
  const radians=Math.PI/180;
  return sorted.filter((st,i)=>!sorted.slice(0,i).some(other=>{
    const dlat=(st.lat-other.lat)*111;
    const dlon=(st.lon-other.lon)*111*Math.cos(st.lat*radians);
    return Math.hypot(dlat,dlon)<0.4&&Math.abs(Date.parse(st.measuredAt)-Date.parse(other.measuredAt))<90*60_000;
  }));
}
export async function enrichQuebecModelBaselines(stations,now=Date.now(),fetcher=fetch){
  const validated=[];
  for(let i=0;i<stations.length;i+=20){
    const batch=stations.slice(i,i+20);
    const q=new URLSearchParams({latitude:batch.map(s=>s.lat).join(','),
      longitude:batch.map(s=>s.lon).join(','),
      current:'temperature_2m',timezone:'UTC',forecast_days:'1'});
    // Open-Meteo elevation is a single value for single points or a comma-separated
    // value for multi-point calls. Unknown elevation: omit rather than invent it.
    if(batch.every(s=>finite(s.elevation)!==null))
      q.set('elevation',batch.map(s=>s.elevation).join(','));
    const response=await safeJson(MODEL+'?'+q,fetcher,14000,2_000_000);
    const models=Array.isArray(response)?response:[response];
    for(let j=0;j<batch.length;j++){
      const station=batch[j],base=models[j];
      const pred=finite(base?.current?.temperature_2m);
      const modelTime=dateTime(base?.current?.time);
      if(pred===null||!modelTime||
        Math.abs(Date.parse(modelTime)-Date.parse(station.measuredAt))>95*60_000||
        Math.abs(pred-station.temperature)>7)continue;
      validated.push({...station,modelTemperature:pred,
        elevation:finite(station.elevation)??finite(base?.elevation)});
    }
  }
  return validated;
}
export async function collectQuebecObservations(now=Date.now(),fetcher=fetch){
  // No account, no token, each source optional. One failure must not block others.
  const [swob,rscq,metar]=await Promise.all([
    fetchSwobObservations(now,fetcher),
    fetchRscqObservations(now,fetcher),
    fetchMetarQuebec(now,fetcher)
  ]);
  const unique=dedupeQuebecStations([swob.stations,rscq.stations,metar.stations]);
  const stations=await enrichQuebecModelBaselines(unique,now,fetcher);
  return {version:1,region:'quebec',generatedAt:new Date(now).toISOString(),stations,
    sources:{swob:swob.stations.length,rscq:rscq.stations.length,
      metar:metar.stations.length,unique:unique.length,validated:stations.length},
    checks:{swob:swob.status,rscq:rscq.status,metar:metar.status},
    note:'Observations réelles de la région de Québec et modèle colocalisé; données hors zone/périmées rejetées. Sources ouvertes, sans compte ni clé.'};
}
