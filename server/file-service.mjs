import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(serverDir, '..')
const envPath = path.join(appRoot, '.env')
const envLoadResult = loadDotEnv(envPath)
const defaultCanonDir = resolveDefaultCanonDir()
const appDataRoot = path.join(
  process.env.OOAM_APP_DATA_DIR ||
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
  'OoaMCanonWorkbench',
)
const configPath = path.join(appDataRoot, 'config.json')
const cacheDir = path.join(appDataRoot, 'working-copy')
const manifestPath = path.join(appDataRoot, 'sync-manifest.json')

const supportedExtensions = new Set(['.md', '.json', '.txt'])

export function createApiHandler() {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (!url.pathname.startsWith('/api/')) {
        return false
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(res, await getConfigStatus(await readConfig()))
      }

      if (req.method === 'POST' && url.pathname === '/api/config') {
        const body = await readJson(req)
        const canonDir = assertString(body.canonDir, 'canonDir')
        await writeConfig({ canonDir })
        return sendJson(res, await getStatus())
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(res, await getStatus())
      }

      if (req.method === 'POST' && url.pathname === '/api/open/canon') {
        const config = await readConfig()
        await openFolder(config.canonDir)
        return sendJson(res, { opened: config.canonDir })
      }

      if (req.method === 'POST' && url.pathname === '/api/open/cache') {
        await fs.mkdir(cacheDir, { recursive: true })
        await openFolder(cacheDir)
        return sendJson(res, { opened: cacheDir })
      }

      if (req.method === 'POST' && url.pathname === '/api/sync/down') {
        return sendJson(res, await syncDown())
      }

      if (req.method === 'POST' && url.pathname === '/api/sync/up') {
        return sendJson(res, await syncUp())
      }

      if (req.method === 'POST' && url.pathname === '/api/context/export') {
        return sendJson(res, await exportContextPacks())
      }

      const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/)
      if (fileMatch && req.method === 'GET') {
        const name = decodeURIComponent(fileMatch[1])
        return sendJson(res, await readWorkingFile(name))
      }

      if (fileMatch && req.method === 'PUT') {
        const name = decodeURIComponent(fileMatch[1])
        const body = await readJson(req)
        const content = assertString(body.content, 'content')
        await writeWorkingFile(name, content)
        return sendJson(res, await readWorkingFile(name))
      }

      sendText(res, 404, 'Not found')
      return true
    } catch (error) {
      sendText(res, 400, error instanceof Error ? error.message : String(error))
      return true
    }
  }
}

export async function getStatus() {
  const config = await readConfig()
  await fs.mkdir(cacheDir, { recursive: true })
  const configStatus = await getConfigStatus(config)
  if (!configStatus.canonDirExists) {
    return {
      canonDir: config.canonDir,
      cacheDir,
      config: configStatus,
      files: [],
      events: [],
      generatedAt: new Date().toISOString(),
    }
  }

  const manifest = await readManifest()
  const localNames = await listSupportedFiles(cacheDir)
  const remoteNames = await listSupportedFiles(config.canonDir)
  const names = [...new Set([...remoteNames, ...localNames])].sort(compareFileNames)

  const files = []
  for (const name of names) {
    const localPath = path.join(cacheDir, name)
    const remotePath = path.join(config.canonDir, name)
    const [localInfo, remoteInfo] = await Promise.all([
      getFileInfo(localPath),
      getFileInfo(remotePath),
    ])
    const baseHash = manifest.files[name]?.baseHash ?? null
    const content = localInfo.exists ? await fs.readFile(localPath, 'utf8') : ''
    const outline = parseOutline(content, name)
    files.push({
      name,
      kind: getFileKind(name),
      title: outline.title,
      size: localInfo.size ?? remoteInfo.size ?? 0,
      localHash: localInfo.hash,
      remoteHash: remoteInfo.hash,
      baseHash,
      modifiedAt: localInfo.modifiedAt ?? remoteInfo.modifiedAt,
      syncState: getSyncState(localInfo.hash, remoteInfo.hash, baseHash),
      headingCount: outline.headingCount,
      eventCount: outline.events.length,
    })
  }

  const events = []
  for (const file of files) {
    if (!file.localHash || file.kind !== 'source') continue
    const content = await fs.readFile(path.join(cacheDir, file.name), 'utf8')
    events.push(...parseOutline(content, file.name).events)
  }

  return {
    canonDir: config.canonDir,
    cacheDir,
    config: configStatus,
    files,
    events,
    generatedAt: new Date().toISOString(),
  }
}

export async function syncDown() {
  const config = await readConfig()
  await ensureDirectories()
  const manifest = await readManifest()
  const remoteNames = await listSupportedFiles(config.canonDir)
  const localNames = await listSupportedFiles(cacheDir)
  const downloaded = []
  const skipped = []
  const conflicts = []
  const messages = []

  for (const name of remoteNames) {
    const remotePath = path.join(config.canonDir, name)
    const localPath = path.join(cacheDir, name)
    const [remoteHash, localHash] = await Promise.all([hashFile(remotePath), hashFile(localPath)])
    const baseHash = manifest.files[name]?.baseHash ?? null

    if (!localHash) {
      await copyFileAtomic(remotePath, localPath)
      manifest.files[name] = { baseHash: remoteHash, lastSyncedAt: new Date().toISOString() }
      downloaded.push(name)
      continue
    }

    if (localHash === remoteHash) {
      manifest.files[name] = { baseHash: remoteHash, lastSyncedAt: new Date().toISOString() }
      continue
    }

    if (!baseHash || localHash === baseHash) {
      await copyFileAtomic(remotePath, localPath)
      manifest.files[name] = { baseHash: remoteHash, lastSyncedAt: new Date().toISOString() }
      downloaded.push(name)
      continue
    }

    if (remoteHash === baseHash) {
      skipped.push(name)
      continue
    }

    const conflictName = conflictFileName(name, 'remote')
    await copyFileAtomic(remotePath, path.join(cacheDir, conflictName))
    conflicts.push(name)
    messages.push(`${name} changed locally and in the canon folder. Remote copy saved as ${conflictName}.`)
  }

  for (const name of localNames) {
    if (remoteNames.includes(name)) continue
    const localPath = path.join(cacheDir, name)
    const localHash = await hashFile(localPath)
    const baseHash = manifest.files[name]?.baseHash ?? null
    if (localHash && localHash === baseHash) {
      await fs.unlink(localPath)
      delete manifest.files[name]
      messages.push(`${name} was removed from the working copy because it no longer exists in canon.`)
    }
  }

  await writeManifest(manifest)
  return result('sync-down', { downloaded, skipped, conflicts, messages })
}

export async function syncUp() {
  await exportContextFiles()
  const config = await readConfig()
  await ensureDirectories()
  const manifest = await readManifest()
  const localNames = await listSupportedFiles(cacheDir)
  const uploaded = []
  const skipped = []
  const conflicts = []
  const messages = []
  const generated = ['ooam.context.full.md', 'ooam.context.digest.md'].filter((name) =>
    localNames.includes(name),
  )

  for (const name of localNames) {
    if (name.includes('.remote-conflict.') || name.includes('.local-conflict.')) {
      skipped.push(name)
      continue
    }

    const localPath = path.join(cacheDir, name)
    const remotePath = path.join(config.canonDir, name)
    const [localHash, remoteHash] = await Promise.all([hashFile(localPath), hashFile(remotePath)])
    const baseHash = manifest.files[name]?.baseHash ?? null

    if (!localHash) continue

    if (localHash === remoteHash) {
      manifest.files[name] = { baseHash: localHash, lastSyncedAt: new Date().toISOString() }
      continue
    }

    if (baseHash && localHash === baseHash) {
      skipped.push(name)
      continue
    }

    if (remoteHash && baseHash && remoteHash !== baseHash) {
      const conflictName = conflictFileName(name, 'local')
      await copyFileAtomic(localPath, path.join(config.canonDir, conflictName))
      conflicts.push(name)
      messages.push(`${name} changed in both places. Local copy uploaded as ${conflictName}.`)
      continue
    }

    await copyFileAtomic(localPath, remotePath)
    manifest.files[name] = { baseHash: localHash, lastSyncedAt: new Date().toISOString() }
    uploaded.push(name)
  }

  await writeManifest(manifest)
  return result('sync-up', { uploaded, skipped, conflicts, generated, messages })
}

export async function exportContextPacks() {
  await ensureDirectories()
  const generated = await exportContextFiles()
  return result('export-context', { generated })
}

async function exportContextFiles() {
  const sourceNames = (await listSupportedFiles(cacheDir))
    .filter((name) => getFileKind(name) === 'source' && path.extname(name).toLowerCase() === '.md')
    .sort(compareFileNames)
  const orderedNames = orderContextSources(sourceNames)
  const sources = []

  for (const name of orderedNames) {
    const content = await fs.readFile(path.join(cacheDir, name), 'utf8')
    sources.push({
      name,
      hash: hashText(content),
      outline: parseOutline(content, name),
      content,
    })
  }

  const generatedAt = new Date().toISOString()
  const full = [
    '<!--',
    'OOAM CONTEXT EXPORT',
    `Generated: ${generatedAt}`,
    'Mode: full',
    'Sources:',
    ...sources.map((source) => `- ${source.name} ${source.hash}`),
    '-->',
    '',
    '# OoaM Canon Context Pack',
    '',
    '## 0. Context Contract',
    '',
    'This generated file concatenates the current flat-file canon into one coherent context document.',
    'Source files remain the editable canon. This export is regenerated by the app.',
    '',
    ...sources.flatMap((source, index) => [
      `## ${index + 1}. ${contextSectionTitle(source.name)}`,
      '',
      `<!-- SOURCE: ${source.name} HASH: ${source.hash} -->`,
      '',
      source.content.trimEnd(),
      '',
      '---',
      '',
    ]),
  ].join('\n')

  const digest = [
    '<!--',
    'OOAM CONTEXT EXPORT',
    `Generated: ${generatedAt}`,
    'Mode: digest',
    'Sources:',
    ...sources.map((source) => `- ${source.name} ${source.hash}`),
    '-->',
    '',
    '# OoaM Canon Digest',
    '',
    '## Source Files',
    '',
    ...sources.map(
      (source) =>
        `- ${source.name}: ${source.outline.headingCount} headings, ${source.outline.events.length} timeline events`,
    ),
    '',
    '## Timeline Events',
    '',
    ...sources
      .flatMap((source) => source.outline.events)
      .map((event) => `- ${event.id}: ${event.title} (${event.era})`),
    '',
    '## Headings',
    '',
    ...sources.flatMap((source) => [
      `### ${source.name}`,
      '',
      ...source.outline.headings.map((heading) => `${'  '.repeat(Math.max(0, heading.depth - 1))}- ${heading.text}`),
      '',
    ]),
  ].join('\n')

  await writeWorkingFile('ooam.context.full.md', full)
  await writeWorkingFile('ooam.context.digest.md', digest)
  return ['ooam.context.full.md', 'ooam.context.digest.md']
}

async function result(action, values) {
  return {
    action,
    copied: values.copied ?? [],
    uploaded: values.uploaded ?? [],
    downloaded: values.downloaded ?? [],
    skipped: values.skipped ?? [],
    conflicts: values.conflicts ?? [],
    generated: values.generated ?? [],
    messages: values.messages ?? [],
    status: await getStatus(),
  }
}

async function readWorkingFile(name) {
  assertSafeFileName(name)
  const filePath = path.join(cacheDir, name)
  const content = await fs.readFile(filePath, 'utf8')
  return { name, content, hash: hashText(content) }
}

async function writeWorkingFile(name, content) {
  assertSafeFileName(name)
  await ensureDirectories()
  await writeFileAtomic(path.join(cacheDir, name), content)
}

async function readConfig() {
  await fs.mkdir(appDataRoot, { recursive: true })
  const savedConfig = await readSavedConfig()
  const envCanonDir = process.env.OOAM_CANON_DIR?.trim()

  if (savedConfig?.canonDir) {
    const savedExists = await directoryExists(savedConfig.canonDir)
    if (savedExists || !envCanonDir) {
      return normalizeConfig({
        canonDir: savedConfig.canonDir,
        canonDirSource: 'saved',
      })
    }
  }

  if (envCanonDir) {
    return normalizeConfig({
      canonDir: envCanonDir,
      canonDirSource: 'env',
    })
  }

  const config = normalizeConfig({
    canonDir: defaultCanonDir,
    canonDirSource: 'auto',
  })
  if (!savedConfig?.canonDir) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
  }
  return config
}

async function readSavedConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeConfig(config) {
  const normalized = normalizeConfig({ ...config, canonDirSource: 'saved' })
  const stat = await fs.stat(normalized.canonDir).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`Canon folder does not exist: ${normalized.canonDir}`)
  }
  await fs.mkdir(appDataRoot, { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), 'utf8')
}

function normalizeConfig(config) {
  const canonDir = path.resolve(assertString(config.canonDir, 'canonDir'))
  return {
    canonDir,
    canonDirSource: config.canonDirSource ?? 'saved',
  }
}

async function getConfigStatus(config) {
  const [canonDirExists, cacheDirExists] = await Promise.all([
    directoryExists(config.canonDir),
    directoryExists(cacheDir),
  ])
  const sourceFileCount = canonDirExists ? (await listSupportedFiles(config.canonDir)).length : 0

  return {
    appRoot,
    envPath,
    envLoaded: envLoadResult.loaded,
    envKeys: envLoadResult.keys,
    canonDir: config.canonDir,
    canonDirSource: config.canonDirSource,
    canonDirExists,
    cacheDir,
    cacheDirExists,
    configPath,
    manifestPath,
    defaultCanonDir,
    defaultCanonDirExists: await directoryExists(defaultCanonDir),
    sourceFileCount,
  }
}

async function readManifest() {
  await fs.mkdir(appDataRoot, { recursive: true })
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw)
    return { files: parsed.files ?? {} }
  } catch {
    return { files: {} }
  }
}

async function writeManifest(manifest) {
  await fs.mkdir(appDataRoot, { recursive: true })
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function ensureDirectories() {
  const config = await readConfig()
  const stat = await fs.stat(config.canonDir).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`Canon folder does not exist: ${config.canonDir}`)
  }
  await fs.mkdir(cacheDir, { recursive: true })
}

async function directoryExists(directory) {
  const stat = await fs.stat(directory).catch(() => null)
  return !!stat?.isDirectory()
}

async function listSupportedFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => supportedExtensions.has(path.extname(name).toLowerCase()))
    .filter((name) => !name.startsWith('.'))
    .sort(compareFileNames)
}

async function getFileInfo(filePath) {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) {
    return { exists: false, hash: null, size: null, modifiedAt: null }
  }
  return {
    exists: true,
    hash: await hashFile(filePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

async function hashFile(filePath) {
  try {
    const content = await fs.readFile(filePath)
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

async function copyFileAtomic(source, target) {
  const content = await fs.readFile(source)
  await writeBufferAtomic(target, content)
}

async function writeFileAtomic(target, content) {
  await writeBufferAtomic(target, Buffer.from(content, 'utf8'))
}

async function writeBufferAtomic(target, buffer) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temp, buffer)
  await fs.rename(temp, target)
}

function getSyncState(localHash, remoteHash, baseHash) {
  if (!localHash && remoteHash) return 'remote'
  if (localHash && !baseHash) return remoteHash && localHash === remoteHash ? 'synced' : 'untracked'
  if (localHash && remoteHash && localHash === remoteHash) return 'synced'
  const localChanged = !!localHash && localHash !== baseHash
  const remoteChanged = !!remoteHash && remoteHash !== baseHash
  if (localChanged && remoteChanged) return 'conflict'
  if (localChanged) return 'changed'
  if (remoteChanged) return 'remote'
  return 'synced'
}

function getFileKind(name) {
  if (name.startsWith('_ooam.')) return 'system'
  if (name.startsWith('ooam.context.')) return 'generated'
  if (name.includes('.conflict.')) return 'conflict'
  return 'source'
}

function parseOutline(content, source) {
  const headings = []
  const events = []
  let title = source
  let era = 'Ungrouped'

  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + 1
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!heading) continue
    const depth = heading[1].length
    const text = heading[2].trim()
    headings.push({ depth, text, lineNumber })
    if (title === source) title = text.replace(/^OoaM:\s*/i, '')
    if (depth <= 2 && !/^T\d{4}\s+[—-]/.test(text)) {
      era = text
    }
    const event = text.match(/^(T\d{4})\s+[—-]\s+(.+)$/)
    if (event) {
      events.push({
        id: event[1],
        title: event[2],
        era,
        source,
        lineNumber,
      })
    }
  }

  return {
    title,
    headings,
    headingCount: headings.length,
    events,
  }
}

function orderContextSources(names) {
  const priority = [
    'bibisco.md',
    'timeline.md',
    'characters.md',
    'factions.md',
    'locations.md',
    'arcs.md',
    'motifs.md',
    'continuity.md',
    'questions.md',
  ]
  return [...names].sort((a, b) => {
    const ai = priority.indexOf(a)
    const bi = priority.indexOf(b)
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    }
    return a.localeCompare(b)
  })
}

function contextSectionTitle(name) {
  const map = {
    'bibisco.md': 'Project Writing Guidelines',
    'timeline.md': 'Chronology',
    'characters.md': 'Characters',
    'factions.md': 'Factions',
    'locations.md': 'Locations',
    'arcs.md': 'Narrative Arcs',
    'motifs.md': 'Motifs And Themes',
    'continuity.md': 'Continuity Rules',
    'questions.md': 'Open Questions',
  }
  return map[name] ?? name.replace(/\.(md|txt|json)$/i, '').replace(/[-_]/g, ' ')
}

function compareFileNames(a, b) {
  return orderWeight(a) - orderWeight(b) || a.localeCompare(b)
}

function orderWeight(name) {
  if (name === 'bibisco.md') return 1
  if (name === 'timeline.md') return 2
  if (name.startsWith('ooam.context.')) return 90
  if (name.startsWith('_ooam.')) return 100
  return 50
}

function conflictFileName(name, side) {
  const ext = path.extname(name)
  const base = name.slice(0, -ext.length)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  return `${base}.${side}-conflict.${stamp}${ext}`
}

function assertSafeFileName(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !supportedExtensions.has(path.extname(name).toLowerCase())
  ) {
    throw new Error(`Unsafe file name: ${name}`)
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function resolveDefaultCanonDir() {
  const candidates = [
    process.env.OOAM_CANON_DIR,
    path.resolve(appRoot, 'OoaM_Canon'),
    path.resolve(appRoot, '..', 'OoaM_Canon'),
    path.resolve(appRoot, '..', '..', 'OoaM_Canon'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isDirectory()) {
      return resolved
    }
  }

  return path.resolve(appRoot, '..', 'OoaM_Canon')
}

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return { loaded: false, keys: [] }
  }

  const keys = []
  const content = fsSync.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const value = parseEnvValue(match[2])
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
    keys.push(key)
  }

  return { loaded: true, keys }
}

function parseEnvValue(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed.replace(/\s+#.*$/, '')
}

async function openFolder(directory) {
  if (!(await directoryExists(directory))) {
    throw new Error(`Folder does not exist: ${directory}`)
  }

  const command =
    process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [directory], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function sendJson(res, value) {
  const body = JSON.stringify(value)
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
  return true
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
  return true
}

export function createServer(handler, fallback) {
  return http.createServer(async (req, res) => {
    const handled = await handler(req, res)
    if (!handled && !res.headersSent) await fallback(req, res)
  })
}
