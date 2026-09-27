import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('saakshi', {
  safeStorageCheck: (): Promise<string> => ipcRenderer.invoke('safe-storage-check'),
});
