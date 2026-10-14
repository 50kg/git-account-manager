'use strict';
// 只暴露两个能力给界面：调用主进程、取拖进来的文件的真实路径
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gz', {
  call: (name, args) => ipcRenderer.invoke('call', name, args),
  pathOf: file => webUtils.getPathForFile(file),
});
