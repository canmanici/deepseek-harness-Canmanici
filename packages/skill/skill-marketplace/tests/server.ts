import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A loopback server answering fixed paths, owned by the calling spec. */
export interface CatalogServer {
  readonly url: string
  /** Path with query → status and body. */
  readonly routes: Map<string, { status?: number; body: string }>
  /** Requested paths, in order. */
  readonly hits: string[]
  close(): Promise<void>
}

/** Start the server on an ephemeral port. */
export async function catalogServer(): Promise<CatalogServer> {
  const routes: CatalogServer['routes'] = new Map()
  const hits: string[] = []
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/'
    hits.push(path)
    const route = routes.get(path)
    if (route === undefined) response.writeHead(404).end('missing')
    else response.writeHead(route.status ?? 200).end(route.body)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    routes,
    hits,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }),
  }
}
