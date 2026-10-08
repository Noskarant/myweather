// Build geocoded custom MyWeather places from the official French address database.
// This file is intentionally public: users explicitly asked for named searchable addresses.
// Coordinates are NEVER inferred from the centre of a town or an approximate street match.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const BAN='https://data.geopf.fr/geocodage/search/';
export const CUSTOM_ADDRESSES=[
  {id:'maison-noe',name:'Maison Noé',admin1:'29 rue Tupin · 69600 Oullins',
    address:'29 rue Tupin, 69600 Oullins',city:'Oullins',postcode:'69600',
    cityCodes:['69149'],houseNumber:'29',streetTail:'tupin',
    queries:['29 rue Tupin 69600 Oullins','29 rue Tupin Oullins-Pierre-Bénite']},
  {id:'maison-kelian',name:'Maison Kélian',
    admin1:'40 rue de la Roche · Saint-Maurice-sur-Dargoire (69440)',
    address:'40 rue de la Roche, Saint-Maurice-sur-Dargoire, 69440 Chabanière',
    city:'Saint-Maurice-sur-Dargoire',postcode:'69440',
    cityCodes:['69228'],houseNumber:'40',streetTail:'de la roche',
    queries:['40 rue de la Roche 69440 Saint-Maurice-sur-Dargoire',
      '40 route de la Roche 69440 Chabanière',
      '40 rue de la Roche 69440 Chabanière']}
];

const simplify=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[-’']/g,' ').replace(/\s+/g,' ').trim();
function approved(feature,item){
  const p=feature?.properties||{};
  const point=feature?.geometry?.coordinates;
  const lat=Number(point?.[1]),lon=Number(point?.[0]);
  if(!Array.isArray(point)||!Number.isFinite(lat)||!Number.isFinite(lon)||
      lat<45.50||lat>45.80||lon<4.4||lon>4.95)return false;
  const house=String(p.housenumber??'').trim().replace(/\s+/g,'');
  const street=simplify(p.street??p.name??'');
  const postal=String(p.postcode??'');
  const cityCode=String(p.citycode??'');
  // A village centre/street centroid is never a substitute for a numbered address.
  if(p.type!=='housenumber'||house!==item.houseNumber ||
     postal!==item.postcode||!street.includes(item.streetTail))return false;
  if(cityCode && !item.cityCodes.includes(cityCode))return false;
  return true;
}
export function parseOfficialAddressCandidates(payload,item){
  return (Array.isArray(payload?.features)?payload.features:[])
    .filter(x=>approved(x,item))
    .map(feature=>{
      const p=feature.properties;
      return {
        id:item.id,name:item.name,admin1:item.admin1,country:'France',countryCode:'FR',
        address:item.address,officialAddress:String(p.label||item.address),
        lat:Number(feature.geometry.coordinates[1]),
        lon:Number(feature.geometry.coordinates[0]),
        elevation:null,timezone:'Europe/Paris',type:'Maison',
        source:'BAN',score:Number.isFinite(Number(p.score))?Number(p.score):0
      };
    }).sort((a,b)=>b.score-a.score);
}
export async function resolveCustomAddresses(fetcher=fetch) {
  const places=[];
  for(const item of CUSTOM_ADDRESSES){
    let selected=null;
    for(const text of item.queries){
      try {
        const params=new URLSearchParams({q:text,limit:'10',type:'housenumber',autocomplete:'0'});
        const r=await fetcher(BAN+'?'+params,{
          signal:AbortSignal.timeout(9000),headers:{accept:'application/json'}
        });
        if(!r.ok){console.warn('BAN address lookup HTTP',r.status,item.id);continue;}
        const body=await r.json();
        const found=parseOfficialAddressCandidates(body,item);
        if(found.length && (!selected||selected.score<found[0].score))selected=found[0];
        if(selected?.score>=0.88)break;
      }catch(e){console.warn('BAN address lookup unavailable',item.id,e?.name||'error');}
    }
    // Keep public search results only when housenumber and municipality are confirmed.
    if(selected){delete selected.score;places.push(selected);}
    console.log('Verified house address',item.id,selected?'exact_housenumber':'unresolved');
  }
  return {version:1,places};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const previousPath=new URL('../data/custom-places.json',import.meta.url);
  const data=await resolveCustomAddresses();
  if(data.places.length<CUSTOM_ADDRESSES.length){
    // If BAN is temporarily unavailable, preserve previously verified positions.
    try{
      const prior=JSON.parse(await readFile(previousPath,'utf8'));
      for(const item of CUSTOM_ADDRESSES){
        if(data.places.some(x=>x.id===item.id))continue;
        const known=prior.places?.find(x=>x.id===item.id&&x.source==='BAN'&&
          Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon)));
        if(known)data.places.push(known);
      }
    }catch{}
  }
  await mkdir(new URL('../data/',import.meta.url),{recursive:true});
  await writeFile(previousPath,JSON.stringify(data,null,2)+'\n');
  console.log('Verified MyWeather homes',data.places.map(x=>x.id).join(',')||'none');
}
