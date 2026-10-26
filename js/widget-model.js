/**
 * Pure presentation helpers shared by the Windows widget and its tests.
 * No changes to the main PWA forecast logic.
 */
export const DEFAULT_WIDGET_PLACE = Object.freeze({
  name:'Oullins',admin1:'Auvergne-Rhône-Alpes',country:'France',
  lat:45.714,lon:4.807,elevation:180,timezone:'Europe/Paris'
});

export const finite = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const rounded = value => finite(value) == null ? '—' : String(Math.round(Number(value)));
export const isValidPlace = place => Boolean(
  place && typeof place.name === 'string' && place.name.trim() && place.name.length <= 180 &&
  finite(place.lat) !== null && finite(place.lon) !== null &&
  Math.abs(Number(place.lat)) <= 90 && Math.abs(Number(place.lon)) <= 180
);
export function normalizePlace(place){
  if(!isValidPlace(place))return null;
  return {
    name:place.name.trim(),admin1:String(place.admin1||''),
    department:String(place.department||place.admin2||''),
    departmentCode:String(place.departmentCode||''),
    country:String(place.country||''),
    lat:Number(place.lat),lon:Number(place.lon),elevation:finite(place.elevation),
    timezone:String(place.timezone||'auto')
  };
}
export function locationLabel(place){
  if(!place)return '';
  const parts=[];
  const department=String(place.department||place.admin2||'').trim();
  const code=String(place.departmentCode||'').trim();
  if(department)parts.push(department+(code&&!department.includes(code)?' ('+code+')':''));
  else if(code)parts.push('Département '+code);
  if(place.admin1 && place.admin1!==department)parts.push(String(place.admin1));
  if(!parts.length && place.country)parts.push(String(place.country));
  return parts.join(' · ');
}
export function placeSuggestion(place){
  return {name:String(place.name||''),detail:locationLabel(place)||String(place.type||place.country||'')};
}
export function chooseHours(forecast,limit=36){
  const hours=Array.isArray(forecast?.hourly)?forecast.hourly:[];
  if(!hours.length)return [];
  const now=String(forecast?.current?.time||'');
  // Open-Meteo local timestamps are ISO strings without UTC offset.
  // Compare local wall-clock strings consistently instead of parsing as computer-local time.
  let index=hours.findIndex(h=>String(h.time||'').slice(0,13)===now.slice(0,13));
  if(index<0)index=hours.findIndex(h=>String(h.time||'')>=now);
  return hours.slice(index<0?Math.max(hours.length-1,0):index,index<0?hours.length:index+limit);
}
export function shouldShowMountain(place,hour){
  return finite(place?.elevation)!=null && Number(place.elevation)>=650 ||
    finite(hour?.snowLevel)!=null && finite(place?.elevation)!=null && Number(place.elevation)>=450;
}
export function futureSnowSum(hours,count=24){
  return (hours||[]).slice(0,count).reduce((sum,h)=>sum+Math.max(0,finite(h?.snowfall)??0),0);
}
export function parseDepartmentCode(place){
  const candidate=String(place?.departmentCode||place?.department_code||'').toUpperCase();
  if(/^(?:0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])$/.test(candidate))return candidate;
  const regionCode=String(place?.isoDepartment||'');
  const code=/FR-(2A|2B|\d{2,3})$/i.exec(regionCode)?.[1]?.toUpperCase();
  if(code)return code;
  const postcode=String(place?.postcode||'');
  if(/^97[1-6]/.test(postcode))return postcode.slice(0,3);
  if(/^\d{5}$/.test(postcode)){
    if(postcode.startsWith('20'))return Number(postcode.slice(0,3))<202?'2A':'2B';
    return postcode.slice(0,2);
  }
  return '';
}
export function mergeUniquePlaces(candidates){
  const keys=new Set();
  return (candidates||[]).filter(isValidPlace).filter(p=>{
    const key=Number(p.lat).toFixed(4)+':'+Number(p.lon).toFixed(4);
    if(keys.has(key))return false;
    keys.add(key);return true;
  });
}
