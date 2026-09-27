import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 5 externalizes deps for main/preload by default (externalizeDepsPlugin is deprecated),
// but the main and preload keys must still exist or it skips building them.
// The unfused e2e build is `electron-vite build --mode e2e` (shell-independent; SAAKSHI_E2E=1 still works).
export default defineConfig(({ mode }) => ({
  main: { define: { __SAAKSHI_E2E__: JSON.stringify(mode === 'e2e' || process.env.SAAKSHI_E2E === '1') } },
  preload: {},
  renderer: { plugins: [react()] },
}));
