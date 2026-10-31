import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The shared @rajesh-hub packages are linked from ../rajesh-hub, so they sit outside this
// folder: allow the dev server to read them and make sure only one copy of React is used.
// Relative base so the same build works inside the native apps and on GitHub Pages under /BoxBook/.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ['react', 'react-dom', 'sonner'] },
  server: { fs: { allow: ['..'] } },
})
