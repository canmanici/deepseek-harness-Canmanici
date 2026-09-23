import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'third_party', 'open-design')
/** Unified diffs against the pinned submodule, applied in name order to the build copy only. */
const PATCHES = join(ROOT, 'scripts', 'open-design-patches')
const OPEN_DESIGN_REVISION = '0d3a14c1df6dc5017f3cc3ef05b24558250c220b'
const OPEN_DESIGN_VERSION = '0.24.0'
const NAMESPACE = 'dsh-open-design'
const EXCLUDED_SOURCE_SEGMENTS = new Set([
  '.git', '.next', '.tmp', '.turbo', 'coverage', 'node_modules', 'out',
])

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function identity() {
  return {
    commit: OPEN_DESIGN_REVISION,
    tag: `open-design-runtime-${OPEN_DESIGN_REVISION}`,
    version: OPEN_DESIGN_VERSION,
  }
}

async function copySource(destination) {
  const status = execFileSync('git', ['-C', SOURCE, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  const revision = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (revision !== OPEN_DESIGN_REVISION) {
    throw new Error(`OpenDesign submodule is at ${revision}; expected pinned commit ${OPEN_DESIGN_REVISION}`)
  }
  if (status !== '') {
    throw new Error('OpenDesign submodule has local changes; commit or preserve them elsewhere before building its DSH runtime')
  }
  await cp(SOURCE, destination, {
    recursive: true,
    filter(sourcePath) {
      const path = relative(SOURCE, sourcePath)
      return path === '' || !path.split(sep).some(segment => EXCLUDED_SOURCE_SEGMENTS.has(segment))
    },
  })
}

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one upstream source setting in ${path}`)
  }
  await writeFile(path, `${source.slice(0, first)}${after}${source.slice(first + before.length)}`)
}

async function hashFile(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function applyDshRuntimePatches(sourceRoot) {
  const patches = (await readdir(PATCHES)).filter(name => name.endsWith('.patch')).sort()
  for (const patch of patches) {
    run('git', ['apply', '--whitespace=nowarn', join(PATCHES, patch)], { cwd: sourceRoot })
  }
  const path = join(sourceRoot, 'apps', 'packaged', 'src', 'sidecars.ts')
  await replaceOnce(
    path,
    '[SIDECAR_ENV.DAEMON_PORT]: "0",',
    '[SIDECAR_ENV.DAEMON_PORT]: process.env[SIDECAR_ENV.DAEMON_PORT] ?? "0",',
  )
  await replaceOnce(
    path,
    '[SIDECAR_ENV.WEB_PORT]: "0",',
    '[SIDECAR_ENV.WEB_PORT]: process.env[SIDECAR_ENV.WEB_PORT] ?? "0",',
  )
  await replaceOnce(
    join(sourceRoot, 'apps', 'web', 'next.config.ts'),
    "NEXT_PUBLIC_CMS_HOST_RELEASE: existsSync(resolve(WEB_ROOT, 'src/components/touchpoint-component.ts'))",
    "NEXT_PUBLIC_CMS_HOST_RELEASE: existsSync(resolve(WORKSPACE_ROOT, 'apps/web/app/layout.tsx')) && existsSync(resolve(WEB_ROOT, 'src/components/touchpoint-component.ts'))",
  )
}

async function build() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The initial OpenDesign runtime target is Linux x64; build it on a Linux x64 host')
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('OpenDesign runtime builds require Node.js 24 or later')
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-open-design-build-'))
  const sourceRoot = join(temporaryRoot, 'source')
  const stageRoot = join(temporaryRoot, 'runtime')
  const outputRoot = join(ROOT, 'dist', 'optional-runtimes', 'open-design')
  const artifactName = `${OPEN_DESIGN_REVISION}-linux-x64`
  const archiveName = `open-design-${OPEN_DESIGN_REVISION}-linux-x64.tar.gz`
  try {
    await copySource(sourceRoot)
    const packagedMetadata = JSON.parse(await readFile(join(sourceRoot, 'apps', 'packaged', 'package.json'), 'utf8'))
    if (packagedMetadata.version !== OPEN_DESIGN_VERSION) {
      throw new Error(`Pinned OpenDesign packaged version is ${String(packagedMetadata.version)}; expected ${OPEN_DESIGN_VERSION}`)
    }
    await applyDshRuntimePatches(sourceRoot)
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: sourceRoot })
    run('pnpm', ['run', 'tools-pack', 'linux', 'build', '--to', 'dir', '--namespace', NAMESPACE], {
      cwd: sourceRoot,
    })

    const namespaceRoot = join(sourceRoot, '.tmp', 'tools-pack', 'out', 'linux', 'namespaces', NAMESPACE)
    const appRoot = join(namespaceRoot, 'assembled', 'app')
    const resourceRoot = join(namespaceRoot, 'resources', 'open-design')
    const headlessEntry = join(appRoot, 'node_modules', '@open-design', 'packaged', 'dist', 'headless.mjs')
    const nodeRuntime = join(resourceRoot, 'bin', 'node')
    await Promise.all([stat(headlessEntry), stat(nodeRuntime)])

    await mkdir(join(stageRoot, 'assembled'), { recursive: true })
    await mkdir(join(stageRoot, 'resources'), { recursive: true })
    await mkdir(join(stageRoot, 'licenses', 'open-design'), { recursive: true })
    await cp(appRoot, join(stageRoot, 'assembled', 'app'), { recursive: true })
    await cp(resourceRoot, join(stageRoot, 'resources', 'open-design'), { recursive: true })
    await cp(join(sourceRoot, 'LICENSE'), join(stageRoot, 'licenses', 'open-design', 'LICENSE'))
    await writeFile(join(stageRoot, 'open-design-runtime.json'), `${JSON.stringify({
      ...identity(),
      platform: 'linux-x64',
      schemaVersion: 1,
    }, null, 2)}\n`)

    await mkdir(outputRoot, { recursive: true })
    const artifactPath = join(outputRoot, artifactName)
    try {
      await access(artifactPath)
      throw new Error(`Runtime artifact already exists and will not be overwritten: ${artifactPath}`)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    const outputStage = await mkdtemp(join(outputRoot, '.open-design-output-'))
    const stagedArchive = join(outputStage, archiveName)
    try {
      run('tar', ['-czf', stagedArchive, '-C', stageRoot, 'assembled', 'resources', 'licenses', 'open-design-runtime.json'])
      const digest = await hashFile(stagedArchive)
      await writeFile(`${stagedArchive}.sha256`, `${digest}  ${basename(stagedArchive)}\n`)
      await rename(outputStage, artifactPath)
    } finally {
      await rm(outputStage, { recursive: true, force: true })
    }
    const archivePath = join(artifactPath, archiveName)
    process.stdout.write(`${archivePath}\n`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const [command] = process.argv.slice(2)
if (command === 'identity') {
  process.stdout.write(`${JSON.stringify(identity())}\n`)
} else if (command === 'build') {
  await build()
} else {
  throw new Error('usage: node scripts/open-design-runtime.mjs <build|identity>')
}
