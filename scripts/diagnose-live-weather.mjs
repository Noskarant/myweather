import {getForecast, CURRENT_VARS, HOURLY_VARS, DAILY_VARS} from '../js/weather.js';
const base={
  latitude:'45.714',longitude:'4.807',elevation:'190',timezone:'auto',forecast_days:'16',
  past_hours:'48',current:CURRENT_VARS.join(','),hourly:HOURLY_VARS.join(','),daily:DAILY_VARS.join(','),
  wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'
};
const attempts=[
  ['exact current app request',{}],
  ['no historical hours',{past_hours:null}],
  ['15 days',{forecast_days:'15'}],
  ['minimal fields',{current:'temperature_2m',hourly:'temperature_2m',daily:'temperature_2m_max'}]
];
for(const [name,changes] of attempts){
 const cfg={...base,...changes},params=new URLSearchParams();
 for(const [k,v] of Object.entries(cfg)) if(v!=null)params.set(k,v);
 try{
  const result=await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:AbortSignal.timeout(15000)});
  const body=await result.text();
  let x;try{x=JSON.parse(body)}catch{x={reason:body.slice(0,220)}}
  console.log(JSON.stringify({name,status:result.status,error:x.error||false,reason:x.reason||null,timezone:x.timezone||null,
   currentKeys:Object.keys(x.current||{}).length,hourlyDays:x.hourly?.time?.length,dailyDays:x.daily?.time?.length}));
 }catch(e){console.log(JSON.stringify({name,networkFailure:String(e.message||e)}));}
}

const locations=[
  {name:'Oullins',lat:45.714,lon:4.807,elevation:190,country:'France'},
  {name:'Le Meiller',lat:45.52,lon:6.51,elevation:1150,country:'France'},
  {name:'Cheval Noir',lat:45.453,lon:6.43,elevation:2832,country:'France'},
  {name:'Québec',lat:46.81,lon:-71.21,elevation:40,country:'Canada'}
];
for(const loc of locations){
 const started=Date.now();
 try{
  const data=await Promise.race([
   getForecast(loc),
   new Promise((_,reject)=>setTimeout(()=>reject(new Error('getForecast timed out at 27 sec')),27000))
  ]);
  console.log(JSON.stringify({getForecast:loc.name,ok:true,elapsed:Date.now()-started,
    current:data.current?.temperature_2m,daily:data.daily?.length,hourly:data.hourly?.length,
    location:data.location?.name}));
 }catch(e){console.log(JSON.stringify({getForecast:loc.name,ok:false,elapsed:Date.now()-started,error:e.message,stack:e.stack?.slice(0,1500)}));}
}
