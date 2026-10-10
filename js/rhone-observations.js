// Observations assimilées Rhône, Savoie, Québec, Île-de-France, Vendée et La Réunion.
// Same-origin snapshot generated for GitHub Pages; never requires browser API keys.
const SNAPSHOT_URL = new URL('../data/rhone-observations.json', import.meta.url);
const SAVOIE_SNAPSHOT_URL = new URL('../data/savoie-observations.json',import.meta.url);
const QUEBEC_SNAPSHOT_URL = new URL('../data/quebec-observations.json',import.meta.url);
const EXTRA_URLS={
  idf:new URL('../data/ile-de-france-observations.json',import.meta.url),
  vendee:new URL('../data/vendee-observations.json',import.meta.url),
  reunion:new URL('../data/reunion-observations.json',import.meta.url)
};
const MAX_AGE_MINUTES = 100;
const MAX_DISTANCE_KM = 30;
const SAVOIE_DISTANCE_KM = 25;
const QUEBEC_DISTANCE_KM = 45;
const EXTRA_RADIUS={idf:38,vendee:43,reunion:18};
const EXTRA_ALT_SCALE={idf:400,vendee:320,reunion:170};
const EXTRA_DIST_SCALE={idf:13,vendee:16,reunion:7};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const numeric=x=>(x===null||x===undefined||x===''||!Number.isFinite(Number(x)))?null:Number(x);

export function inRhoneArea(location) {
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  // Geographic catchment (Métropole + département + adjacent margins), not an administrative boundary.
  return lat!==null&&lon!==null&&lat>=45.38&&lat<=46.35&&lon>=4.24&&lon<=5.24;
}
export function inSavoieArea(location) {
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  const admin=String(location?.admin2||location?.department||'').toLowerCase();
  const country=String(location?.country_code||location?.countryCode||location?.country||'').toLowerCase();
  if(admin.includes('haute-savoie')||admin.includes('haute savoie'))return false;
  if(country&&country!=='fr'&&country!=='france'&&country!=='french republic')return false;
  // Savoie department + small adjacent geographic margins; not a cadastral boundary.
  return lat!==null&&lon!==null&&lat>=45.05&&lat<=46.06&&lon>=5.52&&lon<=7.28;
}
export function inQuebecArea(location) {
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  const country=String(location?.country_code||location?.countryCode||location?.country||'').toLowerCase();
  if(country&&!['ca','canada'].includes(country))return false;
  return lat!==null&&lon!==null&&lat>=46.35&&lat<=47.45&&lon>=-72.15&&lon<=-70.15;
}
const isFrenchPlace=loc=>{
  const country=String(loc?.country_code||loc?.countryCode||loc?.country||'').toLowerCase();
  return !country||['fr','france','réunion','reunion','la réunion','la reunion'].includes(country);
};
export function inIleDeFranceArea(location){
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  return isFrenchPlace(location)&&lat!==null&&lon!==null&&
    lat>=48.1&&lat<=49.25&&lon>=1.42&&lon<=3.57;
}
export function inVendeeArea(location){
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  return isFrenchPlace(location)&&lat!==null&&lon!==null&&
    lat>=46.22&&lat<=47.18&&lon>=-2.55&&lon<=-0.5;
}
export function inReunionArea(location){
  const lat=numeric(location?.lat),lon=numeric(location?.lon);
  return isFrenchPlace(location)&&lat!==null&&lon!==null&&
    lat>=-21.43&&lat<=-20.85&&lon>=55.18&&lon<=55.89;
}
export function stationDistanceKm(a,b) {
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlon=(b.lon-a.lon)*r;
  const x=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(x)));
}
let cached=null, checkedAt=0;
export async function loadRhoneObservations(fetchImpl=fetch, now=Date.now()) {
  if(cached && now-checkedAt<8*60*1000) return cached;
  checkedAt=now;
  try{
    const res=await fetchImpl(SNAPSHOT_URL.href,{cache:'no-store',signal:AbortSignal.timeout(1700)});
    if(!res.ok) return null;
    const data=await res.json();
    if(!Array.isArray(data?.stations)) return null;
    cached=data;
    return data;
  }catch{return null;}
}
let cachedSavoie=null,checkedSavoieAt=0;
export async function loadSavoieObservations(fetchImpl=fetch,now=Date.now()){
  if(cachedSavoie && now-checkedSavoieAt<8*60*1000)return cachedSavoie;
  checkedSavoieAt=now;
  try{
    const res=await fetchImpl(SAVOIE_SNAPSHOT_URL.href,{
      cache:'no-store',signal:AbortSignal.timeout(1700)
    });
    if(!res.ok)return null;
    const data=await res.json();
    if(!Array.isArray(data?.stations)||data.region!=='savoie')return null;
    cachedSavoie=data;
    return data;
  }catch{return null;}
}
let cachedQuebec=null,checkedQuebecAt=0;
export async function loadQuebecObservations(fetchImpl=fetch,now=Date.now()){
  if(cachedQuebec&&now-checkedQuebecAt<8*60*1000)return cachedQuebec;
  checkedQuebecAt=now;
  try{
    const r=await fetchImpl(QUEBEC_SNAPSHOT_URL.href,{
      cache:'no-store',signal:AbortSignal.timeout(2000)
    });
    if(!r.ok)return null;
    const data=await r.json();
    if(data?.region!=='quebec'||!Array.isArray(data.stations))return null;
    cachedQuebec=data;return data;
  }catch{return null;}
}
const regionalCaches=new Map();
export async function loadExtraRegionObservations(region,fetchImpl=fetch,now=Date.now()){
  const url=EXTRA_URLS[region];
  if(!url)return null;
  const stored=regionalCaches.get(region);
  if(stored&&now-stored.time<8*60*1000)return stored.value;
  try{
    const r=await fetchImpl(url.href,{cache:'no-store',signal:AbortSignal.timeout(2000)});
    if(!r.ok)return null;
    const data=await r.json();
    const expected={idf:'ile-de-france',vendee:'vendee',reunion:'reunion'}[region];
    if(data?.region!==expected||!Array.isArray(data.stations))return null;
    if(fetchImpl===fetch)regionalCaches.set(region,{value:data,time:now});
    return data;
  }catch{return null;}
}
export function eligibleExtraRegionStations(snapshot,location,now=Date.now(),region='idf'){
  if(!EXTRA_URLS[region])return [];
  return eligibleRegionalStations(snapshot,location,now,region);
}
export function eligibleQuebecStations(snapshot,location,now=Date.now()){
  return eligibleRegionalStations(snapshot,location,now,'quebec');
}
export function eligibleRhoneStations(snapshot,location,now=Date.now()){
  return eligibleRegionalStations(snapshot,location,now,'rhone');
}
export function eligibleSavoieStations(snapshot,location,now=Date.now()){
  return eligibleRegionalStations(snapshot,location,now,'savoie');
}
function eligibleRegionalStations(snapshot, location, now, region) {
  const extra={idf:inIleDeFranceArea,vendee:inVendeeArea,reunion:inReunionArea};
  const allowed=extra[region]?extra[region](location):
    region==='savoie'?inSavoieArea(location):
    region==='quebec'?inQuebecArea(location):inRhoneArea(location);
  if(!allowed||!Array.isArray(snapshot?.stations))return [];
  const alpine=region==='savoie',canadian=region==='quebec';
  const target={lat:Number(location.lat),lon:Number(location.lon)};
  return snapshot.stations.flatMap(station=>{
    const lat=numeric(station.lat),lon=numeric(station.lon);
    const temp=numeric(station.temperature),model=numeric(station.modelTemperature);
    const age=now-Date.parse(station.measuredAt||'');
    if(lat===null||lon===null||temp===null||model===null||
       !Number.isFinite(age)||age< -5*60*1000||age>MAX_AGE_MINUTES*60*1000||
       temp < -42||temp > 48||Math.abs(temp-model)>7) return [];
    const distance=stationDistanceKm(target,{lat,lon});
    if(distance>(EXTRA_RADIUS[region]??(alpine?SAVOIE_DISTANCE_KM:canadian?QUEBEC_DISTANCE_KM:MAX_DISTANCE_KM)))return [];
    const alt=numeric(station.elevation),targetAlt=numeric(location.elevation);
    const elevationDiff=alt!==null&&targetAlt!==null?Math.abs(alt-targetAlt):null;
    // Unknown altitude -> lower confidence. Large relief contrast -> much lower confidence.
    const altitudeFactor=elevationDiff!==null?Math.exp(-elevationDiff/(EXTRA_ALT_SCALE[region]??(alpine?250:canadian?320:360))):(alpine?0.3:region==='reunion'?0.2:0.55);
    const distanceFactor=Math.exp(-distance/(EXTRA_DIST_SCALE[region]??(alpine?9:canadian?13:11)));
    const ageFactor=clamp(1-age/(MAX_AGE_MINUTES*60*1000),0,1);
    const sourceFactor=station.source==='Météo-France'?1.55:station.source==='Grand Lyon / Météo-France'?1.25:station.source==='Environnement Canada (SWOB)'?1.5:station.source==='RSCQ Québec'?1.4:station.source==='METAR aviation'?1.15:0.8;
    const weight=distanceFactor*altitudeFactor*(0.45+0.55*ageFactor)*sourceFactor;
    if(weight<(alpine||region==='reunion'?0.035:0.025)) return [];
    return [{...station,lat,lon,temperature:temp,modelTemperature:model,
      distance,age,elevationDiff,weight,residual:temp-model}];
  }).sort((a,b)=>b.weight-a.weight).slice(0,12);
}
function forecastEpoch(wallTime,utcOffset) {
  const ms=Date.parse(String(wallTime||'')+'Z');
  return Number.isFinite(ms)?ms-(numeric(utcOffset)||0)*1000:null;
}
function updateNumber(array,index,delta) {
  if(!Array.isArray(array)) return;
  const val=numeric(array[index]);
  if(val!==null)array[index]=val+delta;
}
function updateDailyTemperature(base) {
  for(let i=0;i<(base.daily?.time?.length||0);i++){
    const date=base.daily.time[i];
    const hours=(base.hourly?.time||[]).flatMap((time,j)=>time.startsWith(date)?[j]:[]);
    if(!hours.length)continue;
    const pairs=[['temperature_2m','temperature_2m_max','temperature_2m_min'],
      ['apparent_temperature','apparent_temperature_max','apparent_temperature_min']];
    for(const [source,max,min] of pairs){
      const values=hours.map(j=>numeric(base.hourly[source]?.[j])).filter(x=>x!==null);
      if(!values.length)continue;
      if(base.daily[max])base.daily[max][i]=Math.max(...values);
      if(base.daily[min])base.daily[min][i]=Math.min(...values);
    }
  }
}
/**
 * Assimilate *temperature anomalies*, not raw station temperatures:
 * station obs minus co-located Open-Meteo estimate, adjusted by distance,
 * topographic altitude mismatch, freshness and horizon.
 * Snow quantities/precipitation stay untouched; no invented observation for
 * a village without a station. No long-range bias claims.
 */
export function applyExtraRegionObservations(base,location,snapshot,now=Date.now(),region='idf'){
  if(!EXTRA_URLS[region])return null;
  return applyRegionalObservations(base,location,snapshot,now,region);
}
export function applyQuebecObservations(base,location,snapshot,now=Date.now()){
  return applyRegionalObservations(base,location,snapshot,now,'quebec');
}
export function applyRhoneObservations(base,location,snapshot,now=Date.now()) {
  return applyRegionalObservations(base,location,snapshot,now,'rhone');
}
export function applySavoieObservations(base,location,snapshot,now=Date.now()) {
  return applyRegionalObservations(base,location,snapshot,now,'savoie');
}
function applyRegionalObservations(base,location,snapshot,now,region) {
  const stations=EXTRA_URLS[region]?eligibleExtraRegionStations(snapshot,location,now,region):
    region==='savoie'?eligibleSavoieStations(snapshot,location,now):
    region==='quebec'?eligibleQuebecStations(snapshot,location,now):
      eligibleRhoneStations(snapshot,location,now);
  if(!stations.length || !base?.hourly?.time?.length) return null;
  const total=stations.reduce((n,s)=>n+s.weight,0);
  if(total<=0)return null;
  const bias=clamp(stations.reduce((n,s)=>n+s.residual*s.weight,0)/total,
    region==='rhone'?-3.5:-2.5,region==='rhone'?3.5:2.5);
  const lead=stations[0];
  // High confidence only for a station almost exactly at the target site.
  const direct=lead.distance<=(region==='rhone'?0.75:0.35)&&(lead.elevationDiff===null?false:lead.elevationDiff<=(region==='rhone'?60:30))
    && Math.abs(lead.residual)<=5;
  const localityFactor=direct?1:clamp(total/(total+0.25),0.15,0.87);
  const correction=bias*localityFactor;
  if(Math.abs(correction)<0.05&&!direct)return null;
  const attenuation=hours=>hours<=0?1:hours>=30?0:Math.max(0,(1-hours/30)**1.6);
  let adjusted=0;
  const dateNow=new Date(now);
  for(let i=0;i<base.hourly.time.length;i++){
    const epoch=forecastEpoch(base.hourly.time[i],base.utc_offset_seconds);
    if(epoch===null)continue;
    const hours=(epoch-now)/3600000;
    if(hours < -1.5||hours>30)continue;
    const delta=correction*attenuation(hours);
    if(!delta)continue;
    updateNumber(base.hourly.temperature_2m,i,delta);
    updateNumber(base.hourly.apparent_temperature,i,delta);
    updateNumber(base.hourly.wet_bulb_temperature_2m,i,delta);
    // Temperature-linked freezing level guidance; bounded local change.
    updateNumber(base.hourly.freezing_level_height,i,delta*115);
    adjusted++;
  }
  const currentEpoch=forecastEpoch(base.current?.time,base.utc_offset_seconds);
  const currentHours=currentEpoch!==null?(currentEpoch-now)/3600000:0;
  const delta=correction*attenuation(currentHours);
  if(base.current && Math.abs(currentHours)<2){
    const currentTemp=numeric(base.current.temperature_2m);
    if(currentTemp!==null){
      const newTemp=direct?lead.temperature:currentTemp+delta;
      const effectiveDelta=newTemp-currentTemp;
      base.current.temperature_2m=newTemp;
      if(numeric(base.current.apparent_temperature)!==null)
        base.current.apparent_temperature+=effectiveDelta;
    }
  }
  if(!adjusted&&!base.current)return null;
  updateDailyTemperature(base);
  base.localObservation={
    applied:true,direct,region,sourceCount:stations.length,
    station:lead.name||'Station locale',stationSource:lead.source,
    measuredAt:lead.measuredAt,nearestKm:Math.round(lead.distance*10)/10,
    correction:Math.round(correction*10)/10,
    observationTemperature:lead.temperature,
    note:'Correction courte échéance du modèle par anomalies observées aux stations proches.'
  };
  return base.localObservation;
}
