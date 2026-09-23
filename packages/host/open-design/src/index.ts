/**
 * DSH-owned optional OpenDesign runtime: checksum-verified installation in
 * DSH home, loopback-only headless startup, authenticated UI controls, and
 * profile-lifetime sidecar teardown.
 * @module @deepseek-ai/dsh-host-open-design
 */

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { access, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import { x as extractTar } from 'tar'
import {
  OPEN_DESIGN_START_PATH,
  OPEN_DESIGN_STATUS_PATH,
  type OpenDesignRuntimePhase,
  type OpenDesignRuntimeStatus,
} from './shared.ts'

export type * from './shared.ts'

/** Versioned release identity shared with the DSH runtime build workflow. */
const OPEN_DESIGN_RUNTIME_COMMIT = '0d3a14c1df6dc5017f3cc3ef05b24558250c220b'

/** OpenDesign packaged-runtime version built from the pinned source revision. */
const OPEN_DESIGN_RUNTIME_VERSION = '0.24.0'

/** OpenDesign runtime download, storage, and local service settings. */
export interface Config {
  /** HTTPS download base for immutable DSH GitHub release assets. */
  readonly runtimeDownloadBaseUrl: string
  /** Loopback daemon port shared with the MCP client entry. */
  readonly daemonPort: number
  /** Loopback Studio port shared with the embedded panel. */
  readonly webPort: number
  /** Maximum compressed runtime archive size in bytes. */
  readonly maxRuntimeBytes: number
  /** Maximum archive download duration in milliseconds. */
  readonly downloadTimeoutMs: number
  /** Maximum wait for daemon and Studio readiness in milliseconds. */
  readonly startupTimeoutMs: number
  /** Maximum wait for another profile's runtime installation lock. */
  readonly installLockWaitMs: number
}

const DEFAULT_DOWNLOAD_BASE = 'https://github.com/deepseek-ai/deepseek-harness/releases/download'
const DEFAULT_DAEMON_PORT = 17456
const DEFAULT_WEB_PORT = 17457
const DEFAULT_MAX_RUNTIME_BYTES = 1_500_000_000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 1_800_000
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000
const DEFAULT_INSTALL_LOCK_WAIT_MS = 1_800_000
const READY_POLL_INTERVAL_MS = 300
const PROCESS_STOP_TIMEOUT_MS = 30_000
const ASSET_NAME = `open-design-${OPEN_DESIGN_RUNTIME_COMMIT}-linux-x64.tar.gz`
const STOP_SIDECARS_SCRIPT = `
import { stopSidecars } from '@open-design/sidecar'
import { APP_KEYS, SIDECAR_SOURCES } from '@open-design/sidecar-proto'

const sources = [SIDECAR_SOURCES.PACKAGED, SIDECAR_SOURCES.TOOLS_PACK]
const apps = [APP_KEYS.DESKTOP, APP_KEYS.WEB, APP_KEYS.DAEMON]
const requests = sources.flatMap(source => apps.map(app => ({
  stamp: { app, channel: 'stable', mode: 'headless', namespace: 'dsh-open-design', source },
})))
const result = await stopSidecars(requests)
if (result.remainingPids.length > 0) {
  throw new Error('OpenDesign sidecars remain after shutdown: ' + result.remainingPids.join(', '))
}
`

/** Cordis function-plugin name. */
export const name = 'host-open-design'
/** Host HTTP routes, trust fence, and process owner required by this provider. */
export const inject = ['webServer', 'connection', 'subprocess']

const boundedInteger = (minimum: number, maximum: number, fallback: number): z<number> =>
  z.number().step(1).min(minimum).max(maximum).default(fallback)

/** Validated configuration for the optional OpenDesign runtime. */
export const Config: z<Config> = z.object({
  runtimeDownloadBaseUrl: z.string().pattern(/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/u).default(DEFAULT_DOWNLOAD_BASE),
  daemonPort: boundedInteger(1, 65535, DEFAULT_DAEMON_PORT),
  webPort: boundedInteger(1, 65535, DEFAULT_WEB_PORT),
  maxRuntimeBytes: boundedInteger(1, 4_000_000_000, DEFAULT_MAX_RUNTIME_BYTES),
  downloadTimeoutMs: boundedInteger(1, 3_600_000, DEFAULT_DOWNLOAD_TIMEOUT_MS),
  startupTimeoutMs: boundedInteger(1, 600_000, DEFAULT_STARTUP_TIMEOUT_MS),
  installLockWaitMs: boundedInteger(1, 3_600_000, DEFAULT_INSTALL_LOCK_WAIT_MS),
})

/** Trust interface provided by the Web Connection host plugin. */
interface OpenDesignConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Read the Web Connection service without importing its browser face. */
function connectionOf(ctx: Context): OpenDesignConnection {
  return Reflect.get(ctx, 'connection') as OpenDesignConnection
}

/** Write a live status response without caching it in the browser. */
function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/** Preserve an install or launch diagnostic for the management page. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Match one Node filesystem error code without assuming every thrown value is an Error. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** Check whether one loopback TCP port is available for the packaged sidecar. */
async function assertPortAvailable(port: number): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeAllListeners('error'); resolve() })
  })
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}

/** Resolve one required runtime file without accepting a directory or dangling link. */
async function requireFile(path: string, executable = false): Promise<void> {
  const details = await stat(path)
  if (!details.isFile() || (executable && (details.mode & 0o111) === 0)) {
    throw new Error(`OpenDesign runtime file is missing or unusable: ${path}`)
  }
  await access(path)
}

/** Read the archive manifest and reject a different source generation or platform. */
async function assertRuntimeManifest(root: string): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(join(root, 'open-design-runtime.json'), 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('OpenDesign runtime manifest is invalid')
  const manifest = raw as Record<string, unknown>
  if (manifest.commit !== OPEN_DESIGN_RUNTIME_COMMIT
    || manifest.tag !== `open-design-runtime-${OPEN_DESIGN_RUNTIME_COMMIT}`
    || manifest.version !== OPEN_DESIGN_RUNTIME_VERSION
    || manifest.platform !== 'linux-x64'
    || manifest.schemaVersion !== 1) {
    throw new Error('OpenDesign runtime manifest does not match this DSH integration')
  }
  await requireFile(join(root, 'licenses', 'open-design', 'LICENSE'))
  await requireFile(join(root, 'assembled', 'app', 'node_modules', '@open-design', 'packaged', 'dist', 'headless.mjs'))
  await requireFile(join(root, 'resources', 'open-design', 'bin', 'node'), true)
  await requireFile(join(root, 'assembled', 'app', 'node_modules', '@open-design', 'daemon', 'bin', 'od.mjs'))
}

/** Track one DSH-owned installation and its OpenDesign sidecar generation. */
class OpenDesignRuntime {
  private phase: OpenDesignRuntimePhase = 'idle'
  private bytesDownloaded = 0
  private totalBytes: number | null = null
  private error: string | null = null
  private operation: Promise<void> | undefined
  private child: SubprocessHandle | undefined
  private cleanup: Promise<void> | undefined
  private sidecarsStarted = false
  private readonly abort = new AbortController()
  private disposed = false
  private readonly runtimeRoot = dshHomePath('open-design', 'runtime', OPEN_DESIGN_RUNTIME_COMMIT)
  private readonly runtimeParent = dshHomePath('open-design', 'runtime')
  private readonly dataRoot = dshHomePath('open-design', 'data')
  private readonly appRoot = join(this.runtimeRoot, 'assembled', 'app')
  private readonly resourceRoot = join(this.runtimeRoot, 'resources', 'open-design')
  private readonly studioUrl: string
  private readonly daemonUrl: string

  constructor(private readonly ctx: Context, private readonly config: Config) {
    this.studioUrl = `http://127.0.0.1:${String(config.webPort)}/`
    this.daemonUrl = `http://127.0.0.1:${String(config.daemonPort)}`
    if (config.daemonPort === config.webPort) throw new Error('OpenDesign daemonPort and webPort must differ')
  }

  /** Return a copy of the latest status for the browser. */
  status(): OpenDesignRuntimeStatus {
    return {
      phase: this.phase,
      bytesDownloaded: this.bytesDownloaded,
      totalBytes: this.totalBytes,
      studioUrl: this.phase === 'ready' ? this.studioUrl : null,
      error: this.error,
    }
  }

  /** Start once; concurrent requests share installation and readiness work. */
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('OpenDesign runtime owner has stopped'))
    if (this.phase === 'ready') return Promise.resolve()
    if (this.operation !== undefined) return this.operation
    this.error = null
    this.bytesDownloaded = 0
    this.totalBytes = null
    this.phase = 'starting'
    this.operation = this.cleanupOwnedRuntime().then(() => this.installAndStart()).catch(async (error) => {
      try {
        await this.cleanupOwnedRuntime()
      } catch (cleanupError) {
        this.ctx.logger.error(`OpenDesign cleanup after startup failure failed: ${errorMessage(cleanupError)}`)
      }
      this.phase = 'failed'
      this.error = errorMessage(error)
      throw error
    }).finally(() => { this.operation = undefined })
    return this.operation
  }

  /** Stop the runtime before its owning DSH profile unloads. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.abort.abort(new Error('OpenDesign runtime owner unloaded'))
    await this.operation?.catch(() => undefined)
    await this.cleanupOwnedRuntime()
  }

  private async installAndStart(): Promise<void> {
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      throw new Error('The installed OpenDesign headless runtime currently supports Linux x64 only')
    }
    await mkdir(this.runtimeParent, { recursive: true, mode: 0o700 })
    await withFileLock(join(this.runtimeParent, 'runtime-install'), async () => {
      if (await this.runtimeInstalled()) return
      await this.downloadAndInstall()
    }, { waitMs: this.config.installLockWaitMs, signal: this.abort.signal })
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 })
    await assertPortAvailable(this.config.daemonPort)
    await assertPortAvailable(this.config.webPort)
    this.phase = 'starting'
    this.child = this.ctx.subprocess.spawn({
      argv: [join(this.resourceRoot, 'bin', 'node'), join(this.appRoot, 'node_modules', '@open-design', 'packaged', 'dist', 'headless.mjs')],
      cwd: this.appRoot,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 16_384 }, stderr: { maxBytes: 16_384 } },
      graceMs: PROCESS_STOP_TIMEOUT_MS,
      signal: this.abort.signal,
      env: this.runtimeEnvironment(),
    })
    this.sidecarsStarted = true
    const child = this.child
    void child.done.then((outcome) => {
      if (outcome.exitCode === 0 && outcome.signal === null) return
      if (this.disposed || this.phase !== 'ready') return
      this.phase = 'failed'
      this.error = `OpenDesign headless process exited (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`
      void this.cleanupOwnedRuntime().catch((error) => {
        this.ctx.logger.error(`OpenDesign cleanup after launcher exit failed: ${errorMessage(error)}`)
      })
    }, (error) => {
      if (this.disposed || this.phase !== 'ready') return
      this.phase = 'failed'
      this.error = errorMessage(error)
      void this.cleanupOwnedRuntime().catch((cleanupError) => {
        this.ctx.logger.error(`OpenDesign cleanup after launcher failure failed: ${errorMessage(cleanupError)}`)
      })
    })
    await this.waitUntilReady(child)
    this.phase = 'ready'
    this.error = null
  }

  private async runtimeInstalled(): Promise<boolean> {
    try {
      await assertRuntimeManifest(this.runtimeRoot)
      return true
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return false
      throw error
    }
  }

  /** Keep DSH runtime paths and loopback settings identical for startup and shutdown. */
  private runtimeEnvironment(): NodeJS.ProcessEnv {
    return {
      OD_DATA_DIR: this.dataRoot,
      OD_BIND_HOST: '127.0.0.1',
      OD_HOST: '127.0.0.1',
      OD_PACKAGED_NAMESPACE: 'dsh-open-design',
      OD_RESOURCE_ROOT: this.resourceRoot,
      OD_PORT: String(this.config.daemonPort),
      OD_WEB_PORT: String(this.config.webPort),
    }
  }

  private async downloadAndInstall(): Promise<void> {
    const stagingParent = await mkdtemp(join(this.runtimeParent, '.open-design-stage-'))
    const stagingRoot = join(stagingParent, 'runtime')
    const archivePath = join(stagingParent, ASSET_NAME)
    try {
      this.phase = 'downloading'
      const archiveDigest = await this.downloadAsset(archivePath, false)
      this.phase = 'verifying'
      const checksum = await this.downloadAsset(`${archivePath}.sha256`, true)
      const expected = checksum.trim().split(/\s+/u)[0]
      if (expected !== archiveDigest) throw new Error('OpenDesign runtime checksum does not match its release manifest')
      this.phase = 'extracting'
      await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
      await extractTar({ file: archivePath, cwd: stagingRoot, strict: true, preservePaths: false })
      await assertRuntimeManifest(stagingRoot)
      try {
        await access(this.runtimeRoot)
        throw new Error('An incomplete OpenDesign runtime already exists; move it aside before retrying')
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      }
      await rename(stagingRoot, this.runtimeRoot)
    } finally {
      await rm(stagingParent, { recursive: true, force: true })
    }
  }

  private async downloadAsset(path: string, checksum: boolean): Promise<string> {
    const tag = `open-design-runtime-${OPEN_DESIGN_RUNTIME_COMMIT}`
    const assetName = checksum ? `${ASSET_NAME}.sha256` : ASSET_NAME
    const url = `${this.config.runtimeDownloadBaseUrl.replace(/\/+$/u, '')}/${tag}/${assetName}`
    const response = await fetch(url, {
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.config.downloadTimeoutMs)]),
    })
    if (!response.ok || new URL(response.url).protocol !== 'https:') {
      throw new Error(`OpenDesign runtime download failed (${response.status})`)
    }
    if (checksum) {
      const text = await response.text()
      const fields = text.trim().split(/\s+/u)
      if (!/^[a-f0-9]{64}$/u.test(fields[0] ?? '') || fields[1] !== ASSET_NAME) {
        throw new Error('OpenDesign runtime checksum file is malformed')
      }
      return text
    }
    if (response.body === null) throw new Error('OpenDesign runtime release returned no archive body')
    const contentLength = Number(response.headers.get('content-length'))
    this.totalBytes = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : null
    if (this.totalBytes !== null && this.totalBytes > this.config.maxRuntimeBytes) {
      throw new Error('OpenDesign runtime archive exceeds the configured size limit')
    }
    const file = await open(path, 'wx', 0o600)
    const digest = createHash('sha256')
    try {
      for await (const chunk of response.body) {
        if (this.abort.signal.aborted) throw this.abort.signal.reason
        const bytes = Buffer.from(chunk)
        this.bytesDownloaded += bytes.byteLength
        if (this.bytesDownloaded > this.config.maxRuntimeBytes) throw new Error('OpenDesign runtime archive exceeds the configured size limit')
        digest.update(bytes)
        await file.write(bytes)
      }
      await file.sync()
    } finally {
      await file.close()
    }
    return digest.digest('hex')
  }

  private async waitUntilReady(child: SubprocessHandle): Promise<void> {
    const deadline = Date.now() + this.config.startupTimeoutMs
    let launchError: string | undefined
    void child.done.then((outcome) => {
      if (outcome.exitCode !== 0 || outcome.signal !== null) {
        launchError = `OpenDesign headless launcher exited before readiness (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`
      }
    }, (error) => { launchError = `OpenDesign headless launcher failed before readiness: ${errorMessage(error)}` })
    while (Date.now() < deadline) {
      if (this.abort.signal.aborted) throw this.abort.signal.reason
      if (launchError !== undefined) throw new Error(launchError)
      const ready = await Promise.all([
        fetch(`${this.daemonUrl}/api/health`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false),
        fetch(this.studioUrl, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false),
      ])
      if (launchError !== undefined) throw new Error(launchError)
      if (ready.every(Boolean)) return
      await new Promise<void>(resolve => setTimeout(resolve, READY_POLL_INTERVAL_MS))
    }
    throw new Error(`OpenDesign did not start within ${String(this.config.startupTimeoutMs)}ms`)
  }

  /** Stop only the sidecar generations stamped for this DSH OpenDesign namespace. */
  private async stopSidecars(): Promise<void> {
    if (!this.sidecarsStarted) return
    const child = this.ctx.subprocess.spawn({
      argv: [
        join(this.resourceRoot, 'bin', 'node'),
        '--input-type=module',
        '-e',
        STOP_SIDECARS_SCRIPT,
      ],
      cwd: this.appRoot,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: PROCESS_STOP_TIMEOUT_MS,
      env: this.runtimeEnvironment(),
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const settlement = await Promise.race([
      child.done.then(
        outcome => ({ kind: 'outcome' as const, outcome }),
        error => ({ kind: 'error' as const, error }),
      ),
      new Promise<{ readonly kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), PROCESS_STOP_TIMEOUT_MS)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (settlement.kind !== 'outcome') {
      const failure = settlement.kind === 'timeout'
        ? new Error('OpenDesign sidecar shutdown command exceeded its deadline')
        : new Error(`OpenDesign sidecar shutdown command failed: ${errorMessage(settlement.error)}`)
      try {
        await this.awaitProcessRangeExit(child, 'OpenDesign sidecar shutdown command')
      } catch (cleanupError) {
        throw new AggregateError([failure, cleanupError], 'OpenDesign sidecar shutdown did not settle')
      }
      throw failure
    }
    await this.awaitProcessRangeExit(child, 'OpenDesign sidecar shutdown command')
    if (settlement.outcome.exitCode !== 0 || settlement.outcome.signal !== null) {
      const detail = child.collected.stderr?.readFrom(0).text.trim()
      throw new Error(detail || `OpenDesign sidecar shutdown command exited (code ${String(settlement.outcome.exitCode)}, signal ${String(settlement.outcome.signal)})`)
    }
    this.sidecarsStarted = false
  }

  /** Await both OpenDesign's sidecar shutdown and the DSH-owned launcher. */
  private async stopOwnedRuntime(): Promise<void> {
    const errors: unknown[] = []
    try {
      await this.stopSidecars()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.stopChild()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'OpenDesign runtime shutdown failed')
  }

  /** Share cleanup across startup failure, a launcher crash, and profile unload. */
  private cleanupOwnedRuntime(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup
    const operation = this.stopOwnedRuntime()
    const cleanup = operation.finally(() => {
      if (this.cleanup === cleanup) this.cleanup = undefined
    })
    this.cleanup = cleanup
    return cleanup
  }

  /** Recheck a process range after termination when its first observation fails. */
  private async awaitProcessRangeExit(child: SubprocessHandle, subject: string): Promise<void> {
    let exited: boolean
    try {
      exited = await child.waitForExit(AbortSignal.timeout(PROCESS_STOP_TIMEOUT_MS))
    } catch (error) {
      child.terminate()
      try {
        const settled = await child.waitForExit(AbortSignal.timeout(PROCESS_STOP_TIMEOUT_MS))
        if (!settled) throw new Error(`${subject} did not become quiescent after termination`)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${subject} could not be observed after termination`)
      }
      return
    }
    if (exited) return
    child.terminate()
    const settled = await child.waitForExit(AbortSignal.timeout(PROCESS_STOP_TIMEOUT_MS))
    if (!settled) throw new Error(`${subject} did not become quiescent after termination`)
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    child.terminate()
    await this.awaitProcessRangeExit(child, 'OpenDesign process tree')
    await child.done.catch(() => undefined)
    if (this.child === child) this.child = undefined
    if (this.phase !== 'failed') this.phase = 'idle'
  }
}

/** Add the local runtime status and start routes behind the Web trust fence.
 * @param ctx - composition context carrying the route, trust, and process services.
 * @param config - validated runtime download, port, and deadline settings.
 * @returns nothing; the process and routes are owned by a Cordis effect.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = new OpenDesignRuntime(ctx, config)
  const connection = connectionOf(ctx)
  ctx.effect(() => {
    const status = ctx.webServer.register({
      kind: 'exact',
      path: OPEN_DESIGN_STATUS_PATH,
      handler(req, res) {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) return sendJson(res, rejection, { error: 'request rejected' })
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET')
          return sendJson(res, 405, { error: 'method not allowed' })
        }
        sendJson(res, 200, runtime.status())
      },
    })
    const start = ctx.webServer.register({
      kind: 'exact',
      path: OPEN_DESIGN_START_PATH,
      handler(req, res) {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) return sendJson(res, rejection, { error: 'request rejected' })
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          return sendJson(res, 405, { error: 'method not allowed' })
        }
        void runtime.start().catch((error) => { ctx.logger.error(`OpenDesign runtime failed: ${errorMessage(error)}`) })
        sendJson(res, 202, runtime.status())
      },
    })
    void runtime.start().catch((error) => { ctx.logger.error(`OpenDesign runtime failed: ${errorMessage(error)}`) })
    return async () => {
      status()
      start()
      await runtime.dispose()
    }
  }, 'open-design: runtime routes and process')
}
