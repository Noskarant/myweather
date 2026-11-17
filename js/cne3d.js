import { CNE_ZONES, cneGrid, cneNearest, cneValue, cneInterpolate, cneSnowline, cneColor } from './cne3d-model.js?v=1';

// Private experimental entry point. Public navigation is not changed.
// Open MyWeather with ?cne3d=1 to reveal the button for the current tab session.
const qs = new URLSearchParams(window.location.search);
let enabled = qs.get('cne3d') === '1';
try {
  if (enabled) sessionStorage.setItem('myweather:cne3d:preview','1');
  enabled = enabled || sessionStorage.getItem('myweather:cne3d:preview') === '1';
} catch { /* Browser may restrict storage. URL flag still works. */ }

if (enabled) startCNE();

function startCNE() {
  const main=document.querySelector('main'), nav=document.querySelector('.bottom-nav');
  if(!main || !nav)return;

  const button=document.createElement('button');
  button.id='cne3dNav';
  button.type='button';
  button.setAttribute('aria-label','3D CNE, couche neige expérimentale');
  button.innerHTML='<span aria-hidden="true">❄</span><small>3D CNE</small>';
  nav.appendChild(button);

  const view=document.createElement('section');
  view.id='cne3dView';
  view.className='view cne-view';
  view.setAttribute('aria-label','3D CNE expérimental');
  view.innerHTML=[
    '<div class="cne-shell">',
      '<div class="cne-heading">',
        '<div><div class="eyebrow">MYWEATHER · LABORATOIRE CARTOGRAPHIQUE</div>',
        '<h1>3D CNE <span class="cne-experiment">EXPÉRIMENTAL</span></h1>',
        '<p>Relief réel, neige modélisée et météo locale. Déplace, incline et explore les massifs.</p></div>',
        '<button id="cneClose" type="button" class="cne-quiet">← Prévisions</button>',
      '</div>',
      '<div class="cne-toolbar" aria-label="Commandes de la carte">',
        '<label>Zone<select id="cneZone"><option value="lyonnais">Monts du Lyonnais</option><option value="valmorel">Valmorel</option><option value="pilat">Pilat</option></select></label>',
        '<label>Couche<select id="cneLayer"><option value="depth">Neige au sol · cm</option><option value="fresh">Neige fraîche · 24 h</option><option value="temp">Température · °C</option></select></label>',
        '<button id="cneReset" type="button" title="Recentrer la vue 3D">⌖ Recentrer</button>',
        '<button id="cneCamera" type="button" title="Basculer vue aérienne et vue inclinée">◫ Vue 3D</button>',
        '<button id="cneFull" type="button" title="Agrandir la carte">⛶ Agrandir</button>',
      '</div>',
      '<div class="cne-map-wrap" id="cneMapWrap">',
        '<div id="cneMap" role="application" aria-label="Carte 3D interactive des prévisions de neige"></div>',
        '<div class="cne-map-hint" id="cneMapHint">Glisser : déplacer · Pincer : zoomer · Deux doigts : orienter</div>',
        '<div class="cne-map-credit">© OpenStreetMap · DEM AWS Terrarium · Open-Meteo</div>',
        '<div class="cne-map-wait" id="cneMapWait" role="status">Initialisation du relief 3D…</div>',
      '</div>',
      '<div class="cne-timeline">',
        '<div class="cne-time-top"><strong id="cneWhen">Choisir une échéance</strong><span id="cneStatus">Chargement des données…</span></div>',
        '<div class="cne-time-slider"><button id="cnePrev" type="button" aria-label="Heure précédente">−</button>',
        '<input id="cneTime" type="range" min="0" max="1" value="0" step="1" aria-label="Heure de la prévision" disabled />',
        '<button id="cneNext" type="button" aria-label="Heure suivante">+</button></div>',
        '<div class="cne-time-shortcuts">',
          '<button type="button" data-cne-shift="0">Maintenant</button>',
          '<button type="button" data-cne-shift="24">+24 h</button>',
          '<button type="button" data-cne-shift="48">+48 h</button>',
          '<button type="button" id="cneReload">↻ Actualiser</button>',
        '</div>',
      '</div>',
      '<div class="cne-lower">',
        '<div class="cne-selection" id="cneSelection"><strong>Lecture locale</strong><p>Clique sur un lieu ou un point du relief pour voir les prévisions.</p></div>',
        '<div class="cne-legend"><strong id="cneLegendTitle">Épaisseur de neige modélisée</strong>',
        '<div id="cneLegendScale" class="cne-legend-scale"></div>',
        '<p id="cneLegendNote">La couleur représente une prévision, pas une mesure ni une épaisseur géométrique de neige.</p></div>',
      '</div>',
      '<p class="cne-method">Sources : relief numérique Terrarium (altitude topographique, sans amplification), fond OpenStreetMap, prévisions spatialisées Open-Meteo Best Match. Interpolation visuelle entre points de modèle : les détails locaux ne sont pas résolus. Neige au sol en cm = variable snow_depth convertie de mètres en centimètres ; neige fraîche = somme mobile des dernières 24 h. LPN indicative ≈ altitude ISO 0 °C − 300 m (fortement incertaine). Aucun relevé au sol, croisement d’ensembles ni information de sécurité en montagne n’est impliqué.</p>',
    '</div>'
  ].join('');
  main.appendChild(view);

  const $=id=>view.querySelector('#'+id);
  const el={
    zone:$('cneZone'), layer:$('cneLayer'), map:$('cneMap'), wrap:$('cneMapWrap'),
    hint:$('cneMapHint'), wait:$('cneMapWait'), slider:$('cneTime'),
    when:$('cneWhen'), status:$('cneStatus'), selection:$('cneSelection'),
    legend:$('cneLegendTitle'), scale:$('cneLegendScale'), note:$('cneLegendNote')
  };
  let map=null, mapReady=false, rows=[], time=[], selected=0, active=false, zoneId='lyonnais';
  let markers=[], request=null, requestNumber=0, position=null, raf=0, loadingMap=null, immersive=false;

  button.addEventListener('click',async()=>{
    document.querySelectorAll('main > .view').forEach(v=>v.classList.remove('active'));
    view.classList.add('active');
    nav.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    button.classList.add('active');
    active=true;
    window.scrollTo(0,0);
    if(!map)await makeMap();
    else {
      map.resize();
      if(!rows.length)loadForecast();
    }
  });
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{
    if(!view.classList.contains('active'))return;
    view.classList.remove('active');
    button.classList.remove('active');
    active=false;
    endImmersive();
  }));
  $('cneClose').addEventListener('click',()=>document.querySelector('[data-nav="forecast"]')?.click());

  el.zone.addEventListener('change',()=>{
    zoneId=el.zone.value;
    rows=[];time=[]; selected=0; position=null;
    el.selection.innerHTML='<strong>Lecture locale</strong><p>Choisis un point sur la carte.</p>';
    if(mapReady) {
      setZoneView();
      setMarkers();
      clearRaster();
      loadForecast();
    }
  });
  el.layer.addEventListener('change',()=>{updateLegend();updateVisual();});
  el.slider.addEventListener('input',()=>{
    selected=Number(el.slider.value);
    updateVisual();
  });
  $('cnePrev').addEventListener('click',()=>shiftTime(-1));
  $('cneNext').addEventListener('click',()=>shiftTime(1));
  view.querySelectorAll('[data-cne-shift]').forEach(b=>b.addEventListener('click',()=>{
    if(!time.length)return;
    const future=Number(b.dataset.cneShift);
    const now=new Date();
    const target=now.getTime()+future*3600*1000;
    let best=0;
    time.forEach((s,i)=>{if(Math.abs(new Date(s).getTime()-target)<Math.abs(new Date(time[best]).getTime()-target))best=i;});
    selectTime(best);
  }));
  $('cneReload').addEventListener('click',loadForecast);
  $('cneReset').addEventListener('click',setZoneView);
  $('cneCamera').addEventListener('click',()=>{
    if(!map)return;
    const is3d=map.getPitch()>20;
    map.easeTo({pitch:is3d?0:65,bearing:is3d?-18:0,duration:850});
  });
  $('cneFull').addEventListener('click',()=>{
    if(immersive)endImmersive();
    else {
      immersive=true;
      view.classList.add('cne-immersive');
      document.body.classList.add('cne-lock-scroll');
      $('cneFull').textContent='✕ Réduire';
      setTimeout(()=>map?.resize(),70);
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && immersive)endImmersive();
  });
  function endImmersive(){
    if(!immersive)return;
    immersive=false;view.classList.remove('cne-immersive');document.body.classList.remove('cne-lock-scroll');
    $('cneFull').textContent='⛶ Agrandir';
    setTimeout(()=>map?.resize(),70);
  }

  function setStatus(text,isError=false){
    el.status.textContent=text;
    el.status.classList.toggle('cne-error',isError);
    el.wait.hidden=Boolean(rows.length) || isError || mapReady;
    if(isError)el.selection.innerHTML='<strong>Données indisponibles</strong><p>'+escapeText(text)+'</p>';
  }
  function escapeText(text){
    return String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function loadMapLibre(){
    if(window.maplibregl)return Promise.resolve(window.maplibregl);
    if(loadingMap)return loadingMap;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.1/dist/maplibre-gl.css';
    document.head.appendChild(link);
    loadingMap=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.1/dist/maplibre-gl.js';
      script.onload=()=>window.maplibregl?resolve(window.maplibregl):reject(new Error('MapLibre non chargé'));
      script.onerror=()=>reject(new Error('Bibliothèque de cartographie indisponible'));
      document.head.appendChild(script);
    });
    return loadingMap;
  }
  async function makeMap(){
    el.wait.hidden=false;el.wait.textContent='Chargement du relief 3D…';
    try {
      const ml=await loadMapLibre();
      if(!ml.supported())throw new Error('Cette carte nécessite WebGL, indisponible sur cet appareil');
      const zone=CNE_ZONES[zoneId];
      map=new ml.Map({
        container:el.map,
        style:{
          version:8,
          sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},
          layers:[{id:'background',type:'background',paint:{'background-color':'#162f41'}},{id:'osm',type:'raster',source:'osm'}]
        },
        center:zone.center,zoom:zone.zoom,pitch:zone.pitch,bearing:-16,
        maxPitch:80,minZoom:8,maxZoom:16,
        antialias:false,pixelRatio:Math.min(window.devicePixelRatio||1,1.8)
      });
      map.addControl(new ml.NavigationControl({showCompass:true,showZoom:true}),'top-right');
      map.on('load',()=>{
        mapReady=true;
        // Actual elevations from a real DEM, not a synthetic height field.
        map.addSource('cne-dem',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,encoding:'terrarium',maxzoom:14,attribution:'Elevation tiles: Mapzen/AWS'});
        map.setTerrain({source:'cne-dem',exaggeration:1.0});
        map.addLayer({id:'cne-hillshade',type:'hillshade',source:'cne-dem',paint:{'hillshade-exaggeration':0.25}});
        el.wait.hidden=true;
        setZoneView();setMarkers();loadForecast();
      });
      map.on('click',event=>{
        position={lon:event.lngLat.lng,lat:event.lngLat.lat,name:'Point sélectionné'};
        updateSelection();
      });
      map.on('error',e=>{
        // A missing tile must not silently be reported as valid terrain or forecast.
        const msg=String(e?.error?.message||'');
        if(msg.includes('dem')||msg.includes('terrain')||msg.includes('Terrarium')){
          el.hint.textContent='Attention : tuile de relief indisponible ; vue 3D éventuellement incomplète';
        }
      });
    } catch(error){
      el.wait.textContent='Carte indisponible : '+String(error?.message||error);
      el.wait.hidden=false;
      setStatus('Carte 3D non prise en charge',true);
    }
  }
  function setZoneView(){
    if(!map)return;
    const z=CNE_ZONES[zoneId];
    map.fitBounds(z.bounds,{padding:window.innerWidth<700?36:64,duration:800,pitch:z.pitch,bearing:-16,maxZoom:z.zoom+0.4});
    // fitBounds may reset pitch depending on MapLibre version; explicitly restore it.
    setTimeout(()=>{if(map&&active)map.easeTo({pitch:z.pitch,bearing:-16,duration:500});},850);
  }
  function setMarkers(){
    for(const marker of markers)marker.marker.remove();
    markers=[];
    if(!map)return;
    for(const point of CNE_ZONES[zoneId].points){
      const element=document.createElement('button');
      element.type='button';element.className='cne-place-pin';
      const name=document.createElement('strong'),info=document.createElement('small');
      name.textContent=point.name;info.textContent='Prévision…';
      element.append(name,info);
      element.addEventListener('click',event=>{
        event.stopPropagation();
        position={...point};
        updateSelection();
        map.easeTo({center:[point.lon,point.lat],duration:650});
      });
      const marker=new window.maplibregl.Marker({element,anchor:'bottom'}).setLngLat([point.lon,point.lat]).addTo(map);
      markers.push({marker,point,info});
    }
  }
  async function loadForecast(){
    if(!mapReady)return;
    if(request)request.abort();
    const localRequest=++requestNumber;
    request=new AbortController();
    const grid=cneGrid(CNE_ZONES[zoneId].bounds,5);
    const params=new URLSearchParams({
      latitude:grid.map(p=>p.lat.toFixed(5)).join(','),
      longitude:grid.map(p=>p.lon.toFixed(5)).join(','),
      hourly:'temperature_2m,snow_depth,snowfall,freezing_level_height',
      forecast_days:'7',
      timezone:'Europe/Paris',
      models:'best_match'
    });
    setStatus('Open-Meteo : chargement de '+grid.length+' points de prévision…');
    el.slider.disabled=true;
    try{
      const response=await fetch('https://api.open-meteo.com/v1/forecast?'+params.toString(),{signal:request.signal,cache:'no-store'});
      if(!response.ok)throw new Error('Service météo : HTTP '+response.status);
      const data=await response.json();
      if(data.error)throw new Error(data.reason||'Requête refusée');
      if(localRequest!==requestNumber)return;
      const list=Array.isArray(data)?data:[data];
      if(list.length!==grid.length||!list.every(item=>Array.isArray(item.hourly?.time)))throw new Error('Grille de prévision incomplète');
      if(!list.every(item=>item.hourly.time[0]===list[0].hourly.time[0]))throw new Error('Horaires des modèles incompatibles');
      rows=list;
      // Use Open-Meteo's returned model grid/elevation, never fabricate snow at unsampled spots.
      time=list[0].hourly.time.map(s=>s+':00+01:00');
      // Hourly API timestamps are Europe/Paris local; avoid DST offset assumptions in display.
      time=list[0].hourly.time;
      const now=new Date();
      selected=0;
      const clockTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'}).format(now).replace(' ','T');
      for(let i=0;i<time.length;i++){if(time[i]>=clockTime){selected=i;break;}}
      el.slider.max=String(time.length-1);el.slider.disabled=false;
      setStatus('25 points · Open-Meteo Best Match · prévision, pas mesure');
      el.wait.hidden=true;
      if(!position)position={...CNE_ZONES[zoneId].points[0]};
      updateLegend();updateVisual();
    }catch(error){
      if(error.name==='AbortError')return;
      if(localRequest!==requestNumber)return;
      rows=[];time=[];
      clearRaster();
      el.when.textContent='Prévision indisponible';
      setStatus(String(error?.message||error),true);
    }
  }
  function shiftTime(step){selectTime(selected+step);}
  function selectTime(index){
    if(!time.length)return;
    selected=Math.max(0,Math.min(time.length-1,index));
    el.slider.value=String(selected);
    updateVisual();
  }
  function updateLegend(){
    const mode=el.layer.value;
    if(mode==='temp'){
      el.legend.textContent='Température modélisée à 2 m (°C)';
      el.scale.innerHTML='<span style="background:#4a6dd4">≤ −8</span><span style="background:#55aae5">−2</span><span style="background:#66cae6">+2</span><span style="background:#f8c768">+8</span><span style="background:#f0734c">≥ +9</span>';
      el.note.textContent='Couleur = température du modèle, pas une mesure en chaque point.';
    }else{
      el.legend.textContent=mode==='depth'?'Épaisseur de neige au sol (cm)':'Neige fraîche prévue sur 24 heures (cm)';
      el.scale.innerHTML='<span style="background:#b9e2fb;color:#1b3551">0–2</span><span style="background:#77bbf5;color:#19395a">2–5</span><span style="background:#5788e3">5–10</span><span style="background:#7165dc">10–20</span><span style="background:#b74bb5">20–40</span><span style="background:#f1266f">40+</span>';
      el.note.textContent='Couleur superposée au terrain : estimation du modèle interpolée, pas mesure ni volume réel de neige.';
    }
  }
  function clearRaster(){
    if(!map||!mapReady)return;
    if(map.getLayer('cne-forecast-raster'))map.removeLayer('cne-forecast-raster');
    if(map.getSource('cne-forecast-image'))map.removeSource('cne-forecast-image');
  }
  function renderRaster(){
    if(!map||!mapReady||!rows.length)return;
    const layer=el.layer.value;
    const zone=CNE_ZONES[zoneId];
    const size=128;
    const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d',{willReadFrequently:false});
    if(!ctx){setStatus('Canvas graphique indisponible',true);return;}
    const data=ctx.createImageData(size,size), west=zone.bounds[0][0], south=zone.bounds[0][1],east=zone.bounds[1][0],north=zone.bounds[1][1];
    let hasData=false;
    for(let y=0;y<size;y++){
      const lat=north-(north-south)*y/(size-1);
      for(let x=0;x<size;x++){
        const lon=west+(east-west)*x/(size-1);
        const value=cneInterpolate(rows,lon,lat,selected,layer);
        const color=cneColor(value,layer);
        const index=(y*size+x)*4;
        data.data[index]=color[0];data.data[index+1]=color[1];
        data.data[index+2]=color[2];
        // Blend tile edges softly, without filling unexplored geography.
        const fade=Math.min(1,x/7,(size-1-x)/7,y/7,(size-1-y)/7);
        data.data[index+3]=Math.round(color[3]*Math.max(0,fade));
        if(color[3]>0)hasData=true;
      }
    }
    ctx.putImageData(data,0,0);
    if(!hasData){clearRaster();return;}
    const url=canvas.toDataURL('image/png');
    const coordinates=[[west,north],[east,north],[east,south],[west,south]];
    const source=map.getSource('cne-forecast-image');
    if(source)source.updateImage({url,coordinates});
    else{
      map.addSource('cne-forecast-image',{type:'image',url,coordinates});
      map.addLayer({id:'cne-forecast-raster',type:'raster',source:'cne-forecast-image',paint:{'raster-opacity':0.83}});
    }
  }
  function updateVisual(){
    if(!time.length)return;
    el.slider.value=String(selected);
    const date=time[selected];
    el.when.textContent=new Date(date+'+01:00').toLocaleString('fr-FR',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'});
    // The source timestamps are local Paris wall times; text formatting never changes their hour.
    const parts=date.split('T');
    if(parts.length===2){
      const [y,m,d]=parts[0].split('-').map(Number);
      el.when.textContent=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(Date.UTC(y,m-1,d,12)))+' · '+parts[1].slice(0,5);
    }
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(()=>{
      renderRaster();
      for(const marker of markers){
        const near=cneNearest(rows,marker.point.lat,marker.point.lon);
        const temp=cneValue(near,'temp',selected),snow=cneValue(near,'depth',selected);
        marker.info.textContent=(temp===null?'T° —':Math.round(temp)+' °C')+' · '+(snow===null?'neige —':Math.round(snow)+' cm');
      }
      updateSelection();
    });
  }
  function updateSelection(){
    if(!position||!rows.length)return;
    const {lat,lon}=position;
    const depth=cneInterpolate(rows,lon,lat,selected,'depth');
    const fresh=cneInterpolate(rows,lon,lat,selected,'fresh');
    const temp=cneInterpolate(rows,lon,lat,selected,'temp');
    const iso=cneInterpolate(rows,lon,lat,selected,'iso0');
    const lpn=cneSnowline(iso);
    const elev=map?.queryTerrainElevation?.([lon,lat])??null;
    const fmt=(v,unit)=>v===null?'indisponible':Math.round(v)+(unit||'');
    const title=escapeText(position.name||'Point sélectionné');
    el.selection.innerHTML='<strong>'+title+'</strong>'+
      '<div class="cne-readings"><span>Neige au sol <b>'+fmt(depth,' cm')+'</b></span>'+
      '<span>Neige 24 h <b>'+fmt(fresh,' cm')+'</b></span>'+
      '<span>Température <b>'+fmt(temp,' °C')+'</b></span>'+
      '<span>Altitude DEM <b>'+fmt(elev,' m')+'</b></span>'+
      '<span>ISO 0 °C <b>'+fmt(iso,' m')+'</b></span>'+
      '<span>LPN indicative <b>'+fmt(lpn,' m')+'</b></span></div>'+
      '<small>'+lat.toFixed(4)+'° N, '+lon.toFixed(4)+'° E · valeurs interpolées entre mailles météo. LPN = approximation.</small>';
  }
}
