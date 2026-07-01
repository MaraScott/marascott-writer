import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler, createServer } from './file-service.mjs'

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(serverDir, '..')
const distRoot = path.join(appRoot, 'dist')
const apiHandler = createApiHandler()
const port = Number(process.env.PORT || 4177)

const server = createServer(apiHandler, async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  const target = path.resolve(distRoot, `.${requested}`)

  if (!target.startsWith(distRoot)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const data = await fs.readFile(target)
    res.writeHead(200, { 'Content-Type': contentType(target) })
    res.end(data)
  } catch {
    const index = await fs.readFile(path.join(distRoot, 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(index)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`OoaM Canon Workbench preview running at http://127.0.0.1:${port}`)
})

function contentType(filePath) {
  const ext = path.extname(filePath)
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}
