'use strict';
const {app,BrowserWindow,Menu,Tray,ipcMain,net,protocol,screen,shell,nativeImage,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const SCHEME='myweather-app';
const WEBSITE='https://noskarant.github.io/myweather/';
protocol.registerSchemesAsPrivileged([{scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,tray;
const root=()=>app.isPackaged?path.join(process.resourcesPath,'site'):path.resolve(__dirname,'..');
function serve(){
 protocol.handle(SCHEME,request=>{
  let u;
  try{u=new URL(request.url)}catch{return new Response('Invalid URL',{status:400})}
  if(u.hostname!=='local')return new Response('Invalid origin',{status:403});
  let pathname;
  try{pathname=decodeURIComponent(u.pathname)}catch{return new Response('Invalid path',{status:400})}
  if(pathname.includes('\\')||pathname.includes('\0'))return new Response('Forbidden',{status:403});
  const base=root(),file=path.resolve(base,'.'+pathname);
  if(file!==base&&!file.startsWith(base+path.sep))return new Response('Forbidden',{status:403});
  return net.fetch(pathToFileURL(file).toString());
 });
}
function bounds(){
 const area=screen.getPrimaryDisplay().workArea;
 const width=356,height=410,gap=14;
 const fallback={width,height,x:area.x+area.width-width-gap,y:area.y+14};
 const marker=path.join(app.getPath('userData'),'compact-layout-v1');
 let previous;
 try{previous=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'bounds.json'),'utf8'))}catch{return fallback}
 if(!previous||![previous.x,previous.y,previous.width,previous.height].every(Number.isFinite))return fallback;
 const visible=screen.getAllDisplays().some(d=>previous.x<d.bounds.x+d.bounds.width-60 &&
  previous.x+previous.width>d.bounds.x+60 &&
  previous.y<d.bounds.y+d.bounds.height-60 &&
  previous.y+previous.height>d.bounds.y+60);
 if(!visible)return fallback;
 // Existing 1.1 installations stored an oversized 412x590 layout. Compact it
 // exactly once, retaining the old right edge and top position where possible.
 if(!fs.existsSync(marker)){
  try{fs.writeFileSync(marker,'1')}catch(error){console.warn('Widget layout migration',error)}
  return {
   width,height,
   x:Math.max(area.x+8,Math.min(area.x+area.width-width-8,previous.x+previous.width-width)),
   y:Math.max(area.y+8,Math.min(area.y+area.height-height-8,previous.y))
  };
 }
 if(previous.width<325||previous.height<365||previous.width>620||previous.height>680)return fallback;
 return previous;
}
function pinDesktop(){
 if(process.platform!=='win32'||!win||win.isDestroyed())return;
 const buffer=win.getNativeWindowHandle();
 const hwnd=buffer.length===8?buffer.readBigUInt64LE(0).toString():String(buffer.readUInt32LE(0));
 const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'attach-desktop.ps1'),'-Hwnd',hwnd],{windowsHide:true,stdio:'ignore'});
 ps.on('error',error=>console.warn('Explorer desktop attachment unavailable',error.message));
 ps.on('exit',code=>{if(code!==0)console.warn('Explorer desktop attachment failed; widget remains an ordinary non-topmost window')});
}
function createTray(){
 let icon=nativeImage.createFromPath(path.join(root(),'assets','icon-192.png'));
 if(icon.isEmpty())icon=nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlPTJ0AAAAASUVORK5CYII=','base64'));
 tray=new Tray(icon.resize({width:16,height:16}));
 tray.setToolTip('MyWeather · Widget Bureau');
 tray.setContextMenu(Menu.buildFromTemplate([
  {label:'Afficher le widget',click:()=>win?.showInactive()},
  {label:'Ouvrir MyWeather',click:()=>shell.openExternal(WEBSITE)},
  {type:'separator'},
  {label:'Taille compacte',click:()=>win?.setSize(356,410)},
  {label:'Taille confortable',click:()=>win?.setSize(390,470)},
  {type:'separator'},
  {label:'Démarrer avec Windows',type:'checkbox',checked:app.getLoginItemSettings().openAtLogin,click:item=>app.setLoginItemSettings({openAtLogin:item.checked})},
  {label:'Quitter',click:()=>app.quit()}
 ]));
 tray.on('double-click',()=>win?.showInactive());
}
function getWindowsLocation(){
 return new Promise(resolve=>{
  if(process.platform!=='win32'){resolve({ok:false,error:'Windows required'});return}
  const script=path.join(__dirname,'get-location.ps1');
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{
   windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  let output='',err='',finished=false;
  const done=value=>{if(!finished){finished=true;clearTimeout(timer);resolve(value)}};
  const timer=setTimeout(()=>{child.kill();done({ok:false,error:'Windows position timeout'})},12000);
  child.stdout.on('data',chunk=>{if(output.length<2048)output+=String(chunk)});
  child.stderr.on('data',chunk=>{if(err.length<1024)err+=String(chunk)});
  child.once('error',e=>done({ok:false,error:e.message}));
  child.once('close',()=>{
   try{
    const result=JSON.parse(output.trim());
    const lat=Number(result.lat),lon=Number(result.lon);
    if(result.ok&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180)done({ok:true,lat,lon});
    else done({ok:false,error:String(result.error||err||'Location unavailable').slice(0,180)});
   }catch{done({ok:false,error:String(err||'Location provider unavailable').slice(0,180)})}
  });
 });
}
function openWindow(){
 win=new BrowserWindow({
  ...bounds(),minWidth:325,minHeight:365,maxWidth:620,maxHeight:680,
  frame:false,transparent:true,hasShadow:false,skipTaskbar:true,
  alwaysOnTop:false,show:false,autoHideMenuBar:true,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}
 });
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(SCHEME+'://local/'))e.preventDefault()});
 win.webContents.on('context-menu',()=>Menu.buildFromTemplate([
  {label:'Actualiser',click:()=>win.webContents.reload()},
  {label:'Ouvrir MyWeather',click:()=>shell.openExternal(WEBSITE)},
  {type:'separator'},{label:'Quitter',click:()=>app.quit()}
 ]).popup({window:win}));
 let saveTimeout;
 const save=()=>{
  clearTimeout(saveTimeout);
  saveTimeout=setTimeout(()=>{
   if(!win||win.isDestroyed())return;
   const b=win.getBounds();
   const plausible=screen.getAllDisplays().some(d=>b.x>=d.bounds.x-100&&b.y>=d.bounds.y-100&&b.x<d.bounds.x+d.bounds.width&&b.y<d.bounds.y+d.bounds.height);
   if(!plausible)return;
   try{fs.writeFileSync(path.join(app.getPath('userData'),'bounds.json'),JSON.stringify(b))}catch(e){console.warn(e)}
  },350);
 };
 win.on('moved',save);win.on('resized',save);
 win.once('ready-to-show',()=>{win.showInactive();setTimeout(pinDesktop,600)});
 void win.loadURL(SCHEME+'://local/widget.html');
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>win?.showInactive());
 app.whenReady().then(()=>{
  serve();
  ipcMain.handle('myweather:openWebsite',()=>shell.openExternal(WEBSITE));
  ipcMain.handle('myweather:locate',event=>event.sender===win?.webContents?getWindowsLocation():{ok:false,error:'Forbidden'});
  if(process.platform==='win32'&&app.isPackaged){
   const marker=path.join(app.getPath('userData'),'startup-initialized');
   if(!fs.existsSync(marker)){
    app.setLoginItemSettings({openAtLogin:true});
    try{fs.writeFileSync(marker,'enabled')}catch(error){console.warn(error)}
   }
  }
  openWindow();
  // Only this locally packaged trusted widget may request geolocation.
  session.defaultSession.setPermissionRequestHandler((wc,permission,cb)=>cb(permission==='geolocation'&&wc===win?.webContents));
  session.defaultSession.setPermissionCheckHandler((wc,permission)=>permission==='geolocation'&&wc===win?.webContents);
  createTray();
 });
 app.on('window-all-closed',()=>app.quit());
}
