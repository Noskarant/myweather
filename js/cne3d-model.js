// 3D CNE — geometry and forecast transformations (no invented snow data).
// Snow depth from Open-Meteo is metres; snowfall is centimetres per hour.
// LPN is a rough diagnostic, never a measured or directly modelled snow line.
export const CNE_ZONES = Object.freeze({
  lyonnais: {
    title:'Monts du Lyonnais',
    subtitle:'Oullins · Yzeron · Saint-Martin-en-Haut · Saint-André-la-Côte',
    bounds:[[4.50,45.60],[4.85,45.78]],
    center:[4.668,45.692],
    zoom:10.55,
    pitch:65,
    points:[
      {name:'Oullins',lat:45.716,lon:4.807},
      {name:'Yzeron',lat:45.707,lon:4.591},
      {name:'Saint-Martin-en-Haut',lat:45.660,lon:4.559},
      {name:'Saint-André-la-Côte',lat:45.6299,lon:4.6004}
    ]
  },
  valmorel: {
    title:'Valmorel et vallée du Morel',
    subtitle:'Le Meiller · station · Planchamp · haute vallée',
    bounds:[[6.37,45.39],[6.56,45.53]],
    center:[6.453,45.463],
    zoom:11.25,
    pitch:67,
    points:[
      {name:'Le Meiller',lat:45.4795,lon:6.45696},
      {name:'Valmorel',lat:45.461,lon:6.443},
      {name:'Planchamp',lat:45.452,lon:6.437}
    ]
  },
  pilat: {
    title:'Massif du Pilat',
    subtitle:'Le Bessat · crêts · vallées proches',
    bounds:[[4.44,45.27],[4.73,45.47]],
    center:[4.574,45.384],
    zoom:11,
    pitch:67,
    points:[
      {name:'Le Bessat',lat:45.369,lon:4.516},
      {name:'Crêt de la Perdrix',lat:45.3825,lon:4.5728},
      {name:'Col de la Croix de Chaubouret',lat:45.374,lon:4.544}
    ]
  }
});

export function cneGrid(bounds, size=5) {
  if (!Array.isArray(bounds) || size<2 || size>8) throw new Error('Grille CNE invalide');
  const [west,south]=bounds[0], [east,north]=bounds[1];
  const points=[];
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    points.push({
      lon:west+(east-west)*x/(size-1),
      lat:north-(north-south)*y/(size-1)
    });
  }
  return points;
}

export function cneFinite(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

export function cneAt(row, field, index) {
  return cneFinite(row?.hourly?.[field]?.[index]);
}

export function cneValue(row, layer, index) {
  if (!Number.isInteger(index) || index<0) return null;
  if (layer==='depth') {
    const metres=cneAt(row,'snow_depth',index);
    return metres===null ? null : Math.max(0,metres*100);
  }
  if (layer==='fresh') {
    // Rolling 24-hour forecast total. Do not fill absent hourly values with zero.
    let total=0;
    for (let i=Math.max(0,index-23);i<=index;i++){
      const v=cneAt(row,'snowfall',i);
      if(v===null)return null;
      total+=Math.max(0,v);
    }
    return total;
  }
  if (layer==='temp') return cneAt(row,'temperature_2m',index);
  if (layer==='iso0') return cneAt(row,'freezing_level_height',index);
  return null;
}

export function cneNearest(rows, lat, lon) {
  let best=null, distance=Infinity;
  for (const row of rows||[]){
    if (!Number.isFinite(row.latitude)||!Number.isFinite(row.longitude)) continue;
    const dy=(row.latitude-lat);
    const dx=(row.longitude-lon)*Math.cos(lat*Math.PI/180);
    const d=dx*dx+dy*dy;
    if(d<distance){best=row;distance=d;}
  }
  return best;
}

export function cneInterpolate(rows, lon, lat, index, layer) {
  const values=[];
  for (const row of rows||[]){
    const val=cneValue(row,layer,index);
    if(val===null)continue;
    const dx=(row.longitude-lon)*Math.cos(lat*Math.PI/180),dy=row.latitude-lat;
    const d2=dx*dx+dy*dy;
    if(d2<1e-10)return val;
    values.push({d2,val});
  }
  if(!values.length)return null;
  values.sort((a,b)=>a.d2-b.d2);
  // Use the closest four samples: never extrapolate precision from a coarse model grid.
  let sum=0,weight=0;
  for(const row of values.slice(0,4)){
    const w=1/row.d2;
    sum+=row.val*w; weight+=w;
  }
  return weight ? sum/weight : null;
}

export function cneSnowline(freezingHeight) {
  // Approximation only: humidity, wet bulb, precipitation rate and orography matter.
  const iso=cneFinite(freezingHeight);
  return iso===null ? null : Math.max(0,Math.round((iso-300)/50)*50);
}

export function cneColor(value,layer) {
  if(value===null)return [0,0,0,0];
  if(layer==='temp'){
    if(value<=-8)return [74,109,212,190];
    if(value<=-2)return [85,170,229,180];
    if(value<=2)return [102,202,230,164];
    if(value<=8)return [248,199,104,164];
    return [240,115,76,178];
  }
  if(layer==='iso0')return [89,190,233,140];
  if(layer==='lpn') {
    if(value<500)return [59,132,221,188];
    if(value<1000)return [92,180,235,185];
    if(value<1500)return [108,203,232,182];
    if(value<2000)return [134,183,160,182];
    if(value<2500)return [239,185,106,184];
    return [232,135,102,191];
  }
  if(value<0.2)return [0,0,0,0];
  if(value<2)return [185,226,251,136];
  if(value<5)return [119,187,245,165];
  if(value<10)return [87,136,227,179];
  if(value<20)return [113,101,220,191];
  if(value<40)return [183,75,181,196];
  if(value<80)return [224,59,142,204];
  return [241,38,111,210];
}
