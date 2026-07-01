import { createServer as createViteServer } from 'vite'
import { createApiHandler, createServer } from './file-service.mjs'

const vite = await createViteServer({
  appType: 'spa',
  server: {
    middlewareMode: true,
  },
})

const apiHandler = createApiHandler()
const server = createServer(apiHandler, (req, res) => vite.middlewares(req, res))
const port = Number(process.env.PORT || 5177)

server.listen(port, '127.0.0.1', () => {
  console.log(`OoaM Canon Workbench running at http://127.0.0.1:${port}`)
})
