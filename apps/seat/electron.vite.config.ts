import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 5 externalizes deps for main/preload by default (externalizeDepsPlugin is deprecated),
// but the main and preload keys must still exist or it skips building them.
const e2e = JSON.stringify(process.env.SAAKSHI_E2E === '1');
export default defineConfig({
  main: { define: { __SAAKSHI_E2E__: e2e } },
  preload: {},
  renderer: { plugins: [react()] },
});
