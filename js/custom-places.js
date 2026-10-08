// User-requested exact household search aliases.
// Coordinates come ONLY from pre-verified numbered addresses in the published
// BAN snapshot, never from a generic city or street geocoder response.
const SNAPSHOT = new URL('../data/custom-places.json',import.meta.url);
const normalize=text=>String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[-’']/g,' ').replace(/\s+/g,' ').trim();

const ENTRIES=[
  {id:'maison-noe',aliases:['maison noe','noe','29 rue tupin','29 r tupin']},
  {id:'maison-kelian',aliases:['maison kelian','kelian','40 rue de la roche',
    '40 route de la roche','40 r de la roche']}
];
export function matchCustomPlaceAliases(query){
  const q=normalize(query);
  if(q.length<3)return [];
  return ENTRIES.filter(entry=>entry.aliases.some(alias=>
    alias.startsWith(q)||q===alias||q.startsWith(alias+' ')
  )).map(entry=>entry.id);
}
let cache=null,expires=0;
export async function loadCustomPlaces(fetcher=fetch,now=Date.now()){
  if(cache&&expires>now)return cache;
  try{
    const r=await fetcher(SNAPSHOT.href,{
      cache:'no-store',signal:AbortSignal.timeout(2400)
    });
    if(!r.ok)return [];
    const data=await r.json();
    if(!Array.isArray(data?.places))return [];
    const known=new Set(ENTRIES.map(entry=>entry.id));
    const accepted=data.places.filter(place=>
      known.has(place.id)&&place.source==='BAN'&&
      Number.isFinite(Number(place.lat))&&Number.isFinite(Number(place.lon))&&
      Number(place.lat)>45.5&&Number(place.lat)<45.8&&
      Number(place.lon)>4.4&&Number(place.lon)<4.95
    );
    if(fetcher===fetch){cache=accepted;expires=now+8*60_000;}
    return accepted;
  }catch{return [];}
}
export async function searchCustomPlaces(query,fetcher=fetch){
  const ids=matchCustomPlaceAliases(query);
  if(!ids.length)return null; // Caller continues its existing worldwide search.
  const places=await loadCustomPlaces(fetcher);
  return ids.map(id=>places.find(p=>p.id===id)).filter(Boolean);
}
