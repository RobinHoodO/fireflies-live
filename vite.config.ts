import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

// Boot the localhost-only command bridge alongside the dev server so it only
// exists while Fireflies Live is open. Killed when Vite exits.
function bridgePlugin() {
  return {
    name: 'fireflies-bridge',
    configureServer() {
      const child = spawn('node', ['server/bridge.mjs'], { stdio: 'inherit', env: process.env })
      const kill = () => { try { child.kill() } catch {} }
      process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit() }); process.on('SIGTERM', () => { kill(); process.exit() })
    },
  }
}

function firefliesKeyPlugin() {
  return {
    name: 'fireflies-key',
    configureServer(server: any) {
      server.middlewares.use('/api/fireflies-key', (_req: any, res: any) => {
        try {
          const envPath = path.resolve('/Users/robinsverd/Thrivbe-AI/.env')
          const env = fs.readFileSync(envPath, 'utf-8')
          const ffMatch = env.match(/FIREFLY_API_KEY=(.+)/)
          const orMatch = env.match(/OPENROUTER_API=(.+)/)
          const ffKey = ffMatch ? ffMatch[1].trim() : ''
          const orKey = orMatch ? orMatch[1].trim() : ''
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ffKey, orKey }))
        } catch {
          res.end(JSON.stringify({ key: '' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), firefliesKeyPlugin(), bridgePlugin()],
  server: {
    proxy: {
      '/bridge': { target: 'http://127.0.0.1:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/bridge/, '') },
    },
  },
})
