const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('myWeatherDesktop',Object.freeze({openWebsite:()=>ipcRenderer.invoke('myweather:openWebsite')}));
