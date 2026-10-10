// Coastal microclimate near Saint-Gilles-Croix-de-Vie (Vendée).
// Do not infer a fixed "sea cooling" effect: marine regimes depend on wind,
// season and hour. Assimilate ONLY observed station-minus-model anomalies.
// Marine representativeness uses published Météo-France station IDs and the
// geographic Saint-Gilles catchment; no invented sea-surface observations.
const CENTER={lat:46.696,lon:-1.940};
const MARITIME_STATIONS={
  'mf-85113001':1.6, // Île d'Yeu (island)
  'mf-85113004':1.7, // Île d'Yeu airport
  'mf-85163001':1.5, // Noirmoutier
  'mf-85060002':1.4, // Château-d'Olonne (coastal exposure)
  'mf-85172001':1.22 // Le Perrier (near-coastal plain, not seafront)
};
const finite=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))
  ?null:Number(v);
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const distanceKm=(a,b)=>{
  const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
  const x=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*
    Math.sin(dlon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(x)));
};
export function isSaintGillesCoastalLocation(location){
  const lat=finite(location?.lat),lon=finite(location?.lon);
  if(lat===null||lon===null)return false;
  const country=String(location?.countryCode||location?.country_code||
    location?.country||'').toLowerCase();
  if(country&&!['fr','france'].includes(country))return false;
  return distanceKm({lat,lon},CENTER)<=11.5;
}
export function coastalStationWeight(station,location,windDirection=null){
  if(!isSaintGillesCoastalLocation(location))return 1;
  const base=MARITIME_STATIONS[station?.id]??0.56;
  const dir=finite(windDirection);
  // Westerly/southwesterly wind transports marine air; easterly flow less so.
  const airMass=dir!==null&&dir>=195&&dir<=340?1.16:
    dir!==null&&dir>=45&&dir<=160?0.83:1;
  const local=distanceKm({lat:Number(location.lat),lon:Number(location.lon)},CENTER);
  const spatial=clamp((11.5-local)/11.5,0,1);
  return 1+(base*airMass-1)*spatial;
}
function forecastEpoch(wallTime,utcOffset){
  const time=Date.parse(String(wallTime||'')+'Z');
  return Number.isFinite(time)?time-(finite(utcOffset)||0)*1000:null;
}
function dewPointC(temp,humidity){
  if(temp===null||humidity===null||humidity<=0)return null;
  const gamma=Math.log(humidity/100)+17.625*temp/(243.04+temp);
  return 243.04*gamma/(17.625-gamma);
}
function apparentDelta(temp,fromHum,toHum,fromWind,toWind){
  if([temp,fromHum,toHum,fromWind,toWind].some(v=>v===null))return 0;
  const vapor=rh=>rh/100*6.105*Math.exp(17.27*temp/(237.7+temp));
  return clamp(0.33*(vapor(toHum)-vapor(fromHum))-
    0.7*(toWind-fromWind)/3.6,-3.5,3.5);
}
function updateCoastalValues(obj,hBias,wBias,hScale,wScale=hScale){
  if(!obj||(hScale<=0&&wScale<=0))return {humidity:false,wind:false};
  const oldRH=finite(obj.relative_humidity_2m);
  const oldWind=finite(obj.wind_speed_10m);
  const temp=finite(obj.temperature_2m);
  let rh=false,wind=false;
  if(oldRH!==null&&hBias!==null&&hScale>0){
    const newRH=Math.round(clamp(oldRH+hBias*hScale,0,100)*10)/10;
    if(newRH!==oldRH){
      obj.relative_humidity_2m=newRH;rh=true;
      const oldDew=finite(obj.dew_point_2m);
      if(oldDew!==null&&temp!==null){
        const newDew=dewPointC(temp,newRH);
        const previousDew=dewPointC(temp,oldRH);
        // Small, model-relative adjustment only; preserves model's dewpoint bias.
        if(newDew!==null&&previousDew!==null)
          obj.dew_point_2m=Math.min(temp,oldDew+clamp(newDew-previousDew,-3,3));
      }
    }
  }
  if(oldWind!==null&&wBias!==null&&wScale>0){
    let newWind=clamp(oldWind+wBias*wScale,0,150);
    // Do not fabricate gusts; the mean cannot exceed an available modeled gust.
    const gust=finite(obj.wind_gusts_10m);
    if(gust!==null&&oldWind<=gust)newWind=Math.min(newWind,Math.max(0,gust));
    newWind=Math.round(newWind*10)/10;
    if(newWind!==oldWind){obj.wind_speed_10m=newWind;wind=true;}
  }
  if((rh||wind)&&finite(obj.apparent_temperature)!==null){
    const beforeRH=oldRH??finite(obj.relative_humidity_2m);
    const beforeWind=oldWind??finite(obj.wind_speed_10m);
    if(beforeRH!==null&&beforeWind!==null){
      obj.apparent_temperature+=apparentDelta(temp,beforeRH,
        finite(obj.relative_humidity_2m),beforeWind,finite(obj.wind_speed_10m));
    }
  }
  return {humidity:rh,wind};
}
/**
 * Station inputs have already passed regional freshness, geographic distance
 * and station-vs-model temperature quality gates.
 * Model relative_humidity_2m is in %, model wind_speed_10m in km/h;
 * Météo-France observation 'ff' is in m/s and requires x3.6.
 */
export function applySaintGillesCoastalWindHumidity(base,location,stations,now=Date.now()){
  if(!isSaintGillesCoastalLocation(location)||!Array.isArray(stations)||!stations.length)
    return null;
  const centerDistance=distanceKm({lat:Number(location.lat),lon:Number(location.lon)},CENTER);
  const locality=clamp((11.5-centerDistance)/11.5,0,1);
  const estimate=(measured,model,maxResidual,maxBias)=>{
    const samples=stations.flatMap(s=>{
      const observed=finite(s[measured]),baseline=finite(s[model]);
      if(observed===null||baseline===null||s.weight<=0)return [];
      // Reject questionable wind/humidity sensors without modifying base forecast.
      const residual=measured==='windSpeedMs'?observed*3.6-baseline:observed-baseline;
      if(!Number.isFinite(residual)||Math.abs(residual)>maxResidual||
        measured==='humidity'&&(observed<0||observed>100||baseline<0||baseline>100)||
        measured==='windSpeedMs'&&(observed<0||observed>45||baseline<0||baseline>160))return [];
      return [{weight:s.weight,residual}];
    });
    if(!samples.length)return {bias:null,count:0};
    const weight=samples.reduce((t,s)=>t+s.weight,0);
    return {bias:clamp(samples.reduce((t,s)=>t+s.residual*s.weight,0)/weight,
      -maxBias,maxBias)*clamp(weight/(weight+.35),0,.84)*locality,
      count:samples.length};
  };
  const humidity=estimate('humidity','modelHumidity',35,15);
  const wind=estimate('windSpeedMs','modelWindSpeed',35,9);
  if(humidity.bias===null&&wind.bias===null)return null;
  const attenuation=(hours,max)=>hours<=0?1:hours>=max?0:(1-hours/max)**1.5;
  let hourlyHum=0,hourlyWind=0;
  for(let i=0;i<(base?.hourly?.time?.length||0);i++){
    const epoch=forecastEpoch(base.hourly.time[i],base.utc_offset_seconds);
    if(epoch===null)continue;
    const hour=(epoch-now)/3600000;
    if(hour< -1.5||hour>12)continue;
    const entry={};
    for(const key of ['temperature_2m','relative_humidity_2m','wind_speed_10m',
      'wind_gusts_10m','apparent_temperature','dew_point_2m']){
      entry[key]=base.hourly[key]?.[i]??null;
    }
    // Wind has a shorter observational predictability horizon (9h).
    const updated=updateCoastalValues(entry,humidity.bias,wind.bias,
      attenuation(hour,12),attenuation(hour,9));
    if(updated.humidity){
      if(Array.isArray(base.hourly.relative_humidity_2m))
        base.hourly.relative_humidity_2m[i]=entry.relative_humidity_2m;
      if(Array.isArray(base.hourly.dew_point_2m))
        base.hourly.dew_point_2m[i]=entry.dew_point_2m;
      hourlyHum++;
    }
    if(updated.wind){
      if(Array.isArray(base.hourly.wind_speed_10m))
        base.hourly.wind_speed_10m[i]=entry.wind_speed_10m;
      hourlyWind++;
    }
    if(updated.humidity||updated.wind){
      if(Array.isArray(base.hourly.apparent_temperature))
        base.hourly.apparent_temperature[i]=entry.apparent_temperature;
    }
  }
  const epoch=forecastEpoch(base?.current?.time,base?.utc_offset_seconds);
  const hours=epoch===null?0:(epoch-now)/3600000;
  let current={humidity:false,wind:false};
  if(base?.current&&hours>=-1.5&&hours<=2)
    current=updateCoastalValues(base.current,humidity.bias,wind.bias,
      attenuation(hours,12),attenuation(hours,9));
  if(!hourlyHum&&!hourlyWind&&!current.humidity&&!current.wind)return null;
  base.localCoastal={
    active:true,region:'saint-gilles-croix-de-vie',
    method:'station_anomalies',
    humidityStations:humidity.count,windStations:wind.count,
    humidityAdjusted:hourlyHum>0||current.humidity,
    windAdjusted:hourlyWind>0||current.wind,
    note:'Ajustement côtier seulement si mesures officielles récentes avec référence de modèle local.'
  };
  return base.localCoastal;
}
