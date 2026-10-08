// SnowFusion France — probabilistic guidance and conservative snowpack estimate.
// Forecast fields use consistent units: °C, mm/h, cm/h, snow depth cm.
// No claims of calibrated accuracy: weights and snowpack evolution are heuristic.
export const SNOWFUSION_MODELS = [
  'meteofrance_arome_france_hd',
  'meteofrance_arome_france',
  'icon_eu',
  'ecmwf_ifs',
  'meteofrance_arpege_europe'
];
export const SNOWFUSION_ENSEMBLE = 'ecmwf_ifs025_ensemble';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const positive = v => Math.max(0, finite(v) ?? 0);
const sum = values => values.reduce((a,b) => a + b, 0);

export function isFrance(location) {
  const lat = finite(location?.lat), lon = finite(location?.lon);
  // Mainland France and neighbouring Alpine margins. Overseas locations use Best Match.
  return lat !== null && lon !== null && lat >= 41 && lat <= 51.6 && lon >= -5.7 && lon <= 10.0;
}

function modelWeight(name, horizon) {
  if (horizon < 52) return ({
    meteofrance_arome_france_hd:0.34, meteofrance_arome_france:0.18,
    icon_eu:0.20, ecmwf_ifs:0.18, meteofrance_arpege_europe:0.10
  })[name] || 0;
  if (horizon < 102) return ({
    icon_eu:0.35, ecmwf_ifs:0.40, meteofrance_arpege_europe:0.25
  })[name] || 0;
  if (horizon < 180) return ({icon_eu:0.40,ecmwf_ifs:0.60})[name] || 0;
  return name === 'ecmwf_ifs' ? 1 : 0;
}

function weighted(values) {
  const usable = values.filter(x => x.weight > 0 && x.value !== null);
  const denominator = sum(usable.map(x=>x.weight));
  return denominator > 0 ? sum(usable.map(x=>x.weight*x.value))/denominator : null;
}

function modelColumns(hourly, variable, index, horizon) {
  return SNOWFUSION_MODELS.map(name => ({
    name, value:finite(hourly[variable + '_' + name]?.[index]), weight:modelWeight(name,horizon)
  })).filter(entry=>entry.value !== null && entry.weight > 0);
}

function skyIsDark(hour, day) {
  if (!day?.sunrise || !day?.sunset) return false;
  return hour.time < day.sunrise || hour.time >= day.sunset;
}

function coldPoolAdjustment(hour, day, terrain) {
  const depth = finite(terrain?.valleyDepth);
  // Conservative upper limit: local grid downscaling already accounts for much relief.
  if (depth === null || depth < 150 || !skyIsDark(hour,day)) return 0;
  if ((finite(hour.wind_speed_10m) ?? 20) > 8 || (finite(hour.cloud_cover) ?? 100) > 45) return 0;
  return -clamp((depth - 100)/350, 0, 0.65);
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const p = clamp(probability,0,1)*(sorted.length-1);
  const low = Math.floor(p), high = Math.ceil(p);
  return sorted[low] + (sorted[high]-sorted[low])*(p-low);
}

export function ensembleSnowDaily(ensemble) {
  const hourly=ensemble?.hourly;
  if (!hourly?.time?.length) return {};
  const keys=Object.keys(hourly).filter(k=>/^snowfall_.*member\d+/i.test(k) && Array.isArray(hourly[k]));
  if (keys.length < 10) return {};
  const dates=[...new Set(hourly.time.map(t=>String(t).slice(0,10)))];
  const out={};
  for (const date of dates) {
    const indices=hourly.time.flatMap((t,i)=>String(t).startsWith(date)?[i]:[]);
    const totals=keys.map(key=>{
      const readings=indices.map(i=>finite(hourly[key][i])).filter(v=>v!==null);
      return readings.length >= Math.min(12,indices.length) ? sum(readings.map(v=>Math.max(0,v))) : null;
    }).filter(v=>v!==null).sort((a,b)=>a-b);
    if (totals.length < 10) continue;
    const probability=threshold=>Math.round(100*totals.filter(t=>t>=threshold).length/totals.length);
    out[date]={
      members:totals.length, probability:probability(0.1),
      p1:probability(1),p5:probability(5),p10:probability(10),p20:probability(20),
      low:quantile(totals,0.1),median:quantile(totals,0.5),high:quantile(totals,0.9)
    };
  }
  return out;
}

function daySnowpack(baseHourly, updatedHourly, dayRecords, terrain) {
  // Baseline model snow_depth (metres) is an initial estimate, not an observation.
  // Do not create an imaginary 0 cm snowpack when the source is missing.
  let initial = null;
  for (let i=0;i<Math.min(6,baseHourly.length);i++) {
    const observed = finite(baseHourly[i]?.snow_depth);
    if (observed !== null) {initial=Math.max(0,observed*100);break;}
  }
  if (initial === null) return;
  let old = initial, fresh = 0, previousDate = null;
  const steepTerrain = terrain?.rugged === true;
  for (const hour of updatedHourly) {
    const temp=finite(hour.temperature_2m) ?? 0;
    const wind=positive(hour.wind_speed_10m);
    const radiation=positive(hour.shortwave_radiation);
    const rain=positive(hour.rain);
    const incoming=positive(hour.snowfall);
    // Height loss (compaction) is not the same as snow-water melt.
    const settling=clamp(0.014+wind*0.0001,0.014,0.035);
    const packed=fresh*settling;
    fresh-=packed;
    old=old*0.999+packed*0.66;
    const sunnyAndWarm=radiation>0 && temp>-3 ? radiation*0.00032 : 0;
    const melt=clamp(Math.max(0,temp)*0.11 + sunnyAndWarm + rain*0.04,0,6);
    const fromFresh=Math.min(fresh,melt);
    fresh-=fromFresh;
    old=Math.max(0,old-(melt-fromFresh));
    // Small loss possible on windswept exposed ground, without claiming measured drift.
    if (steepTerrain && wind>60) fresh*=0.995;
    fresh+=incoming;
    const depth=old+fresh;
    hour.snowpack={depth:Math.round(depth*10)/10,fresh:Math.round(fresh*10)/10,
      old:Math.round(old*10)/10,approximate:true};
    const date=String(hour.time).slice(0,10);
    if (previousDate!==null && previousDate!==date && dayRecords[previousDate]) {
      dayRecords[previousDate].snowpack=lastSnowpack;
    }
    var lastSnowpack=hour.snowpack;
    previousDate=date;
  }
  if (previousDate!==null && dayRecords[previousDate]) dayRecords[previousDate].snowpack=lastSnowpack;
}

// Fuses meteorological model columns into the SAME base payload used by the entire UI.
// A field without >=2 independent available model values retains the original provider.
export function applySnowFusion(base, modelPayload, ensemblePayload, terrain=null) {
  const baseHours=base?.hourly;
  const hours=modelPayload?.hourly;
  if (!Array.isArray(baseHours?.time) || !Array.isArray(hours?.time)) return false;
  const timeIndex=new Map(hours.time.map((t,i)=>[t,i]));
  let fusedHours=0;
  const dailyLookup=new Map((base.daily?.time||[]).map((d,i)=>[d,i]));
  const original=baseHours.time.map((time,i)=>Object.fromEntries(
    Object.keys(baseHours).filter(k=>k!=='time').map(k=>[k,baseHours[k]?.[i]])
  ));
  for (let i=0;i<baseHours.time.length;i++) {
    const time=baseHours.time[i], modelIndex=timeIndex.get(time);
    if (modelIndex===undefined) continue;
    const dayIndex=dailyLookup.get(String(time).slice(0,10));
    const day=dayIndex===undefined?null:{sunrise:base.daily.sunrise?.[dayIndex],sunset:base.daily.sunset?.[dayIndex]};
    let merged=false;
    for (const variable of ['temperature_2m','precipitation','snowfall','rain']) {
      const candidates=modelColumns(hours,variable,modelIndex,i);
      if (candidates.length<2) continue;
      const result=weighted(candidates);
      if (result===null) continue;
      const baseline=finite(baseHours[variable]?.[i]);
      // Conservative prior avoids abrupt switching to an uncalibrated model blend.
      const value=baseline===null ? result : result*0.85+baseline*0.15;
      baseHours[variable][i]=variable==='temperature_2m'?value:Math.max(0,value);
      merged=true;
    }
    if (!merged) continue;
    fusedHours++;
    const hour={
      time,...Object.fromEntries(Object.keys(baseHours).filter(k=>k!=='time').map(k=>[k,baseHours[k]?.[i]]))
    };
    const delta=coldPoolAdjustment(hour,day,terrain);
    if (delta && finite(hour.temperature_2m)!==null) {
      baseHours.temperature_2m[i]+=delta;
      if (finite(baseHours.apparent_temperature?.[i])!==null) baseHours.apparent_temperature[i]+=delta;
      if (finite(baseHours.wet_bulb_temperature_2m?.[i])!==null) baseHours.wet_bulb_temperature_2m[i]+=delta;
    }
    const snow=positive(baseHours.snowfall?.[i]), precip=positive(baseHours.precipitation?.[i]);
    if (snow>=0.1) baseHours.weather_code[i]=snow>=1.8?75:snow>=0.55?73:71;
    else if (precip>=0.3 && [71,73,75,77,85,86].includes(Number(baseHours.weather_code?.[i])))
      baseHours.weather_code[i]=precip>=2.5?63:61;
  }
  if (!fusedHours) return false;
  // Rebuild daily aggregates from the same hours so cards/detail/snow panel agree.
  const dates=base.daily?.time || [];
  const ensembleDays=ensembleSnowDaily(ensemblePayload);
  const snowDays={};
  const sourceHours=baseHours.time.map((time,i)=>({
    time,...Object.fromEntries(Object.keys(baseHours).filter(k=>k!=='time').map(k=>[k,baseHours[k]?.[i]]))
  }));
  dates.forEach((date,index)=>{
    const dayHours=sourceHours.filter(h=>h.time.startsWith(date));
    if (!dayHours.length) return;
    const candidates=field=>dayHours.map(h=>finite(h[field])).filter(v=>v!==null);
    const temps=candidates('temperature_2m');
    if (temps.length) {
      base.daily.temperature_2m_max[index]=Math.max(...temps);
      base.daily.temperature_2m_min[index]=Math.min(...temps);
    }
    const precipitation=candidates('precipitation'), snowfall=candidates('snowfall'), rain=candidates('rain');
    if (precipitation.length) base.daily.precipitation_sum[index]=sum(precipitation);
    if (snowfall.length) base.daily.snowfall_sum[index]=sum(snowfall);
    if (rain.length) base.daily.rain_sum[index]=sum(rain);
    const snowTotal=sum(snowfall);
    if (snowTotal>=0.1) base.daily.weather_code[index]=snowTotal>=10?75:snowTotal>=3?73:71;
    snowDays[date]={date,snowfall:Math.round(snowTotal*10)/10,
      ensemble:ensembleDays[date] || null,snowpack:null};
  });
  daySnowpack(original,sourceHours,snowDays,terrain);
  base.snowFusion={
    active:true, models:SNOWFUSION_MODELS.filter(name=>Object.keys(hours).some(k=>k.endsWith('_'+name))),
    horizonHours:fusedHours,totalHours:baseHours.time.length,
    probabilistic:Object.keys(ensembleDays).length>0,
    days:snowDays,
    terrain:terrain?{rugged:Boolean(terrain.rugged),valleyDepth:terrain.valleyDepth??null,elevationRange:terrain.elevationRange??null}:null,
    explanation:'Fusion heuristique non calibrée ; ensemble ECMWF pour les probabilités ; neige au sol indicative.'
  };
  base._snowFusionHourly=sourceHours.map(h=>h.snowpack||null);
  // Preserve current conditions if no matching fused forecast hour exists.
  const currentTime=String(base.current?.time||'').slice(0,13);
  const currentIndex=baseHours.time.findIndex(t=>String(t).slice(0,13)===currentTime);
  if (currentIndex>=0 && base.current) {
    const patch=['temperature_2m','precipitation','snowfall','rain','weather_code'];
    const oldTemp=finite(base.current.temperature_2m);
    const newTemp=finite(baseHours.temperature_2m?.[currentIndex]);
    for (const variable of patch) {
      const val=finite(baseHours[variable]?.[currentIndex]);
      if (val!==null) base.current[variable]=val;
    }
    if (oldTemp!==null && newTemp!==null && finite(base.current.apparent_temperature)!==null)
      base.current.apparent_temperature+=newTemp-oldTemp;
  }
  return true;
}
