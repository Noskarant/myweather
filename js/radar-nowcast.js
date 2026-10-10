// Radar motion estimate using two observed RainViewer radar images. RainViewer
// no longer supplies future radar frames (2026). Never use an unverified
// movement or missing/blocked radar tiles to invent a minute-by-minute ETA.
const API='https://api.rainviewer.com/public/weather-maps.json';
function wet(mask,x,y,size){
  let hits=0,total=0;
  for(let j=Math.max(0,Math.round(y)-2);j<=Math.min(size-1,Math.round(y)+2);j++)
    for(let i=Math.max(0,Math.round(x)-2);i<=Math.min(size-1,Math.round(x)+2);i++){
      hits+=mask[j*size+i]>0?1:0;total++;
    }
  return total>0&&hits/total>=.12;
}
export function estimateRadarMotion(before,after,size,intervalMinutes,frameEpoch,now=Date.now()){
  if(!Number.isInteger(size)||size<96||before?.length!==size*size||
      after?.length!==size*size||!Number.isFinite(frameEpoch)||
      !Number.isFinite(intervalMinutes)||intervalMinutes<4||intervalMinutes>20||
      now-frameEpoch>18*60000||frameEpoch-now>3*60000)return null;
  const center=Math.floor(size/2),span=Math.min(100,Math.floor(size*.38));
  let aCount=0,bCount=0;
  for(let y=center-span;y<center+span;y+=3)for(let x=center-span;x<center+span;x+=3){
    aCount+=before[y*size+x]>0?1:0;bCount+=after[y*size+x]>0?1:0;
  }
  if(aCount<30||bCount<30)return null;
  const limit=Math.min(18,Math.max(6,Math.round(intervalMinutes*1.6)));
  let best=null;
  for(let dy=-limit;dy<=limit;dy+=2)for(let dx=-limit;dx<=limit;dx+=2){
    let aa=0,bb=0,hit=0;
    for(let y=center-span;y<center+span;y+=3){
      const ny=y+dy;if(ny<0||ny>=size)continue;
      for(let x=center-span;x<center+span;x+=3){
        const nx=x+dx;if(nx<0||nx>=size)continue;
        const first=before[y*size+x]>0,last=after[ny*size+nx]>0;
        if(first)aa++;if(last)bb++;if(first&&last)hit++;
      }
    }
    const overlap=hit/Math.max(1,Math.sqrt(aa*bb));
    const score=overlap-.00015*(dx*dx+dy*dy);
    if(!best||score>best.score)best={dx,dy,overlap,score,hit};
  }
  // Sparse, shifting radar noise or uniform broad coverage: no credible motion.
  if(!best||best.overlap<.52||best.hit<24||
    (aCount>.9*(span*2/3)**2&&bCount>.9*(span*2/3)**2))return null;
  const predicted=minute=>wet(after,center-best.dx*minute/intervalMinutes,
    center-best.dy*minute/intervalMinutes,size);
  const minNow=Math.max(0,Math.ceil((now-frameEpoch)/60000));
  if(minNow>15)return null;
  const initiallyWet=predicted(minNow);
  const maxMinutes=Math.min(60,Math.floor((span-10)/
    Math.max(.5,Math.hypot(best.dx,best.dy))*intervalMinutes));
  for(let minute=minNow+1;minute<=maxMinutes-3;minute++){
    const next=predicted(minute);
    if(next===initiallyWet)continue;
    if(predicted(minute+1)!==next||predicted(minute+2)!==next||
      predicted(minute+3)!==next)continue;
    if(minute>=minNow+3&&predicted(minute-2)!==initiallyWet)continue;
    const epoch=frameEpoch+minute*60000;
    if(epoch<=now||epoch>now+60*60000)continue;
    return {type:next?'start':'stop',epoch,source:'rainviewer',
      frameEpoch,confidence:best.overlap};
  }
  return null;
}
function raster(image){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=256;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('radar canvas unavailable');
  context.drawImage(image,0,0,256,256);
  const rgba=context.getImageData(0,0,256,256).data;
  const mask=new Uint8Array(256*256);
  for(let i=0;i<mask.length;i++)mask[i]=rgba[i*4+3]>=75?1:0;
  return mask;
}
function tile(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.crossOrigin='anonymous';
    const timer=setTimeout(()=>{img.onload=img.onerror=null;reject(new Error('radar timeout'));},5000);
    img.onload=()=>{clearTimeout(timer);try{resolve(raster(img));}catch(e){reject(e);}};
    img.onerror=()=>{clearTimeout(timer);reject(new Error('radar unavailable'));};
    img.src=url;
  });
}
export async function fetchRadarTransition(location,now=Date.now()){
  const lat=Number(location?.lat),lon=Number(location?.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||
    Math.abs(lon)>180||typeof document==='undefined'||typeof Image==='undefined')return null;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    let response;
    try{response=await fetch(API,{signal:controller.signal,cache:'no-store'});}
    finally{clearTimeout(timer);}
    if(!response.ok)return null;
    const meta=await response.json();
    if(meta.host!=='https://tilecache.rainviewer.com')return null;
    const frames=(meta.radar?.past||[]).filter(x=>Number.isFinite(x.time)&&
      typeof x.path==='string'&&x.path.startsWith('/v2/radar/')&&
      /^[a-zA-Z0-9]+$/.test(x.path.slice('/v2/radar/'.length)));
    const [oldFrame,newFrame]=frames.slice(-2);
    if(!oldFrame||!newFrame)return null;
    const at=newFrame.time*1000,spacing=(newFrame.time-oldFrame.time)/60;
    if(now-at>18*60000||at-now>3*60000||spacing<4||spacing>20)return null;
    const center=lat.toFixed(4)+'/'+lon.toFixed(4);
    const url=f=>meta.host+f.path+'/256/7/'+center+'/2/0_0.png';
    const [oldMask,newMask]=await Promise.all([tile(url(oldFrame)),tile(url(newFrame))]);
    return estimateRadarMotion(oldMask,newMask,256,spacing,at,now);
  }catch{return null;}
}
