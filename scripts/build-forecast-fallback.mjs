import {writeFile,mkdir} from 'node:fs/promises';
import {CURRENT_VARS, HOURLY_VARS, DAILY_VARS} from '../js/weather.js';

// Public reference points, not users' private saved locations.
export const REFERENCE_LOCATIONS=[
  {name:'Oullins',lat:45.714,lon:4.807,elevation:190,country:'France'},
  {name:'Valmorel',lat:45.46,lon:6.44,elevation:1400,country:'France'},
  {name:'Le Meiller vicinity',lat:45.52,lon:6.51,elevation:1150,country:'France'},
  {name:'Le Cheval Noir',lat:45.453,lon:6.43,elevation:2832,country:'France'},
  {name:'Québec',lat:46.81,lon:-71.21,elevation:40,country:'Canada'}
];

export async function collectForecastSnapshots({fetchImpl=fetch,now=()=>new Date()}={}){
 const forecasts=[];
 for(const location of REFERENCE_LOCATIONS){
  const params=new URLSearchParams({
   latitude:String(location.lat),longitude:String(location.lon),
   elevation:String(location.elevation),timezone:'auto',forecast_days:'16',past_hours:'48',
   current:CURRENT_VARS.join(','),hourly:HOURLY_VARS.join(','),daily:DAILY_VARS.join(','),
   wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'
  });
  try{
   const res=await fetchImpl('https://api.open-meteo.com/v1/forecast?'+params,{signal:AbortSignal.timeout(12000)});
   if(!res.ok)throw new Error('HTTP '+res.status);
   const data=await res.json();
   if(!data?.current||!Array.isArray(data.hourly?.time)||data.hourly.time.length<100||
      !Array.isArray(data.daily?.time)||data.daily.time.length<10)throw new Error('Response incomplete');
   forecasts.push({location,at:now().toISOString(),data});
   console.log('Weather snapshot: '+location.name+' valid');
  }catch(e){
   console.warn('Weather snapshot unavailable: '+location.name+' '+e.message);
  }
 }
 return {version:1,publishedAt:now().toISOString(),forecasts};
}
if(process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url){
 const output=await collectForecastSnapshots();
 await mkdir(new URL('../data/',import.meta.url),{recursive:true});
 await writeFile(new URL('../data/forecast-fallback.json',import.meta.url),JSON.stringify(output));
 console.log('Published '+output.forecasts.length+' / '+REFERENCE_LOCATIONS.length+' official model snapshots');
}
