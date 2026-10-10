// Useful, conservative short-term forecast guidance for every locality.
// Open-Meteo 15-minute and hourly models can disagree: small hourly showers
// must not be erased by a dry-looking 15-minute interpolated forecast.
// This is NOT a prediction derived from live radar imagery.
const finite=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const WMO_SNOW=new Set([71,73,75,77,85,86]);
const WMO_RAIN=new Set([51,53,55,56,57,61,63,65,66,67,80,81,82]);
const WMO_SHOWERS=new Set([80,81,82]);
const WMO_THUNDER=new Set([95,96,99]);
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const positive=v=>Math.max(0,finite(v)??0);
function epoch(time,offset=0){
  if(typeof time!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(time))return null;
  const ms=Date.parse(time+'Z')-(finite(offset)||0)*1000;
  return Number.isFinite(ms)?ms:null;
}
function classify(row,minutes){
  const amount=finite(row?.precipitation);
  const rain=finite(row?.rain),showers=finite(row?.showers);
  const snow=finite(row?.snowfall),code=finite(row?.weather_code);
  const threshold=minutes===15?0.012:0.035;
  const wet=positive(amount)>=threshold||positive(rain)>=threshold||
    positive(showers)>=threshold;
  const snowFlag=positive(snow)>=(minutes===15?.012:.035)||
    (WMO_SNOW.has(code)&&wet);
  const thunder=WMO_THUNDER.has(code)&&(wet||
    (finite(row?.precipitation_probability)??0)>=30);
  const raining=!snowFlag&&(wet||
    (WMO_RAIN.has(code)&&((finite(row?.precipitation_probability)??0)>=25)));
  const rainAmount=snowFlag?0:rain!==null?positive(rain)+positive(showers):
    amount!==null?positive(amount):showers!==null?positive(showers):null;
  const mmPerHour=(Math.max(positive(amount),positive(rain)+positive(showers)))*60/minutes;
  return {
    rain:raining,snow:snowFlag,thunder,
    showers:raining&&(WMO_SHOWERS.has(code)||positive(showers)>=threshold),
    weak:mmPerHour<0.7,
    wet:raining||snowFlag||thunder,
    chance:finite(row?.precipitation_probability),
    known:amount!==null||rain!==null||showers!==null||snow!==null,
    rainAmount,snowAmount:snow!==null?positive(snow):null
  };
}
function makeSteps(raw,minutes,now,offset,probabilities){
  if(!Array.isArray(raw?.time))return [];
  return raw.time.flatMap((time,i)=>{
    const stamp=epoch(time,offset);
    if(stamp===null||stamp<now-75*60_000||stamp>now+12*3600_000)return [];
    const row={};
    for(const key of ['precipitation','rain','showers','snowfall','weather_code',
      'precipitation_probability','cloud_cover','cape'])
      row[key]=Array.isArray(raw[key])?raw[key][i]:null;
    const hour=time.slice(0,13);
    if(row.precipitation_probability===null&&probabilities.has(hour))
      row.precipitation_probability=probabilities.get(hour);
    return {time,epoch:stamp,minutes,...classify(row,minutes)};
  });
}
function chooseSteps(forecast,now){
  const off=finite(forecast?.utc_offset_seconds)||0;
  const hours=Array.isArray(forecast?.hourly)?forecast.hourly:[];
  const hourly=hours.flatMap(row=>{
    const stamp=epoch(row.time,off);
    if(stamp===null||stamp<now-75*60_000||stamp>now+12*3600_000)return [];
    return [{time:row.time,epoch:stamp,minutes:60,...classify(row,60)}];
  });
  const probability=new Map(hours.filter(h=>finite(h.precipitation_probability)!==null)
    .map(h=>[String(h.time).slice(0,13),finite(h.precipitation_probability)]));
  const quarter=makeSteps(forecast?.minutely_15,15,now,off,probability);
  return {quarter:quarter.length>=8?quarter:[],hourly};
}
function startOf(steps,kind,now,horizon=6*3600_000){
  const candidates=steps.filter(s=>s.epoch>=now-12*60000&&s.epoch<=now+horizon);
  for(let i=0;i<candidates.length;i++){
    const s=candidates[i];
    if(!s[kind]||!s.known)continue;
    const prev=candidates[i-1];
    // An ongoing wet streak is not a new incoming event.
    if(prev&&prev[kind]&&s.epoch-prev.epoch<=s.minutes*60_000+1000)continue;
    return s;
  }
  return null;
}
function endOf(steps,kind,now,startedNow=false){
  const future=steps.filter(s=>s.epoch>=now-12*60_000&&s.epoch<=now+6*3600_000);
  let sawWet=startedNow;
  for(let i=0;i<future.length;i++){
    const s=future[i];
    if(s[kind]){sawWet=true;continue;}
    if(!sawWet||!s.known)continue;
    const need=s.minutes===15?2:2;
    const clear=future.slice(i,i+need);
    if(clear.length===need&&clear.every((x,j)=>x.known&&!x[kind]&&
      (j===0||x.epoch-clear[j-1].epoch<=s.minutes*60_000+1000)))return s;
  }
  return null;
}
function whenText(step,now){
  const mins=(step.epoch-now)/60000;
  if(mins<=16)return 'très bientôt';
  if(step.minutes===60){
    const h=Number(step.time.slice(11,13));
    if(Number.isFinite(h))return 'vers '+h+' h';
  }
  const rounded=Math.max(15,Math.round(mins/15)*15);
  if(rounded<60)return 'dans environ '+rounded+' min';
  const hrs=Math.floor(rounded/60),rest=rounded%60;
  return 'dans environ '+hrs+' h'+(rest?' '+String(rest).padStart(2,'0'):'');
}
const lowConfidence=step=>step?.chance!==null&&step?.chance<35;
function eventName(step,kind){
  if(kind==='thunder')return 'Des averses orageuses';
  if(kind==='snow')return step.weak?'Quelques flocons':'De la neige';
  if(step.showers)return step.weak?'De petites averses':'Des averses';
  return step.weak?'De la pluie fine':'De la pluie';
}
function eventArrival(step,kind,now,conflict=false){
  const cautious=conflict||lowConfidence(step);
  const label=eventName(step,kind);
  const adverb=cautious?'pourraient':'devraient';
  // Keep idiomatic grammar: "De la pluie fine pourrait arriver".
  const singular=kind==='rain'&&!step.showers||kind==='snow'&&!step.weak;
  const modal=singular?(cautious?'pourrait':'devrait'):adverb;
  return label+' '+modal+' arriver '+whenText(step,now)+'.';
}
function eventStop(step,kind,now){
  const label=kind==='snow'?'La neige':'La pluie';
  return label+' pourrait s’arrêter '+whenText(step,now)+'.';
}
function chooseEvent(quarter,hourly,kind,now){
  const q=startOf(quarter,kind,now),h=startOf(hourly,kind,now);
  if(!q)return h?{step:h,source:'hourly',conflict:quarter.length>0}:null;
  if(!h)return {step:q,source:'quarter-hour',conflict:false};
  // If the short-interval signal contradicts the hourly model, still report
  // the light/hourly risk, but use "could" rather than "will".
  if(h.epoch+30*60000<q.epoch)return {step:h,source:'hourly',conflict:true};
  return {step:q,source:'quarter-hour',conflict:false};
}
function sunReturn(forecast,now){
  const hours=Array.isArray(forecast?.hourly)?forecast.hourly:[];
  const days=Array.isArray(forecast?.daily)?forecast.daily:[];
  const offset=finite(forecast?.utc_offset_seconds)||0;
  const currentCloud=finite(forecast?.current?.cloud_cover);
  const currentWet=classify(forecast?.current||{},15).wet;
  if((currentCloud===null||currentCloud<65)&&!currentWet){
    const soonBad=hours.some(h=>{
      const t=epoch(h.time,offset);
      return t!==null&&t>=now&&t<now+2*3600_000&&
        (classify(h,60).wet||(finite(h.cloud_cover)??0)>=75);
    });
    if(!soonBad)return null;
  }
  let beforeWasBad=currentWet||(currentCloud??0)>=65;
  for(let i=0;i<hours.length-1;i++){
    const h=hours[i],n=hours[i+1],t=epoch(h.time,offset);
    if(t===null||t<now-20*60000||t>now+9*3600_000)continue;
    const cloud=finite(h.cloud_cover);
    if(classify(h,60).wet||(cloud!==null&&cloud>=65))beforeWasBad=true;
    if(t<now+35*60000||!beforeWasBad)continue;
    const day=days.find(d=>d.time===h.time.slice(0,10));
    const rise=epoch(day?.sunrise,offset),set=epoch(day?.sunset,offset);
    if(rise===null||set===null||t<rise+20*60000||t>=set-25*60000)continue;
    const clear=x=>{
      const c=finite(x.cloud_cover),p=finite(x.precipitation);
      return c!==null&&c<=45&&!classify(x,60).wet&&(p===null||p<.08)&&
        [0,1,2].includes(finite(x.weather_code));
    };
    const tn=epoch(n.time,offset);
    if(clear(h)&&clear(n)&&tn!==null&&tn<set)return {epoch:t,time:h.time,minutes:60};
  }
  return null;
}
const printAmount=(amount,unit)=>amount<.1?'moins de 0,1 '+unit:
  (amount<10?amount.toFixed(1):Math.round(amount).toString()).replace('.',',')+' '+unit;
/**
 * Only output ACTIONABLE forecasts; a completely dry forecast returns [] and
 * the compact UI disappears (including its radar shortcut). Live radar is
 * accessible separately in the existing Maps section.
 */
export function buildNextHoursMessages(forecast,now=Date.now()){
  const {quarter,hourly}=chooseSteps(forecast,now);
  const source=quarter.length?'quarter-hour':hourly.length?'hourly':'unavailable';
  const resolution=quarter.length?15:60;
  if(!quarter.length&&!hourly.length)return {items:[],source:'unavailable',resolution:60,radarUsed:false};
  const current=classify(forecast?.current||{},15);
  const items=[];
  let containsHourlyContradiction=false;
  for(const kind of ['thunder','snow','rain']){
    if(current[kind]){
      const future=quarter.length?quarter:hourly;
      const finish=endOf(future,kind,now,true);
      if(finish && kind!=='thunder')items.push({kind,priority:kind==='snow'?2:3,
        epoch:finish.epoch,text:eventStop(finish,kind,now)});
      continue;
    }
    const found=chooseEvent(quarter,hourly,kind,now);
    if(found){
      const {step,conflict}=found;
      const text=eventArrival(step,kind,now,conflict);
      if(conflict)containsHourlyContradiction=true;
      items.push({kind,priority:kind==='thunder'?1:kind==='snow'?2:3,
        epoch:step.epoch,text});
    }
  }
  // Avoid redundant "rain arriving" if thunderstorm is the same shower.
  const storm=items.find(i=>i.kind==='thunder');
  if(storm)for(let i=items.length-1;i>=0;i--)
    if(items[i].kind==='rain'&&Math.abs((items[i].epoch||0)-(storm.epoch||0))<65*60000)
      items.splice(i,1);
  const clearing=sunReturn(forecast,now);
  if(clearing)items.push({kind:'sun',priority:4,epoch:clearing.epoch,
    text:'Le soleil pourrait revenir '+whenText(clearing,now)+'.'});
  const takeRain=s=>s.rainAmount===null?0:s.rainAmount;
  const future=quarter.length?quarter:hourly;
  const totals=future.filter(s=>s.epoch>now&&s.epoch<=now+3*3600_000);
  let rain=totals.reduce((a,s)=>a+takeRain(s),0);
  let snow=totals.reduce((a,s)=>a+positive(s.snowAmount),0);
  if(quarter.length&&hourly.length){
    // Preserve tiny precipitation predicted by hourly model even when a
    // high-frequency (sometimes interpolated) forecast missed the shower.
    const coarse=hourly.filter(s=>s.epoch>now&&s.epoch<=now+3*3600_000);
    rain=Math.max(rain,coarse.reduce((a,s)=>a+takeRain(s),0));
    snow=Math.max(snow,coarse.reduce((a,s)=>a+positive(s.snowAmount),0));
  }
  if(snow>=.18)items.push({kind:'snow-total',priority:5,
    text:'Neige fraîche possible sur 3 h : '+printAmount(snow,'cm')+'.'});
  if(rain>=.12)items.push({kind:'rain-total',priority:6,
    text:'Pluie estimée sur 3 h : '+printAmount(rain,'mm')+'.'});
  // No filler "Pas de pluie ni neige": leave room for the forecast below.
  items.sort((a,b)=>a.priority-b.priority||((a.epoch??Infinity)-(b.epoch??Infinity)));
  return {items:items.slice(0,3),source:containsHourlyContradiction?'mixed':source,
    resolution,radarUsed:false};
}
