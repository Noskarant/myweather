// Affichage de station météo : présentation de prévisions/estimations, pas de capteur physique.
const number=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const fmt=(n,d=0)=>n==null?'—':n.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=n=>n==null?'—':fmt(n)+' %';
const compass=degree=>{
  if(number(degree)==null)return '—';
  return ['N','NE','E','SE','S','SO','O','NO'][Math.round((degree%360)/45)%8];
};
function indexAtTime(hours,time){
  if(!hours.length)return -1;
  const after=hours.findIndex(h=>h.time>time);
  return Math.max(0,(after<0?hours.length:after)-1);
}
export function buildStationMetrics(forecast) {
  if(!forecast?.hourly?.length)return null;
  const h=forecast.hourly,c=forecast.current||{},day=forecast.daily?.[0]||{};
  const idx=indexAtTime(h,c.time||h[0].time),hour=h[idx]||{};
  const pick=(key)=>number(c[key])??number(hour[key]);
  const pressure=pick('pressure_msl'),old=number(h[Math.max(0,idx-3)]?.pressure_msl);
  const pressureTrend=idx>=3&&pressure!=null&&old!=null ? pressure-old : null;
  const history=h.slice(Math.max(0,idx-23),idx+1);
  const accumulation=history.reduce((sum,x)=>sum+(number(x.precipitation)||0),0);
  const snowDepth=number(hour.snowpack?.depth)??(number(hour.snow_depth)==null?null:number(hour.snow_depth)*100);
  const forecastHours=h.slice(idx,idx+25);
  const daylight=number(day.effectiveSunshineDuration)??number(day.sunshineDuration);
  return {
    time:c.time||hour.time,temperature:pick('temperature_2m'),feels:pick('apparent_temperature'),
    humidity:pick('relative_humidity_2m'),dew:number(hour.dew_point_2m),
    wind:pick('wind_speed_10m'),gust:pick('wind_gusts_10m'),direction:pick('wind_direction_10m'),
    pressure,pressureTrend,precipitation:number(hour.precipitation),
    accumulation,cloud:pick('cloud_cover'),uv:number(hour.uv_index),
    visibility:number(hour.visibility),snowDepth,snowfall:number(hour.snowfall),
    solar:number(hour.shortwave_radiation),sunshine:daylight==null?null:daylight/3600,
    sunrise:day.sunrise?.slice(11,16)||null,sunset:day.sunset?.slice(11,16)||null,
    min:number(day.min),max:number(day.max),forecastHours,history
  };
}
function curve(points,key,{minOverride=null,maxOverride=null}={}){
  const valid=points.map(x=>number(x[key])),nums=valid.filter(x=>x!=null);
  if(nums.length<2)return '<text x="20" y="55" fill="#90b4c9" font-size="11">Tendance indisponible</text>';
  const min=minOverride??Math.min(...nums),max=maxOverride??Math.max(...nums);
  const span=Math.max(1,max-min);
  let path='',started=false;
  valid.forEach((val,i)=>{
    if(val==null){started=false;return;}
    const x=12+456*i/Math.max(1,valid.length-1),y=88-72*(val-min)/span;
    path+=(started?' L':' M')+x.toFixed(1)+' '+y.toFixed(1);
    started=true;
  });
  return '<path d="'+path+'" fill="none" stroke="#66d4f8" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>';
}
const metric=(icon,label,value,note='')=>'<article class="station-metric"><span class="station-metric-icon">'+icon+'</span><div><small>'+label+'</small><strong>'+value+'</strong>'+(note?'<span>'+note+'</span>':'')+'</div></article>';
function gauge(label,value,units,level,note,kind){
  const has=number(level)!=null,angle=has?Math.max(0,Math.min(100,level))*3.6:0;
  return '<article class="station-gauge '+kind+'"><div class="station-dial" style="--dial-angle:'+angle.toFixed(1)+'deg">'+
    '<div class="station-dial-inner"><span>'+label+'</span><strong>'+value+'</strong><small>'+units+'</small></div></div><p>'+note+'</p></article>';
}
function formatHour(time){return time?.slice(11,16)||'—';}
export function createStationController({getContext,escapeHtml}) {
  const $=s=>document.querySelector(s);
  const view=$('#stationView'),board=$('#stationDashboard');
  if(!view||!board)return {show(){},render(){},hide(){}};
  const direction=$('#stationOrientation'),themeBtn=$('#stationTheme'),fullBtn=$('#stationFullscreen');
  let orientation=null,night=false,lock=null;
  try{orientation=localStorage.getItem('myweather:station-orientation');night=localStorage.getItem('myweather:station-night')==='true';}catch{}
  if(!['horizontal','vertical'].includes(orientation))orientation=window.matchMedia('(max-width:700px)').matches?'vertical':'horizontal';
  direction.value=orientation;
  const persist=()=>{try{localStorage.setItem('myweather:station-orientation',orientation);localStorage.setItem('myweather:station-night',String(night));}catch{}};
  const apply=()=>{
    view.dataset.orientation=orientation;
    view.classList.toggle('station-night',night);
    themeBtn.textContent=night?'☀ Mode clair':'☾ Mode nuit';
  };
  function render(){
    const {location,forecast,staleSince,demo,forecastFetchedAt}=getContext();
    apply();
    $('#stationLocation').textContent=location?.name||'Lieu sélectionné';
    const updated=forecastFetchedAt?new Date(forecastFetchedAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
    $('#stationUpdate').textContent=(staleSince?'Données sauvegardées · ':'Prévisions mises à jour · ')+updated+(demo?' · Démonstration':'');
    const metrics=buildStationMetrics(forecast);
    if(!metrics){
      board.innerHTML='<div class="station-no-data">Données météo indisponibles. Sélectionne un lieu et actualise les prévisions.</div>';
      return;
    }
    const m=metrics,provenance=forecast?.localObservation?.applied?'Température ajustée par stations locales':'Données de modèles météo';
    $('#stationSource').textContent=provenance+' · Les autres données ne sont pas des mesures de capteurs.';
    const degree=m.direction==null?'—':fmt(m.direction)+'° '+compass(m.direction);
    const pressureSymbol=m.pressureTrend==null?'—':m.pressureTrend>.5?'↗':m.pressureTrend<-.5?'↘':'→';
    const pressureNote=m.pressureTrend==null?'Tendance 3h indisponible':pressureSymbol+' '+fmt(Math.abs(m.pressureTrend),1)+' hPa / 3h';
    const validTemp=m.temperature!=null;
    const head='<div class="station-lead"><div class="station-main-temp"><span>TEMPÉRATURE EXTÉRIEURE · MODÈLE</span><strong>'+
      (validTemp?fmt(m.temperature,1)+'<small>°C</small>':'—')+'</strong><p>Ressenti '+(m.feels==null?'—':fmt(m.feels,1)+' °C')+
      ' <span class="station-divider">·</span> Min '+(m.min==null?'—':fmt(m.min)+'°')+' / Max '+(m.max==null?'—':fmt(m.max)+'°')+'</p></div>'+
      '<div class="station-gauges">'+gauge('Humidité',fmt(m.humidity),'%',m.humidity,'Point de rosée '+(m.dew==null?'—':fmt(m.dew,1)+' °C'),'humidity')+
      gauge('Vent',fmt(m.wind),'km/h',m.wind==null?null:m.wind/100*100,'Rafales '+(m.gust==null?'—':fmt(m.gust)+' km/h'),'wind')+
      gauge('Pression',fmt(m.pressure),'hPa',m.pressure==null?null:(m.pressure-950)/100*100,pressureNote,'pressure')+'</div></div>';
    const slots='<div class="station-metrics">'+
      metric('➤','Direction du vent',degree)+
      metric('☁','Couverture nuageuse',pct(m.cloud))+
      metric('◌','Précipitations, prévision 1h',m.precipitation==null?'—':fmt(m.precipitation,1)+' mm')+
      metric('▤','Cumul modélisé, 24h',fmt(m.accumulation,1)+' mm')+
      metric('☼','Indice UV',fmt(m.uv,1))+
      metric('◉','Visibilité',m.visibility==null?'—':fmt(m.visibility/1000,1)+' km')+
      metric('❄','Neige au sol estimée',m.snowDepth==null?'—':fmt(m.snowDepth,1)+' cm')+
      metric('✳','Neige, prévision 1h',m.snowfall==null?'—':fmt(m.snowfall,1)+' cm')+
      metric('◈','Rayonnement solaire',m.solar==null?'—':fmt(m.solar)+' W/m²')+
      metric('☀','Ensoleillement du jour',m.sunshine==null?'—':fmt(m.sunshine,1)+' h')+
      metric('↑','Lever du soleil',m.sunrise||'—')+
      metric('↓','Coucher du soleil',m.sunset||'—')+'</div>';
    const chart='<section class="station-chart"><div class="station-chart-title"><strong>Évolution de température</strong><span>Prévisions · 24 prochaines heures</span></div>'+
      '<svg viewBox="0 0 480 100" role="img" aria-label="Courbe de température prévue sur 24 heures">'+curve(m.forecastHours,'temperature_2m')+'</svg>'+
      '<div class="station-chart-axis"><span>'+formatHour(m.forecastHours[0]?.time)+'</span><span>'+formatHour(m.forecastHours[Math.floor(m.forecastHours.length/2)]?.time)+'</span><span>'+formatHour(m.forecastHours.at(-1)?.time)+'</span></div></section>';
    board.innerHTML=head+slots+chart;
  }
  async function releaseWakeLock(){
    if(lock){try{await lock.release()}catch{} lock=null;}
  }
  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement===view){await document.exitFullscreen();await releaseWakeLock();}
      else if(view.classList.contains('station-immersive')){view.classList.remove('station-immersive');document.body.classList.remove('station-immersive-open');await releaseWakeLock();}
      else {
        if(typeof view.requestFullscreen==='function')await view.requestFullscreen();
        else {view.classList.add('station-immersive');document.body.classList.add('station-immersive-open');}
        if(navigator.wakeLock?.request){try{lock=await navigator.wakeLock.request('screen')}catch{}}
      }
    }catch{
      view.classList.toggle('station-immersive');
      document.body.classList.toggle('station-immersive-open',view.classList.contains('station-immersive'));
    }
    fullBtn.textContent=document.fullscreenElement===view||view.classList.contains('station-immersive')?'✕ Quitter le plein écran':'⛶ Plein écran';
  }
  direction.addEventListener('change',()=>{orientation=direction.value;persist();apply();});
  themeBtn.addEventListener('click',()=>{night=!night;persist();apply();});
  fullBtn.addEventListener('click',toggleFullscreen);
  document.addEventListener('fullscreenchange',()=>{
    fullBtn.textContent=document.fullscreenElement===view?'✕ Quitter le plein écran':'⛶ Plein écran';
    if(document.fullscreenElement!==view)releaseWakeLock();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseWakeLock();});
  apply();
  return {show(){render();},render,hide(){
    if(document.fullscreenElement===view)document.exitFullscreen().catch(()=>{});
    view.classList.remove('station-immersive');
    document.body.classList.remove('station-immersive-open');
    releaseWakeLock();
  }};
}
