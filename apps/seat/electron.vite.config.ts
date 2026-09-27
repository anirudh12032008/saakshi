import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 5 externalizes deps for main/preload by default (externalizeDepsPlugin is deprecated),
// but the main and preload keys must still exist or it skips building them.
export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [react()] },
});
