import { defineConfig } from 'vite';

// No React plugin on purpose: React 16.4.2 has no `react/jsx-runtime`, so we
// rely on esbuild's classic JSX transform (React.createElement). Every file
// that contains JSX therefore does `import React from 'react'`.
//
// The two esbuild settings below let us keep JSX in plain `.js` files
// (src/App.js etc.), CRA-style.
export default defineConfig({
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  server: {
    // Web Bluetooth needs a secure context: http://localhost counts as secure.
    host: 'localhost',
    port: 5173,
  },
});
