'use strict';
const {app,BrowserWindow,Menu,Tray,ipcMain,net,protocol,screen,shell,nativeImage}=require('electron');
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
 const fallback={width:344,height:265,x:area.x+area.width-374,y:area.y+26};
 try{
  const b=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'bounds.json'),'utf8'));
  if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<290||b.height<230||b.width>640||b.height>560)return fallback;
  const visible=screen.getAllDisplays().some(d=>b.x<d.bounds.x+d.bounds.width-60&&b.x+b.width>d.bounds.x+60&&b.y<d.bounds.y+d.bounds.height-60&&b.y+b.height>d.bounds.y+60);
  return visible?b:fallback;
 }catch{return fallback}
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
  {label:'Démarrer avec Windows',type:'checkbox',checked:app.getLoginItemSettings().openAtLogin,click:item=>app.setLoginItemSettings({openAtLogin:item.checked})},
  {label:'Quitter',click:()=>app.quit()}
 ]));
 tray.on('double-click',()=>win?.showInactive());
}
function openWindow(){
 win=new BrowserWindow({
  ...bounds(),minWidth:290,minHeight:230,maxWidth:640,maxHeight:560,
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
  if(process.platform==='win32'&&app.isPackaged)app.setLoginItemSettings({openAtLogin:true});
  openWindow();createTray();
 });
 app.on('window-all-closed',()=>app.quit());
}
