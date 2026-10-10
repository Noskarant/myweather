// Prochaines heures — guidance from forecasts, not raw radar reflectivity.
// Input: Open-Meteo 15-minute precipitation / snowfall (cm) where available;
// otherwise existing hourly forecast worldwide. Sunrise/sunset prevent a
// night-time clear sky from being described as "the sun is arriving".
const finite=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))
  ?null:Number(v);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const WMO_SNOW=new Set([71,73,75,77,85,86]);
const stepEpoch=(time,offset=0)=>{
  if(typeof time!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(time))return null;
  const ms=Date.parse(time+'Z')-(finite(offset)||0)*1000;
  return Number.isFinite(ms)?ms:null;
};
const number=v=>Math.max(0,finite(v)??0);
function classify(entry,minutes){
  const amount=finite(entry.precipitation);
  const snow=finite(entry.snowfall);
  const rain=finite(entry.rain);
  const snowLikely=snow!==null&&snow>=(minutes===15?0.08:0.15);
  const validWet=amount!==null&&amount>=(minutes===15?0.08:0.16);
  const code=finite(entry.weather_code);
  const snowFlag=snowLikely||validWet&&WMO_SNOW.has(code);
  const rainLikely=!snowFlag&&(rain!==null?rain>=(minutes===15?0.07:0.14):validWet);
  return {
    snow:snowFlag,rain:rainLikely,wet:snowFlag||rainLikely,
    snowAmount:snow===null?null:number(snow),
    rainAmount:rain!==null?number(rain):snowFlag?0:amount!==null?number(amount):null
  };
}
const phaseName=kind=>kind==='snow'?'neige':'pluie';
const whenText=(mins,stepMinutes)=>{
  if(mins<=15)return 'très bientôt';
  const rounded=stepMinutes===15?Math.round(mins/15)*15:Math.round(mins/60)*60;
  if(rounded<60)return 'dans environ '+rounded+' min';
  const h=Math.floor(rounded/60),m=rounded%60;
  return 'dans environ '+h+' h'+(m?' '+String(m).padStart(2,'0'):'');
};
function makeSteps(forecast,now){
  const tz=finite(forecast?.utc_offset_seconds)||0;
  const raw=forecast?.minutely_15;
  const records=Array.isArray(raw?.time)?raw.time.flatMap((time,i)=>{
    const epoch=stepEpoch(time,tz);
    if(epoch===null||epoch<now-10*60_000||epoch>now+12*3600_000)return [];
    const obj={};
    for(const k of ['precipitation','rain','snowfall','weather_code'])
      obj[k]=raw[k]?.[i]??null;
    return [{time,epoch,minutes:15,...classify(obj,15)}];
  }):[];
  // Minimum 2h of genuine 15-minute slots; otherwise stay with hourly source.
  if(records.length>=8&&records.some(s=>s.rainAmount!==null||s.snowAmount!==null))
    return {steps:records,source:'quarter-hour',resolution:15};
  const hourly=Array.isArray(forecast?.hourly)?forecast.hourly:[];
  const steps=hourly.flatMap(h=>{
    const epoch=stepEpoch(h.time,tz);
    if(epoch===null||epoch<now-25*60_000||epoch>now+12*3600_000)return [];
    return [{time:h.time,epoch,minutes:60,...classify(h,60)}];
  });
  return {steps,source:'hourly',resolution:60};
}
function firstReliableStart(steps,kind,resolution){
  const need=resolution===15?2:1;
  const horizon=6*3600_000;
  const first=steps[0]?.epoch??0;
  for(let i=0;i<steps.length;i++){
    if(steps[i].epoch-first>horizon)break;
    if(!steps[i][kind])continue;
    const streak=steps.slice(i,i+need);
    if(streak.length===need&&streak.every((s,j)=>s[kind]&&(j===0||s.epoch-streak[j-1].epoch<=resolution*60000+1000)))
      return steps[i];
  }
  return null;
}
function finishWhen(steps,kind,resolution){
  // Require at least two consecutive dry 15m intervals after the wet period.
  const need=resolution===15?3:2;
  const first=steps[0]?.epoch??0;
  let hadWet=false;
  for(let i=0;i<steps.length;i++){
    if(steps[i].epoch-first>6*3600_000)break;
    if(steps[i][kind])hadWet=true;
    if(!hadWet||steps[i][kind])continue;
    const dry=steps.slice(i,i+need);
    if(dry.length===need&&dry.every((s,j)=>!s[kind]&&(j===0||s.epoch-dry[j-1].epoch<=resolution*60000+1000)))
      return steps[i];
  }
  return null;
}
function sunReturn(forecast,now){
  const h=Array.isArray(forecast?.hourly)?forecast.hourly:[];
  const tz=finite(forecast?.utc_offset_seconds)||0;
  const days=Array.isArray(forecast?.daily)?forecast.daily:[];
  const currentCloud=finite(forecast?.current?.cloud_cover)??finite(h[0]?.cloud_cover);
  const currentP=finite(forecast?.current?.precipitation)??0;
  if((currentCloud===null||currentCloud<67)&&currentP<0.15)return null;
  for(let i=0;i<h.length-1;i++){
    const point=h[i],next=h[i+1],epoch=stepEpoch(point.time,tz);
    if(epoch===null||epoch<=now+35*60_000||epoch>now+9*3600_000)continue;
    const day=days.find(d=>d.time===point.time.slice(0,10));
    if(!day?.sunrise||!day?.sunset)continue;
    const rise=stepEpoch(day.sunrise,tz),set=stepEpoch(day.sunset,tz);
    if(rise===null||set===null||epoch<rise+20*60_000||epoch>=set-25*60_000)continue;
    const clear=x=>{
      const cloud=finite(x.cloud_cover),rain=finite(x.precipitation);
      return cloud!==null&&cloud<=40&&rain!==null&&rain<0.15&&
        [0,1,2].includes(finite(x.weather_code));
    };
    if(clear(point)&&clear(next)&&stepEpoch(next.time,tz)<set)
      return {epoch,minutes:(epoch-now)/60000};
  }
  return null;
}
function quantityLabel(q,unit){
  return q<0.1?'moins de 0,1 '+unit:
    (q<10?q.toFixed(1):Math.round(q).toString()).replace('.',',')+' '+unit;
}
/**
 * Pure, independently testable nowcast summary.
 * Items have a priority order and are guidance, not guarantees or live radar.
 */
export function buildNextHoursMessages(forecast,now=Date.now()){
  const {steps,source,resolution}=makeSteps(forecast,now);
  if(!steps.length)return {items:[],source:'unavailable',resolution:60};
  const first=steps.find(x=>x.epoch>=now-10*60_000);
  const current=forecast.current||{};
  const currentClass=classify(current,15);
  const started={snow:currentClass.snow,rain:currentClass.rain};
  // Hourly timestamps represent interval ends: if model now reports wet,
  // the cessation can be projected but never announced from a single dry slot.
  const items=[];
  for(const kind of ['snow','rain']){
    const start=started[kind]?null:firstReliableStart(steps,kind,resolution);
    const finish=started[kind]?finishWhen(steps,kind,resolution):null;
    if(start){
      const mins=(start.epoch-now)/60_000;
      items.push({
        kind,priority:kind==='snow'?1:2,epoch:start.epoch,
        text:(kind==='snow'?'La neige':'La pluie')+' devrait arriver '+whenText(mins,resolution)+'.'
      });
    }else if(finish){
      const mins=(finish.epoch-now)/60_000;
      items.push({
        kind,priority:kind==='snow'?1:2,epoch:finish.epoch,
        text:(kind==='snow'?'La neige':'La pluie')+' devrait s’arrêter '+whenText(mins,resolution)+'.'
      });
    }
  }
  const sunshine=sunReturn(forecast,now);
  if(sunshine)items.push({kind:'sun',priority:3,epoch:sunshine.epoch,
    text:'Le soleil devrait revenir '+whenText(sunshine.minutes,60)+'.'});
  // Precip amounts in mm liquid rain and cm fresh snow: never combine units.
  // A bucket is the preceding 15/60 minutes: only complete future periods count.
  const totals=steps.filter(s=>s.epoch>now&&s.epoch<=now+3*3600_000);
  const rain=totals.reduce((n,s)=>n+number(s.rainAmount),0);
  const snow=totals.reduce((n,s)=>n+number(s.snowAmount),0);
  if(snow>=0.25)items.push({kind:'snow-total',priority:4,
    text:'Neige fraîche estimée sur 3 h : '+quantityLabel(snow,'cm')+'.'});
  if(rain>=0.3)items.push({kind:'rain-total',priority:5,
    text:'Pluie estimée sur 3 h : '+quantityLabel(rain,'mm')+'.'});
  items.sort((a,b)=>a.priority-b.priority);
  if(!items.length){
    const next=steps.filter(s=>s.epoch>=now&&s.epoch<=now+6*3600_000);
    if(next.length)items.push({kind:'calm',priority:6,
      text:'Pas de pluie ni de neige significative prévue dans les 6 prochaines heures.'});
  }
  return {items:items.slice(0,3),source,resolution,radarUsed:false};
}
