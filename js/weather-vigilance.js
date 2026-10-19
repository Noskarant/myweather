// MyWeather vigilance: local model-based hazards + optional verified official feed.
// The local color is an indicative risk estimate, never an official Météo-France level.
export const HAZARDS = Object.freeze({
  rain:{name:'Pluie intense',icon:'☔',rank:5},
  thunder:{name:'Orages',icon:'⚡',rank:8},
  hail:{name:'Grêle',icon:'◈',rank:9},
  snow:{name:'Neige',icon:'❄',rank:6},
  ice:{name:'Verglas',icon:'◇',rank:7},
  wind:{name:'Vent violent',icon:'≋',rank:4},
  heat:{name:'Chaleur',icon:'☀',rank:2},
  cold:{name:'Grand froid',icon:'◌',rank:3},
  flood:{name:'Crues',icon:'≈',rank:8},
  avalanche:{name:'Avalanches',icon:'△',rank:9},
  coast:{name:'Vagues-submersion',icon:'≈',rank:7}
});
export const VIGILANCE_LEVELS=['Vert','Jaune','Orange','Rouge'];
const MF_PHENOMENA={'1':'wind','2':'rain','3':'thunder','4':'flood','5':'snow','6':'heat','7':'cold','8':'avalanche','9':'coast'};
const WMO_THUNDER=new Set([95,96,99]);
const WMO_HAIL=new Set([96,99]);
const WMO_SNOW=new Set([71,73,75,77,85,86]);
const numeric=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const positive=value=>Math.max(0,numeric(value)||0);
const max=(items)=>items.length?Math.max(...items):0;
const dayLocal=(instant,offset)=>new Date(instant+offset*1000).toISOString().slice(0,10);
const nextDate=(date)=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const rounded=(v,unit)=>((v<10?v.toFixed(1):Math.round(v).toString()).replace('.',','))+' '+unit;
const level=(v,edges)=>v>=edges[2]?3:v>=edges[1]?2:v>=edges[0]?1:0;
const getCode=h=>numeric(h.weather_code??h.display_weather_code)||0;
const rankRisk=(a,b)=>b.level-a.level||((HAZARDS[b.kind]?.rank||0)-(HAZARDS[a.kind]?.rank||0));

export function parseOfficialSnapshot(payload,now=Date.now()){
  // Consumes only the public, sanitized build artifact, not the raw API response.
  const issued=Date.parse(payload?.updatedAt||'');
  if(payload?.schema!==1||!Array.isArray(payload.days)||!Number.isFinite(issued)
    ||issued>now+15*60000||now-issued>14*3600000)return null;
  return payload;
}
export function officialForDay(snapshot,department,date){
  if(!snapshot||!department||!date)return [];
  const data=snapshot.days.find(day=>day.date===date)?.departments?.[String(department)];
  if(!Array.isArray(data))return [];
  return data.filter(item=>HAZARDS[item?.kind]&&Number.isInteger(item.level)&&item.level>=1&&item.level<=3)
    .map(item=>({kind:item.kind,level:item.level,source:'Météo-France',detail:'Vigilance officielle départementale',official:true}));
}
export function computeDayHazards(hours,location={},date=''){
  if(!Array.isArray(hours)||!hours.length)return [];
  const rows=hours.filter(h=>h&&typeof h.time==='string'&&h.time.startsWith(date));
  if(!rows.length)return [];
  const risks=[];
  const elevation=Number.isFinite(Number(location.elevation))?Number(location.elevation):0;
  const hourlyRain=rows.map(h=>{
    const rain=numeric(h.rain),showers=numeric(h.showers);
    if(rain!==null||showers!==null)return positive(rain)+positive(showers);
    // Total precipitation includes snowfall: never call that entire amount rain.
    return WMO_SNOW.has(getCode(h))||positive(h.snowfall)>0?0:positive(h.precipitation);
  });
  const rain24=hourlyRain.reduce((a,b)=>a+b,0);
  const rain1=max(hourlyRain),rain3=max(hourlyRain.map((_,i)=>hourlyRain.slice(i,i+3).reduce((a,b)=>a+b,0)));
  const snow=rows.reduce((s,h)=>s+positive(h.snowfall),0);
  const snowHour=max(rows.map(h=>positive(h.snowfall)));
  const gust=max(rows.map(h=>positive(h.wind_gusts_10m)));
  const temps=rows.map(h=>numeric(h.temperature_2m)).filter(v=>v!==null);
  const minT=temps.length?Math.min(...temps):null,maxT=temps.length?Math.max(...temps):null;
  const thunders=rows.filter(h=>WMO_THUNDER.has(getCode(h)));
  const capes=rows.map(h=>positive(h.cape));
  const highCape=max(capes);
  const hails=rows.filter(h=>WMO_HAIL.has(getCode(h)));
  const isMountain=elevation>=1200;
  function add(kind,severity,detail,quantity){
    if(severity>0)risks.push({kind,level:severity,detail,quantity,source:'Modèles MyWeather',official:false});
  }
  const rainSeverity=Math.max(level(rain24,[20,50,100]),level(rain3,[15,35,70]),level(rain1,[9,20,40]));
  add('rain',rainSeverity,'Cumul et intensité des pluies modélisés sur la journée',rounded(rain24,'mm')+' · pic '+rounded(rain1,'mm/h'));
  const stormSeverity=thunders.length
    ? (thunders.some(h=>getCode(h)===99)&&highCape>=900?3:thunders.length>=3||highCape>=600?2:1)
    : (highCape>=1500&&rain1>=7?1:0);
  add('thunder',stormSeverity,thunders.length?'Orages explicitement prévus par le modèle':'Instabilité et fortes précipitations : orages localisés possibles',highCape?Math.round(highCape)+' J/kg de CAPE':'Signal orageux');
  // No hail forecast without a dedicated WMO hail code. High CAPE alone is insufficient.
  add('hail',hails.length?(hails.some(h=>getCode(h)===99)&&highCape>=800?2:1):0,
    'Code météo signalant des orages avec grêle ; taille des grêlons inconnue','Grêle possible (quantité non disponible)');
  const snowSeverity=Math.max(level(snow,isMountain?[15,40,80]:[3,12,30]),level(snowHour,isMountain?[5,12,25]:[2,5,12]));
  add('snow',snowSeverity,isMountain?'Chutes prévues en altitude, impact local non assimilable à celui d’une plaine':'Neige fraîche susceptible de perturber les déplacements',rounded(snow,'cm')+' · pic '+rounded(snowHour,'cm/h'));
  const icy=rows.some(h=>{const t=numeric(h.temperature_2m),wet=numeric(h.wet_bulb_temperature_2m);return t!==null&&t<=1.5&&wet!==null&&wet<=0.5&&positive(h.precipitation)>0.15;});
  add('ice',icy?(minT!==null&&minT<=-2&&rain1>=2?2:1):0,'Risque indicatif de chaussées glissantes, pas une détection du verglas',minT===null?'Température inconnue':'Minimum '+rounded(minT,'°C'));
  add('wind',level(gust,[70,105,145]),'Rafales prévues localement, exposition et relief non intégrés',Math.round(gust)+' km/h');
  if(maxT!==null)add('heat',level(maxT,[35,39,43]),'Température maximale prévue ; risque sanitaire non expertisé',rounded(maxT,'°C'));
  if(minT!==null)add('cold',level(-minT,[10,18,26]),'Température minimale prévue ; risque sanitaire non expertisé',rounded(minT,'°C'));
  return risks.sort(rankRisk);
}
export function buildVigilance(forecast,location,officialSnapshot=null,department=null,now=Date.now()){
  const offset=numeric(forecast?.utc_offset_seconds)||0;
  const today=dayLocal(now,offset),tomorrow=nextDate(today);
  // A day is evaluated on the remaining hours only; future days use their full day.
  const localHour=new Date(now+offset*1000).toISOString().slice(0,13);
  const remaining=(forecast?.hourly||[]).filter(h=>h?.time?.slice(0,13)>=localHour);
  const official=parseOfficialSnapshot(officialSnapshot,now);
  const summarize=date=>{
    const estimated=computeDayHazards(remaining,location,date);
    const alerts=officialForDay(official,department,date);
    const merged=estimated.map(item=>{
      const match=alerts.find(o=>o.kind===item.kind);
      return match&&match.level>=item.level?{...item,level:match.level,official:true,source:'Météo-France + modèles MyWeather',
        detail:item.detail+' · Niveau départemental officiel : '+VIGILANCE_LEVELS[match.level]}:item;
    });
    for(const item of alerts)if(!merged.some(r=>r.kind===item.kind))merged.push(item);
    merged.sort(rankRisk);
    return {date,items:merged,level:max(merged.map(r=>r.level)),primary:merged[0]||null,
      official:alerts.length>0,hasHours:remaining.some(h=>h?.time?.slice(0,10)===date)};
  };
  const current=summarize(today),future=summarize(tomorrow);
  // Tomorrow-only risks are announced, never described as already active.
  const ahead=future.level>current.level;
  const display=ahead?future:current;
  const tomorrowMessage=future.level>0 && (future.level>=2||future.level>current.level)
    ? 'Demain : risque '+VIGILANCE_LEVELS[future.level].toLowerCase()+' — '+(future.primary?HAZARDS[future.primary.kind].name.toLowerCase():'conditions à surveiller')+'.'
    : null;
  return {today:current,tomorrow:future,displayLevel:display.level,displayDay:ahead?'tomorrow':'today',
    primary:display.primary,tomorrowMessage,hasOfficial:Boolean(official&&department),isEstimate:!(display.primary?.official)};
}
// Official feed is produced by a GitHub Actions job with a private OAuth token.
// A missing, unavailable or stale feed is never converted to an all-green official forecast.
let snapshotPromise=null,snapshotTime=0;
export async function fetchVigilanceSnapshot(now=Date.now(),fetcher=fetch){
  if(snapshotPromise&&now-snapshotTime<20*60000)return snapshotPromise;
  snapshotTime=now;
  snapshotPromise=(async()=>{
    try{
      const response=await fetcher('./data/vigilance.json?v=1.8.26',{cache:'no-store',signal:AbortSignal.timeout(3600)});
      if(!response.ok)return null;
      return parseOfficialSnapshot(await response.json(),Date.now());
    }catch{return null;}
  })();
  return snapshotPromise;
}
export async function resolveFrenchDepartment(location,fetcher=fetch){
  if(!location||!Number.isFinite(Number(location.lat))||!Number.isFinite(Number(location.lon))
    ||!(/france|réunion|reunion|guadeloupe|martinique|guyane|mayotte/i).test(String(location.country||'')))return null;
  try{
    const url='https://geo.api.gouv.fr/communes?lat='+encodeURIComponent(location.lat)+'&lon='+encodeURIComponent(location.lon)+'&fields=codeDepartement&format=json';
    const response=await fetcher(url,{signal:AbortSignal.timeout(3200)});
    if(!response.ok)return null;
    const list=await response.json();
    const dep=Array.isArray(list)&&list[0]?.codeDepartement;
    return typeof dep==='string'&&/^(?:\d{2,3}|2A|2B)$/.test(dep)?dep:null;
  }catch{return null;}
}
