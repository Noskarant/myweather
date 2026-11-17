// Chronology for the experimental 3D CNE map.
// No fake data: gaps remain gaps; daily mode samples 12:00 local of each day.
import { cneInterpolate, cneSnowline } from './cne3d-model.js?v=1';

export function cneChartPoints(rows, times, position, layer, mode='hour') {
  if (!position || !Array.isArray(times)) return [];
  const indices=times.map((_,i)=>i);
  const selected=mode==='day'
    ? indices.filter(i=>String(times[i]).endsWith('T12:00'))
    : indices;
  return selected.map(index=>{
    const time=times[index];
    const value=layer==='lpn'
      ? cneSnowline(cneInterpolate(rows,position.lon,position.lat,index,'iso0'))
      : cneInterpolate(rows,position.lon,position.lat,index,layer);
    return {index,time,value};
  });
}
function safeNumber(n){return typeof n==='number'&&Number.isFinite(n);}
function labelDay(time){const d=String(time).slice(5,10).split('-');return d.length===2?d[1]+'/'+d[0]:'';}
function chartUnits(layer){return layer==='temp'?'°C':layer==='lpn'?'m':'cm';}
function chartLabel(layer){return ({depth:'Neige au sol',fresh:'Neige fraîche (24 h)',temp:'Température',lpn:'LPN indicative'})[layer]||'Prévision';}
function formatValue(n,layer){return n===null?'—':Math.round(n)+(chartUnits(layer));}

export function mountCNEChronology(container, onSelect) {
  const view=document.createElement('aside');
  view.className='cne-chart';
  view.setAttribute('aria-label','Courbe chronologique des prévisions');
  view.innerHTML=[
    '<div class="cne-chart-top">',
      '<div class="cne-chart-title">Évolution <small id="cneChartUnits">Neige au sol</small></div>',
      '<button class="cne-chart-fold" id="cneChartFold" type="button" aria-label="Réduire la chronologie" aria-expanded="true">⌄</button>',
    '</div>',
    '<div class="cne-chart-body" id="cneChartBody">',
      '<div class="cne-chart-switch" role="group" aria-label="Résolution temporelle">',
        '<button type="button" class="active" data-cne-chart-mode="hour" aria-pressed="true">Par heure</button>',
        '<button type="button" data-cne-chart-mode="day" aria-pressed="false">Par jour</button>',
      '</div>',
      '<div class="cne-chart-plot" id="cneChartPlot"><span>Chargement des prévisions…</span></div>',
      '<div class="cne-chart-foot"><span id="cneChartDate">—</span><strong id="cneChartValue">—</strong></div>',
    '</div>'
  ].join('');
  container.appendChild(view);
  const plot=view.querySelector('#cneChartPlot'), date=view.querySelector('#cneChartDate');
  const value=view.querySelector('#cneChartValue'), label=view.querySelector('#cneChartUnits');
  const fold=view.querySelector('#cneChartFold');
  let mode='hour',rows=[],times=[],position=null,layer='depth',selected=0,points=[];
  const resize=()=>render();
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
  observer?.observe(plot);

  fold.addEventListener('click',()=>{
    const collapsed=view.classList.toggle('cne-chart-collapsed');
    fold.setAttribute('aria-expanded',String(!collapsed));
    fold.setAttribute('aria-label',collapsed?'Déplier la chronologie':'Réduire la chronologie');
    fold.textContent=collapsed?'⌃':'⌄';
  });
  view.querySelectorAll('[data-cne-chart-mode]').forEach(button=>button.addEventListener('click',()=>{
    mode=button.dataset.cneChartMode;
    view.querySelectorAll('[data-cne-chart-mode]').forEach(b=>{
      const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
    });
    render();
  }));
  plot.addEventListener('click',event=>{
    if(!points.length)return;
    const rect=plot.getBoundingClientRect();
    if(!rect.width)return;
    const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const chosen=points[Math.min(points.length-1,Math.round(x*(points.length-1)))];
    if(chosen)onSelect(chosen.index);
  });
  plot.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    const delta=event.key==='ArrowRight'?1:-1;
    const nearest=points.reduce((best,p,i)=>Math.abs(p.index-selected)<Math.abs(points[best]?.index-selected??Infinity)?i:best,0);
    const next=points[Math.max(0,Math.min(points.length-1,nearest+delta))];
    if(next)onSelect(next.index);
  });

  function update(payload){
    rows=payload.rows||[];
    times=payload.times||[];
    position=payload.position||null;
    layer=payload.layer||'depth';
    selected=payload.selected||0;
    render();
  }
  function render(){
    label.textContent=chartLabel(layer);
    const dateString=times[selected]||'';
    date.textContent=dateString?dateString.slice(8,10)+'/'+dateString.slice(5,7)+' · '+dateString.slice(11,16):'—';
    if(!rows.length||!times.length||!position){
      plot.innerHTML='<span class="cne-chart-empty">Prévisions indisponibles</span>';
      value.textContent='—';
      points=[];return;
    }
    points=cneChartPoints(rows,times,position,layer,mode);
    let current=layer==='lpn'
      ? cneSnowline(cneInterpolate(rows,position.lon,position.lat,selected,'iso0'))
      : cneInterpolate(rows,position.lon,position.lat,selected,layer);
    value.textContent=formatValue(current,layer);
    const valid=points.filter(p=>safeNumber(p.value));
    if(!valid.length){
      plot.innerHTML='<span class="cne-chart-empty">Aucune donnée pour cette variable</span>';return;
    }
    const width=340,height=96,padX=4,padY=14,plotH=height-2*padY;
    let min=Math.min(...valid.map(p=>p.value)),max=Math.max(...valid.map(p=>p.value));
    if(min===max){min-=1;max+=1;}
    else {const room=Math.max(1,(max-min)*0.14);min-=room;max+=room;}
    if(layer==='depth'||layer==='fresh')min=Math.max(0,min);
    const x=i=>padX+(i/Math.max(1,points.length-1))*(width-2*padX);
    const y=v=>padY+(max-v)/(max-min)*plotH;
    // Draw disjoint line segments only where the source provides actual values.
    const segments=[];let run=[];
    points.forEach((p,i)=>{
      if(safeNumber(p.value)){run.push([x(i),y(p.value)]);}
      else if(run.length){segments.push(run);run=[];}
    });if(run.length)segments.push(run);
    const paths=segments.map(segment=>'<path d="'+segment.map(([xx,yy],i)=>(i?'L':'M')+xx.toFixed(1)+' '+yy.toFixed(1)).join(' ')+'" fill="none" stroke="#74d4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />').join('');
    const focusIndex=points.reduce((best,p,i)=>Math.abs(p.index-selected)<Math.abs(points[best]?.index-selected??Infinity)?i:best,0);
    const focus=points[focusIndex];
    const dot=safeNumber(focus?.value)?'<circle cx="'+x(focusIndex).toFixed(1)+'" cy="'+y(focus.value).toFixed(1)+'" r="4.5" fill="#f8fcff" stroke="#2278af" stroke-width="2.5"/>':'';
    const tickCount=Math.min(4,points.length);
    const ticks=Array.from({length:tickCount},(_,i)=>{
      const index=Math.round(i*(points.length-1)/Math.max(1,tickCount-1));
      const p=points[index];
      return '<text x="'+x(index).toFixed(1)+'" y="112" text-anchor="'+(i===0?'start':i===tickCount-1?'end':'middle')+'" fill="#a9ccdd" font-size="11">'+(mode==='day'?labelDay(p.time):p.time.slice(8,10)+'/'+p.time.slice(5,7))+'</text>';
    }).join('');
    const a11y=chartLabel(layer)+' : '+valid.length+' échéances disponibles, '+formatValue(current,layer)+' à l’heure sélectionnée.';
    plot.innerHTML='<svg viewBox="0 0 340 118" role="img" aria-label="'+a11y+'" preserveAspectRatio="none">'+
      '<path d="M4 82 H336" stroke="rgba(173,213,231,.2)" stroke-width="1"/>'+
      '<path d="M4 48 H336" stroke="rgba(173,213,231,.14)" stroke-width="1"/>'+
      paths+dot+ticks+'</svg>';
    plot.tabIndex=0;
    plot.setAttribute('role','slider');
    plot.setAttribute('aria-label','Choisir une heure ou un jour sur la chronologie');
    plot.setAttribute('aria-valuemin','0');
    plot.setAttribute('aria-valuemax',String(Math.max(0,points.length-1)));
    plot.setAttribute('aria-valuenow',String(focusIndex));
    plot.setAttribute('aria-valuetext',date.textContent+' ; '+formatValue(current,layer));
  }
  return {update, destroy(){observer?.disconnect();view.remove();}};
}
