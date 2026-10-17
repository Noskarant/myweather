import {CURRENT_VARS, HOURLY_VARS, DAILY_VARS} from '../js/weather.js';
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
