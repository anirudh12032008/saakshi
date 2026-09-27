import { contextBridge, ipcRenderer } from 'electron';
import type { Action, SeatApi, SyncView } from '../shared/ipc.ts';

const api: SeatApi = {
  load: () => ipcRenderer.invoke('exam:load'),
  start: () => ipcRenderer.invoke('exam:start'),
  act: (a: Action) => ipcRenderer.invoke('exam:act', a),
  submit: () => ipcRenderer.invoke('exam:submit'),
  onSync: (cb) => {
    const h = (_e: unknown, v: SyncView) => cb(v);
    ipcRenderer.on('sync', h);
    return () => { ipcRenderer.removeListener('sync', h); };
  },
};
contextBridge.exposeInMainWorld('saakshi', api);
