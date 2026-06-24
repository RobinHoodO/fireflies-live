import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

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
  plugins: [react(), tailwindcss(), firefliesKeyPlugin()],
})
