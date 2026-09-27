import { contextBridge, ipcRenderer } from 'electron';
import type { Action, EnrolInput, ExamBoot, SeatApi, SyncView } from '../shared/ipc.ts';

const on = <T>(channel: string, cb: (v: T) => void) => {
  const h = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => { ipcRenderer.removeListener(channel, h); };
};
const api: SeatApi = {
  load: () => ipcRenderer.invoke('exam:load'),
  enrol: (e: EnrolInput) => ipcRenderer.invoke('exam:enrol', e),
  paper: () => ipcRenderer.invoke('exam:paper'),
  start: () => ipcRenderer.invoke('exam:start'),
  act: (a: Action) => ipcRenderer.invoke('exam:act', a),
  submit: () => ipcRenderer.invoke('exam:submit'),
  handover: (pin: string) => ipcRenderer.invoke('exam:handover', pin),
  recheck: () => ipcRenderer.invoke('gate:recheck'),
  faceSample: (s) => ipcRenderer.send('face:sample', s),
  blur: (ms) => ipcRenderer.send('gate:blur', ms),
  onSync: (cb) => on<SyncView>('sync', cb),
  onBoot: (cb) => on<ExamBoot>('boot', cb),
};
contextBridge.exposeInMainWorld('saakshi', api);
