// Météo-France DPObs v2, only called in GitHub Actions with METEOFRANCE_API_KEY.
// A credential is NEVER serialized, logged, included in generated JSON, or sent to the browser.
// Reference: https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/pages/853639294/
const API='https://public-api.meteofrance.fr/public/DPObs/v2';
const REGIONS={
  rhone:{south:45.38,north:46.35,west:4.24,east:5.24,center:{lat:45.714,lon:4.807}},
  // Wider geographic envelope for Savoie department 73; exact station IDs remain prefixed 73.
  savoie:{south:45.05,north:46.06,west:5.52,east:7.28,center:{lat:45.55,lon:6.6}},
  idf:{south:48.1,north:49.25,west:1.42,east:3.57,center:{lat:48.8566,lon:2.3522}},
  vendee:{south:46.22,north:47.18,west:-2.55,east:-0.5,center:{lat:46.67,lon:-1.43}},
  reunion:{south:-21.43,north:-20.85,west:55.18,east:55.89,center:{lat:-21.115,lon:55.54}}
};
const CANDIDATE_LIMIT=32;
const MAX_AGE=100*60*1000;
const sane=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))?Number(n):null;
const inside=(lat,lon,region='rhone')=>{
  const b=REGIONS[region]||REGIONS.rhone;
  return lat!==null&&lon!==null&&
    lat>=b.south&&lat<=b.north&&lon>=b.west&&lon<=b.east;
};
function distance(a,b) {
  const p=Math.PI/180,dl=(b.lat-a.lat)*p,dx=(b.lon-a.lon)*p;
  const h=Math.sin(dl/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dx/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
function splitCSVLine(line,delimiter) {
  const result=[];let current='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){current+='"';i++;} else quoted=!quoted;
    }else if(ch===delimiter&&!quoted){result.push(current);current='';}
    else current+=ch;
  }
  result.push(current);
  return result;
}
export function parseCsv(csv) {
  if(typeof csv!=='string')return [];
  const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return [];
  const header=lines[0];
  const delimiter=[';',',','\t'].sort((a,b)=>header.split(b).length-header.split(a).length)[0];
  const cols=splitCSVLine(header,delimiter).map(s=>s.toLowerCase().trim().replace(/[\s.-]+/g,'_'));
  return lines.slice(1).map(line=>{
    const values=splitCSVLine(line,delimiter),obj={};
    cols.forEach((key,i)=>{obj[key]=values[i]?.trim()||'';});
    return obj;
  });
}
function pick(o,...names){
  for(const name of names)if(o?.[name]!==undefined&&o[name]!==null&&o[name]!=='')return o[name];
  return null;
}
export function parseMeteoFranceStationList(payload,region='rhone') {
  const rows=typeof payload==='string'?parseCsv(payload):
    Array.isArray(payload)?payload:Array.isArray(payload?.stations)?payload.stations:[];
  return rows.flatMap(row=>{
    const normalized=Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[
      k.toLowerCase().trim().replace(/[\s.-]+/g,'_'),v]));
    const id=String(pick(normalized,'id_station','id','geo_id_insee')||'').padStart(8,'0');
    const lat=sane(pick(normalized,'latitude','lat'));
    const lon=sane(pick(normalized,'longitude','lon','long'));
    const elevation=sane(pick(normalized,'altitude','alt','elevation'));
    const accepted=region==='idf'?['75','77','78','91','92','93','94','95'].some(prefix=>id.startsWith(prefix)):
      region==='vendee'?id.startsWith('85'):
      region==='reunion'?id.startsWith('974'):
      region==='savoie'?id.startsWith('73'):true;
    if(!/^\d{8}$/.test(id)||!inside(lat,lon,region)||!accepted)return [];
    const name=String(pick(normalized,'nom_usuel','nom','name','long_name')||'Station '+id).slice(0,90);
    return [{id,name,lat,lon,elevation}];
  });
}
export function selectMeteoFranceStations(stations, limit=CANDIDATE_LIMIT,region='rhone') {
  const center=(REGIONS[region]||REGIONS.rhone).center;
  const unique=[...new Map(stations.map(s=>[s.id,s])).values()];
  const near=unique.slice().sort((a,b)=>distance(a,center)-distance(b,center));
  const selected=near.slice(0,Math.min(13,limit));
  // A mix of nearby stations (Oullins) and a diverse spatial network across Rhône.
  while(selected.length<Math.min(limit,unique.length)){
    let candidate=null,score=-1;
    for(const st of unique){
      if(selected.some(s=>s.id===st.id))continue;
      const diversity=Math.min(...selected.map(s=>distance(s,st)));
      const next=diversity+5/(1+distance(st,center));
      if(next>score){candidate=st;score=next;}
    }
    if(!candidate)break;
    selected.push(candidate);
  }
  return selected.sort((a,b)=>
    (region==='rhone'&&a.id==='69204002'?-1:0)-(region==='rhone'&&b.id==='69204002'?-1:0));
}
function isoDate(value){
  const parsed=Date.parse(String(value||''));
  return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
export function parseMeteoFranceObservation(payload,station,now=Date.now(),region='rhone') {
  const features=Array.isArray(payload?.features)?payload.features:
    Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:
    payload?.properties?[payload]:payload&&typeof payload==='object'?[payload]:[];
  const options=features.flatMap(feature=>{
    const p=feature?.properties||feature;
    if(!p)return [];
    const stationId=pick(p,'geo_id_insee','id_station');
    if(stationId&&String(stationId)!==String(station.id))return [];
    const tempKelvin=sane(p.t);
    // Official observation field 't' is in Kelvin. Never mistake it for Celsius.
    if(tempKelvin===null||tempKelvin<228.15||tempKelvin>321.15)return [];
    const observed=isoDate(p.validity_time||p.reference_time);
    const age=observed?now-Date.parse(observed):Infinity;
    if(age< -5*60*1000||age>MAX_AGE)return [];
    const coords=feature?.geometry?.coordinates||[];
    const lon=sane(p.lon??coords[0])??station.lon;
    const lat=sane(p.lat??coords[1])??station.lat;
    if(!inside(lat,lon,region))return [];
    return [{
      id:'mf-'+station.id,name:station.name,source:'Météo-France',
      lat,lon,elevation:station.elevation,
      temperature:Math.round((tempKelvin-273.15)*100)/100,
      humidity:sane(p.u),windSpeedMs:sane(p.ff),rainMm:sane(p.rr1??p.rr_per),
      snowDepthM:sane(p.sss),measuredAt:observed
    }];
  });
  return options.sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt))[0]||null;
}
async function apiGET(endpoint,apiKey,fetcher,format='geojson'){
  const url=API+endpoint;
  try{
    const response=await fetcher(url,{
      headers:{accept:format==='csv'?'text/csv, text/plain, */*':'application/geo+json, application/json, */*',
        apikey:apiKey},
      signal:AbortSignal.timeout(11000)
    });
    if(!response.ok){
      // Never print bodies/requests: they may contain credential-bearing metadata.
      console.warn('Météo-France observations HTTP',response.status,endpoint.split('?')[0]);
      return null;
    }
    const body=await response.text();
    if(body.length>4e6)return null;
    if(body.trim().startsWith('{')||body.trim().startsWith('[')){
      try{return JSON.parse(body);}catch{return null;}
    }
    return body;
  }catch(err){
    console.warn('Météo-France observations unavailable',endpoint.split('?')[0],err?.name||'request-failed');
    return null;
  }
}
export async function collectMeteoFranceStations(apiKey,now=Date.now(),fetcher=fetch,region='rhone') {
  if(!apiKey||typeof apiKey!=='string')return {stations:[],status:'not_configured',available:0,selected:0};
  const listing=await apiGET('/liste-stations?format=csv',apiKey,fetcher,'csv');
  if(!listing)return {stations:[],status:'catalog_unavailable',available:0,selected:0};
  const catalog=parseMeteoFranceStationList(listing,region);
  const selected=selectMeteoFranceStations(catalog,CANDIDATE_LIMIT,region);
  const stations=[];
  for(let i=0;i<selected.length;i+=5){
    const batch=selected.slice(i,i+5);
    const results=await Promise.all(batch.map(async station=>{
      const query=new URLSearchParams({id_station:station.id,format:'geojson'});
      let measurement=await apiGET('/station/horaire?'+query,apiKey,fetcher);
      let reading=parseMeteoFranceObservation(measurement,station,now,region);
      // The closest station is extra valuable: attempt the more frequent 6-min feed.
      if(region==='rhone'&&station.id==='69204002'){
        measurement=await apiGET('/station/infrahoraire-6m?'+query,apiKey,fetcher);
        reading=parseMeteoFranceObservation(measurement,station,now,region)||reading;
      }
      return reading;
    }));
    stations.push(...results.filter(Boolean));
  }
  return {stations,status:stations.length?'ready':'no_fresh_readings',
    catalog,available:catalog.length,selected:selected.length,
    saintGenis:stations.find(s=>s.id==='mf-69204002')?.measuredAt||null};
}
