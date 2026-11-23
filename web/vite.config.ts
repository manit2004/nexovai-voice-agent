import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The voice server (FastAPI + Pipecat) runs on :7860. Proxying /api keeps the
// browser on one origin, so WebRTC signalling and REST calls need no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:7860' },
  },
})
