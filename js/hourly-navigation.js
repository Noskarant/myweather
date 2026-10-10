// Historical hours belong to the hourly rail only. Keep forecast days,
// today's summary and the opening position of the carousel unchanged.
export function hourlyRailWindow(hours, localNow){
  if(!Array.isArray(hours)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(localNow||''))
    return {items:[],currentIndex:0};
  // UTC noon arithmetic ensures yesterday's CALENDAR date is correct even
  // for locations ahead/behind France and across daylight-saving changes.
  const yesterday=new Date(Date.parse(localNow.slice(0,10)+'T12:00:00Z')-86400000)
    .toISOString().slice(0,10);
  const from=yesterday+'T00:00';
  const items=hours.filter(h=>typeof h?.time==='string'&&h.time>=from);
  const currentHour=localNow.slice(0,13);
  const index=items.findIndex(h=>h.time.slice(0,13)>=currentHour);
  return {items,currentIndex:index<0?Math.max(0,items.length-1):index};
}
