// Optional Météo-France departmental vigilance snapshot for the static GitHub Pages site.
// Requires METEOFRANCE_VIGILANCE_TOKEN (OAuth bearer, with DPVigilance access).
// Never store credentials, raw private response or a stale official warning in Pages.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const endpoint='https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
const target=fileURLToPath(new URL('../data/vigilance.json',import.meta.url));
const kinds={'1':'wind','2':'rain','3':'thunder','4':'flood','5':'snow','6':'heat','7':'cold','8':'avalanche','9':'coast'};
function parisDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  const entries=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(date).reduce((r,p)=>({...r,[p.type]:p.value}),{});
  return entries.year+'-'+entries.month+'-'+entries.day;
}
export function sanitizeVigilance(payload,now=Date.now()){
  const stamp=payload?.meta?.product_datetime||payload?.product?.update_time;
  const time=Date.parse(stamp||'');
  if(!Number.isFinite(time)||time>now+15*60000||now-time>14*3600000)return null;
  const periods=payload?.product?.periods;
  if(!Array.isArray(periods))return null;
  const days=[];
  for(const p of periods){
    const date=parisDate(p.begin_validity_time);
    if(!date||!Array.isArray(p?.timelaps?.domain_ids))continue;
    const departments={};
    for(const dep of p.timelaps.domain_ids){
      const code=String(dep?.domain_id||'');
      if(!/^(?:\d{2,3}|2A|2B)$/.test(code))continue;
      const findings=[];
      for(const event of dep.phenomenon_items||[]){
        const kind=kinds[String(event.phenomenon_id)];
        const color=Number(event.phenomenon_max_color_id);
        if(kind&&Number.isInteger(color)&&color>=2&&color<=4){
          const maximum=Math.max(color,...(event.timelaps_items||[]).map(x=>Number(x.color_id)).filter(v=>Number.isInteger(v)&&v>=1&&v<=4));
          findings.push({kind,level:maximum-1});
        }
      }
      if(findings.length)departments[code]=findings;
    }
    days.push({date,departments});
  }
  if(!days.length)return null;
  return {schema:1,source:'Météo-France',updatedAt:new Date(time).toISOString(),days};
}
export async function collectVigilance(token,now=Date.now(),fetcher=fetch){
  if(!token)return null;
  try{
    const response=await fetcher(endpoint,{
      headers:{'accept':'application/json','Authorization':'Bearer '+token},
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok){console.warn('DPVigilance indisponible (HTTP '+response.status+')');return null;}
    return sanitizeVigilance(await response.json(),now);
  }catch(error){
    console.warn('DPVigilance indisponible',String(error?.message||error).slice(0,150));
    return null;
  }
}
async function main(){
  // Always publish an explicit empty status rather than reusing a stale file.
  const result=await collectVigilance(process.env.METEOFRANCE_VIGILANCE_TOKEN||'');
  await mkdir(new URL('../data/',import.meta.url),{recursive:true});
  await writeFile(target,JSON.stringify(result||{schema:1,status:'unavailable',days:[]},null,2)+'\n');
  console.log('Official vigilance:',result?'ready':'not configured or unavailable');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]))){
  main().catch(err=>{console.warn('Vigilance snapshot fallback',String(err));process.exitCode=0;});
}
