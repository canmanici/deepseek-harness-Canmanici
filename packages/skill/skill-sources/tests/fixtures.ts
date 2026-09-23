import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'

/** Build `SKILL.md` text. */
export function skillText(name: string, description = `${name} skill`, body = `${name} body.`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

/** Build a ZIP from path → text entries. */
export function zipOf(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))
}

/** Mutable routes served by one loopback server. */
export interface FixtureServer {
  readonly url: string
  readonly routes: Map<string, { status?: number; body: string | Uint8Array; redirect?: string; delayMs?: number }>
  readonly requests: Array<{ path: string; headers: IncomingHttpHeaders }>
  close(): Promise<void>
}

/** Start a loopback HTTP server owned by the calling spec. */
export async function startServer(): Promise<FixtureServer> {
  const routes: FixtureServer['routes'] = new Map()
  const requests: FixtureServer['requests'] = []
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/'
    requests.push({ path, headers: request.headers })
    const route = routes.get(path)
    if (route === undefined) {
      response.writeHead(404).end('missing')
      return
    }
    if (route.redirect !== undefined) {
      response.writeHead(302, { location: route.redirect }).end()
      return
    }
    const body = Buffer.from(route.body)
    if (route.delayMs !== undefined) {
      setTimeout(() => { response.writeHead(route.status ?? 200).end(body) }, route.delayMs)
      return
    }
    const status = route.status ?? 200
    response.writeHead(status, status === 204 ? {} : { 'content-length': body.byteLength }).end(status === 204 ? undefined : body)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    routes,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    }),
  }
}

/** Serve one GitHub repository commit and its zipball through the API emulation. */
export function serveRepo(server: FixtureServer, repo: string, commit: string, files: Record<string, string>, ref = 'HEAD'): void {
  server.routes.set(`/repos/${repo}/commits/${ref}`, { body: commit })
  server.routes.set(`/repos/${repo}/zipball/${commit}`, { body: '', redirect: `${server.url}/codeload/${repo}/${commit}.zip` })
  const top = `${repo.replace('/', '-')}-${commit.slice(0, 7)}`
  server.routes.set(`/codeload/${repo}/${commit}.zip`, {
    body: zipOf(Object.fromEntries(Object.entries(files).map(([path, text]) => [`${top}/${path}`, text]))),
  })
}

/** Create a temporary directory removed by the returned cleanup. */
export async function tempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-skill-sources-'))
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) }
}
