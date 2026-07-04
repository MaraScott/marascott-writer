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

      if (req.method === 'POST' && url.pathname === '/api/index/rebuild') {
        return sendJson(res, await getStatus())
      }

      if (req.method === 'POST' && url.pathname === '/api/entities') {
        const body = await readJson(req)
        const kind = assertEntityKind(body.kind)
        const name = assertString(body.name, 'name')
        await addRegistryEntity(kind, name)
        return sendJson(res, await getStatus())
      }

      if (req.method === 'PATCH' && url.pathname === '/api/entities/metadata') {
        const body = await readJson(req)
        const kind = assertEntityKind(body.kind)
        const name = assertString(body.name, 'name')
        const metadata = assertRegistryMetadata(body.metadata)
        await updateRegistryMetadata(kind, name, metadata)
        return sendJson(res, await getStatus())
      }

      if (req.method === 'PATCH' && url.pathname === '/api/entities') {
        const body = await readJson(req)
        const kind = assertEntityKind(body.kind)
        const name = assertString(body.name, 'name')
        const nextKind = assertEntityKind(body.nextKind ?? body.kind)
        const nextName = assertString(body.nextName ?? body.name, 'nextName')
        await updateRegistryEntity({ kind, name, nextKind, nextName })
        return sendJson(res, await getStatus())
      }

      if (req.method === 'DELETE' && url.pathname === '/api/entities') {
        const body = await readJson(req)
        const kind = assertEntityKind(body.kind)
        const name = assertString(body.name, 'name')
        await removeRegistryEntity(kind, name)
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

      if (req.method === 'POST' && url.pathname === '/api/chatgpt/request') {
        const body = await readJson(req)
        const mode = assertChatGptContextMode(body.mode)
        const instruction = assertString(body.instruction, 'instruction')
        const fileName = body.fileName === undefined ? null : assertString(body.fileName, 'fileName')
        return sendJson(res, await createChatGptRequest({ mode, instruction, fileName }))
      }

      if (req.method === 'POST' && url.pathname === '/api/chatgpt/open') {
        await openUrl('https://chatgpt.com/')
        return sendJson(res, { opened: 'https://chatgpt.com/' })
      }

      if (req.method === 'POST' && url.pathname === '/api/chatgpt/response') {
        const body = await readJson(req)
        const content = assertString(body.content, 'content')
        const title = body.title === undefined ? '' : assertOptionalString(body.title, 'title')
        return sendJson(res, await saveChatGptResponse({ content, title }))
      }

      if (req.method === 'POST' && url.pathname === '/api/archive/export') {
        return sendJson(res, await exportTimelineTagArchive())
      }

      if (req.method === 'POST' && url.pathname === '/api/archive/import') {
        const body = await readJson(req)
        const content = assertString(body.content, 'content')
        return sendJson(res, await importTimelineTagArchive(content))
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

      if (fileMatch && req.method === 'DELETE') {
        const name = decodeURIComponent(fileMatch[1])
        return sendJson(res, await deleteWorkingFile(name))
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
      characters: [],
      locations: [],
      objects: [],
      plotEvents: [],
      arcs: [],
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
  const canonViews = await buildCanonViews(files, events)

  return {
    canonDir: config.canonDir,
    cacheDir,
    config: configStatus,
    files,
    events,
    ...canonViews,
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
  await exportTimelineTagArchiveFile()
  const config = await readConfig()
  await ensureDirectories()
  const manifest = await readManifest()
  const localNames = await listSupportedFiles(cacheDir)
  const uploaded = []
  const skipped = []
  const conflicts = []
  const messages = []
  const generated = [
    'ooam.context.full.md',
    'ooam.context.digest.md',
    archiveFileName,
  ].filter((name) => localNames.includes(name))

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

export async function createChatGptRequest({ mode, instruction, fileName }) {
  await ensureDirectories()
  const context = await readChatGptContext(mode, fileName)
  const generatedAt = new Date().toISOString()
  const content = [
    '<!--',
    'OOAM CHATGPT REQUEST',
    `Generated: ${generatedAt}`,
    `Context mode: ${mode}`,
    `Context source: ${context.sourceName}`,
    'Transport: paste this request into https://chatgpt.com/ with your regular ChatGPT account.',
    '-->',
    '',
    '# OoaM ChatGPT Request',
    '',
    '## Request',
    '',
    instruction.trim(),
    '',
    '## Context',
    '',
    context.content.trimEnd(),
    '',
  ].join('\n')

  const name = '_ooam.chatgpt-request.md'
  await writeWorkingFile(name, content)
  return {
    name,
    content,
    chatGptUrl: 'https://chatgpt.com/',
    generatedAt,
  }
}

export async function saveChatGptResponse({ content, title }) {
  await ensureDirectories()
  const generatedAt = new Date().toISOString()
  const safeTitle = title.trim() || 'ChatGPT response'
  const response = [
    '<!--',
    'OOAM CHATGPT RESPONSE',
    `Saved: ${generatedAt}`,
    'Source: pasted from ChatGPT UI by the user.',
    '-->',
    '',
    `# ${safeTitle}`,
    '',
    content.trim(),
    '',
  ].join('\n')

  const name = `_ooam.chatgpt-response.${fileStamp(new Date(generatedAt))}.md`
  await writeWorkingFile(name, response)
  return {
    name,
    generatedAt,
    status: await getStatus(),
  }
}

export async function exportTimelineTagArchive() {
  await ensureDirectories()
  const generated = await exportTimelineTagArchiveFile()
  return result('export-archive', { generated })
}

export async function importTimelineTagArchive(content) {
  await ensureDirectories()
  const files = parseTimelineTagArchive(content)
  const imported = []

  for (const source of files) {
    await writeWorkingFile(source.name, source.content)
    imported.push(source.name)
  }

  const removed = await removeDuplicateTimelineTagWorkingFiles(imported)

  return result('import-archive', {
    copied: imported,
    skipped: removed,
    messages: [
      `Imported ${imported.length} files from ${archiveFileName}.`,
      ...(removed.length > 0
        ? [`Removed duplicate live timeline/tag files from the working copy: ${removed.join(', ')}.`]
        : []),
    ],
  })
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

async function readChatGptContext(mode, fileName) {
  if (mode === 'current') {
    if (!fileName) {
      throw new Error('fileName is required when ChatGPT context mode is current.')
    }
    assertSafeFileName(fileName)
    const content = await fs.readFile(path.join(cacheDir, fileName), 'utf8')
    return {
      sourceName: fileName,
      content: [
        `<!-- SOURCE: ${fileName} HASH: ${hashText(content)} -->`,
        '',
        content,
      ].join('\n'),
    }
  }

  await exportContextFiles()
  const sourceName = mode === 'full' ? 'ooam.context.full.md' : 'ooam.context.digest.md'
  return {
    sourceName,
    content: await fs.readFile(path.join(cacheDir, sourceName), 'utf8'),
  }
}

function fileStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

const archiveFileName = 'ooam.timeline-tags.archive.md'
const archiveSourceDefaults = {
  'timeline.md': '# Timeline\n',
  'events.md': '# Major Plot Events\n',
  'characters.md': '# Characters\n',
  'locations.md': '# Locations\n',
  'objects.md': '# Objects\n',
  'arcs.md': '# Narrative Arcs\n',
}
const archiveSourceNames = Object.keys(archiveSourceDefaults)
const archiveStartPattern = /^<!-- OOAM_ARCHIVE_FILE_START name="([^"]+)" hash="([a-f0-9]+)" -->$/
const archiveEndPattern = /^<!-- OOAM_ARCHIVE_FILE_END name="([^"]+)" -->$/

async function exportTimelineTagArchiveFile() {
  const sources = []

  for (const name of archiveSourceNames) {
    const rawContent = await fs
      .readFile(path.join(cacheDir, name), 'utf8')
      .catch(() => archiveSourceDefaults[name])
    const content = `${rawContent.trimEnd()}\n`
    sources.push({
      name,
      hash: hashText(content),
      content,
    })
  }

  const generatedAt = new Date().toISOString()
  const archive = [
    '<!--',
    'OOAM TIMELINE TAG ARCHIVE',
    `Generated: ${generatedAt}`,
    'Import: this file can be imported by OoaM Canon Workbench to restore the separated source files.',
    'Files:',
    ...sources.map((source) => `- ${source.name} ${source.hash}`),
    '-->',
    '',
    '# OoaM Timeline And Tag Archive',
    '',
    'This generated Markdown file stores the timeline and registry tag files as separate importable sections.',
    'Edit source files in the app when possible; import this archive only when you want to restore those files.',
    '',
    ...sources.flatMap((source) => [
      `## ${contextSectionTitle(source.name)}`,
      '',
      `<!-- OOAM_ARCHIVE_FILE_START name="${encodeURIComponent(source.name)}" hash="${source.hash}" -->`,
      source.content.trimEnd(),
      `<!-- OOAM_ARCHIVE_FILE_END name="${encodeURIComponent(source.name)}" -->`,
      '',
    ]),
  ].join('\n')

  await writeWorkingFile(archiveFileName, archive)
  return [archiveFileName]
}

function parseTimelineTagArchive(content) {
  if (!content.includes('OOAM TIMELINE TAG ARCHIVE')) {
    throw new Error('This is not an OoaM timeline/tag archive file.')
  }

  const allowedNames = new Set(archiveSourceNames)
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const files = []
  let current = null

  for (const line of lines) {
    const start = line.match(archiveStartPattern)
    if (start) {
      if (current) {
        throw new Error(`Archive section for ${current.name} was not closed.`)
      }
      const name = decodeURIComponent(start[1])
      assertArchiveSourceName(name, allowedNames)
      current = { name, lines: [] }
      continue
    }

    const end = line.match(archiveEndPattern)
    if (end) {
      if (!current) {
        throw new Error('Archive contains a closing marker without an opening marker.')
      }
      const name = decodeURIComponent(end[1])
      if (name !== current.name) {
        throw new Error(`Archive section for ${current.name} was closed as ${name}.`)
      }
      const fileContent = `${current.lines.join('\n').trimEnd()}\n`
      files.push({ name, content: fileContent })
      current = null
      continue
    }

    if (current) {
      current.lines.push(line)
    }
  }

  if (current) {
    throw new Error(`Archive section for ${current.name} was not closed.`)
  }
  if (files.length === 0) {
    throw new Error('Archive did not contain any importable files.')
  }

  return files
}

async function removeDuplicateTimelineTagWorkingFiles(importedNames) {
  const config = await readConfig()
  const canonicalNames = new Set(archiveSourceNames)
  const importedNameSet = new Set(importedNames)
  const removed = new Set()
  const manifest = await readManifest()
  const scanDirectory = async (directory, updateManifest) => {
    const names = await listSupportedFiles(directory)

    for (const name of names) {
      if (canonicalNames.has(name) || importedNameSet.has(name)) continue
      if (getFileKind(name) !== 'source' || path.extname(name).toLowerCase() !== '.md') continue

      const filePath = path.join(directory, name)
      const content = await fs.readFile(filePath, 'utf8').catch(() => '')
      if (!isDuplicateTimelineTagWorkingFile(name, content)) continue

      await fs.rm(filePath, { force: true })
      if (updateManifest) delete manifest.files[name]
      removed.add(name)
    }
  }

  await scanDirectory(cacheDir, true)
  await scanDirectory(config.canonDir, false)

  if (removed.size > 0) {
    await writeManifest(manifest)
  }

  return [...removed].sort(compareFileNames)
}

function isDuplicateTimelineTagWorkingFile(name, content) {
  const lowerName = name.toLowerCase()
  if (content.includes('OOAM TIMELINE TAG ARCHIVE')) return true
  if (/^timeline[-_.]/.test(lowerName) && parseOutline(content, name).events.length > 0) return true
  if (/^events[-_.]/.test(lowerName) && /^#\s+Major Plot Events\b/im.test(content)) return true
  if (/^characters[-_.]/.test(lowerName) && /^#\s+Characters\b/im.test(content)) return true
  if (/^locations[-_.]/.test(lowerName) && /^#\s+Locations\b/im.test(content)) return true
  if (/^objects[-_.]/.test(lowerName) && /^#\s+Objects\b/im.test(content)) return true
  if (/^arcs[-_.]/.test(lowerName) && /^#\s+Narrative Arcs\b/im.test(content)) return true
  return false
}

function assertArchiveSourceName(name, allowedNames) {
  assertSafeFileName(name)
  if (!allowedNames.has(name)) {
    throw new Error(`Archive contains unsupported source file: ${name}`)
  }
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

async function deleteWorkingFile(name) {
  assertSafeFileName(name)
  await ensureDirectories()
  await fs.rm(path.join(cacheDir, name), { force: true })
  const manifest = await readManifest()
  delete manifest.files[name]
  await writeManifest(manifest)
  return result('delete-file', {
    copied: [name],
    messages: [`Deleted ${name} from the working copy.`],
  })
}

const registryFileByKind = {
  character: 'characters.md',
  location: 'locations.md',
  object: 'objects.md',
  event: 'events.md',
  arc: 'arcs.md',
}

const registryTitleByKind = {
  character: 'Characters',
  location: 'Locations',
  object: 'Objects',
  event: 'Major Plot Events',
  arc: 'Narrative Arcs',
}

async function addRegistryEntity(kind, name) {
  const fileName = registryFileByKind[kind]
  const title = registryTitleByKind[kind]
  const cleanName = cleanEntityName(name)
  if (!isEntityCandidate(cleanName)) {
    throw new Error(`Invalid ${kind} name: ${name}`)
  }

  await ensureDirectories()
  const filePath = path.join(cacheDir, fileName)
  const existing = await fs.readFile(filePath, 'utf8').catch(() => `# ${title}\n`)
  const outline = parseOutline(existing, fileName)
  const normalizedName = cleanName.toLowerCase()
  const exists = outline.headings.some(
    (heading) => heading.depth === 2 && cleanEntityName(heading.text).toLowerCase() === normalizedName,
  )

  if (exists) return

  const next = `${existing.trimEnd()}\n\n## ${cleanName}\n`
  await writeWorkingFile(fileName, next)
}

async function updateRegistryEntity({ kind, name, nextKind, nextName }) {
  const cleanName = cleanEntityName(name)
  const cleanNextName = cleanEntityName(nextName)
  if (!isEntityCandidate(cleanName)) {
    throw new Error(`Invalid ${kind} name: ${name}`)
  }
  if (!isEntityCandidate(cleanNextName)) {
    throw new Error(`Invalid ${nextKind} name: ${nextName}`)
  }

  const sourceFileName = registryFileByKind[kind]
  const targetFileName = registryFileByKind[nextKind]
  const sourceContent = await readRegistryContent(kind)
  const sourceSection =
    findRegistrySection(sourceContent, cleanName) ??
    (cleanName.toLowerCase() !== cleanNextName.toLowerCase()
      ? findRegistrySection(sourceContent, cleanNextName)
      : null)
  if (!sourceSection) {
    throw new Error(`${cleanName} was not found in ${sourceFileName}`)
  }

  if (sourceFileName === targetFileName) {
    if (registryHasEntity(sourceContent, cleanNextName, sourceSection.start)) {
      throw new Error(`${cleanNextName} already exists in ${targetFileName}`)
    }

    const lines = sourceContent.split(/\r?\n/)
    lines[sourceSection.start] = `## ${cleanNextName}`
    await writeWorkingFile(sourceFileName, normalizeRegistryContent(lines.join('\n')))
    return
  }

  const targetContent = await readRegistryContent(nextKind)
  if (registryHasEntity(targetContent, cleanNextName)) {
    throw new Error(`${cleanNextName} already exists in ${targetFileName}`)
  }

  const sourceLines = sourceContent.split(/\r?\n/)
  const movedLines = sourceLines.slice(sourceSection.start, sourceSection.end)
  movedLines[0] = `## ${cleanNextName}`

  const nextSourceContent = removeRegistrySection(sourceContent, sourceSection)
  const nextTargetContent = appendRegistrySection(targetContent, movedLines)
  await writeWorkingFile(sourceFileName, nextSourceContent)
  await writeWorkingFile(targetFileName, nextTargetContent)
}

async function removeRegistryEntity(kind, name) {
  const cleanName = cleanEntityName(name)
  if (!isEntityCandidate(cleanName)) {
    throw new Error(`Invalid ${kind} name: ${name}`)
  }

  const fileName = registryFileByKind[kind]
  const content = await readRegistryContent(kind)
  const section = findRegistrySection(content, cleanName)
  if (!section) {
    throw new Error(`${cleanName} was not found in ${fileName}`)
  }

  await writeWorkingFile(fileName, removeRegistrySection(content, section))
}

async function updateRegistryMetadata(kind, name, metadata) {
  const cleanName = cleanEntityName(name)
  if (!isEntityCandidate(cleanName)) {
    throw new Error(`Invalid ${kind} name: ${name}`)
  }

  const fileName = registryFileByKind[kind]
  const content = await readRegistryContent(kind)
  const section = findRegistrySection(content, cleanName)
  if (!section) {
    throw new Error(`${cleanName} was not found in ${fileName}`)
  }

  await writeWorkingFile(fileName, setRegistrySectionMetadata(content, section, metadata))
}

async function readRegistryContent(kind) {
  const fileName = registryFileByKind[kind]
  const title = registryTitleByKind[kind]
  await ensureDirectories()
  return fs.readFile(path.join(cacheDir, fileName), 'utf8').catch(() => `# ${title}\n`)
}

function findRegistrySection(content, name) {
  const normalizedName = cleanEntityName(name).toLowerCase()
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{2,6})\s+(.+?)\s*$/)
    if (!heading) continue
    if (heading[1].length !== 2) continue
    if (cleanEntityName(heading[2]).toLowerCase() !== normalizedName) continue

    const depth = heading[1].length
    let end = lines.length
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextHeading = lines[next].match(/^(#{1,6})\s+(.+?)\s*$/)
      if (nextHeading && nextHeading[1].length <= depth) {
        end = next
        break
      }
    }

    return { start: index, end, depth }
  }

  return null
}

function registryHasEntity(content, name, excludedStart = null) {
  const normalizedName = cleanEntityName(name).toLowerCase()
  const lines = content.split(/\r?\n/)
  return lines.some((line, index) => {
    if (excludedStart !== null && index === excludedStart) return false
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/)
    return (
      !!heading &&
      heading[1].length === 2 &&
      cleanEntityName(heading[2]).toLowerCase() === normalizedName
    )
  })
}

function removeRegistrySection(content, section) {
  const lines = content.split(/\r?\n/)
  const next = [...lines.slice(0, section.start), ...lines.slice(section.end)]
  return normalizeRegistryContent(next.join('\n'))
}

function appendRegistrySection(content, sectionLines) {
  const cleanedSection = sectionLines.join('\n').trimEnd()
  const base = content.trimEnd()
  return normalizeRegistryContent(`${base}\n\n${cleanedSection}\n`)
}

function setRegistrySectionMetadata(content, section, metadata) {
  const lines = content.split(/\r?\n/)
  const sectionLines = lines.slice(section.start, section.end)
  const bodyLines = sectionLines.slice(getRegistryBodyStart(sectionLines))
  while (bodyLines[0]?.trim() === '') {
    bodyLines.shift()
  }

  const metadataLines = formatRegistryMetadata(metadata)
  const nextSectionLines = [
    sectionLines[0],
    ...metadataLines,
    ...(metadataLines.length > 0 && bodyLines.length > 0 ? [''] : []),
    ...bodyLines,
  ]
  const nextLines = [...lines.slice(0, section.start), ...nextSectionLines, ...lines.slice(section.end)]
  return normalizeRegistryContent(nextLines.join('\n'))
}

function getRegistryBodyStart(sectionLines) {
  let index = 1
  while (index < sectionLines.length) {
    const line = sectionLines[index]
    if (line.trim() === '' || isRegistryMetadataLine(line)) {
      index += 1
      continue
    }
    break
  }
  return index
}

function parseRegistryMetadata(content, section) {
  const lines = content.split(/\r?\n/).slice(section.start + 1, section.end)
  const metadata = { aliases: [], description: '', eventIds: [] }

  for (const line of lines) {
    if (line.trim() === '') continue
    const match = line.match(/^\s*(?:[-*]\s*)?(Aliases|Description|Events)\s*:\s*(.*?)\s*$/i)
    if (!match) break

    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'aliases') {
      metadata.aliases = parseListMetadata(value)
    }
    if (key === 'description') {
      metadata.description = value
    }
    if (key === 'events') {
      metadata.eventIds = parseEventIdList(value)
    }
  }

  return metadata
}

function isRegistryMetadataLine(line) {
  return /^\s*(?:[-*]\s*)?(Aliases|Description|Events)\s*:/i.test(line)
}

function formatRegistryMetadata(metadata) {
  const lines = []
  const aliases = uniqueCleanList(metadata.aliases ?? [])
  const description = normalizeMetadataText(metadata.description ?? '')
  const eventIds = uniqueCleanList(metadata.eventIds ?? []).map((eventId) => eventId.toUpperCase())

  if (aliases.length > 0) {
    lines.push(`Aliases: ${aliases.join(', ')}`)
  }
  if (description) {
    lines.push(`Description: ${description}`)
  }
  if (eventIds.length > 0) {
    lines.push(`Events: ${eventIds.join(', ')}`)
  }

  return lines
}

function assertRegistryMetadata(value) {
  const metadata = value && typeof value === 'object' ? value : {}
  return {
    aliases: Array.isArray(metadata.aliases)
      ? uniqueCleanList(metadata.aliases)
      : parseListMetadata(String(metadata.aliases ?? '')),
    description: normalizeMetadataText(String(metadata.description ?? '')),
    eventIds: Array.isArray(metadata.eventIds)
      ? uniqueCleanList(metadata.eventIds).map((eventId) => eventId.toUpperCase())
      : parseEventIdList(String(metadata.eventIds ?? '')),
  }
}

function parseListMetadata(value) {
  return uniqueCleanList(String(value).split(/[,;]/))
}

function parseEventIdList(value) {
  return uniqueCleanList(String(value).match(/T\d{4}/gi) ?? []).map((eventId) => eventId.toUpperCase())
}

function uniqueCleanList(values) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const clean = String(value).replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function normalizeMetadataText(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizeRegistryContent(content) {
  const normalized = content.replace(/\n{3,}/g, '\n\n').trimEnd()
  return `${normalized}\n`
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
  if (name === archiveFileName) return 'generated'
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

async function buildCanonViews(files, events) {
  const sourceFiles = files.filter((file) => file.localHash && file.kind === 'source')
  const documents = []

  for (const file of sourceFiles) {
    const content = await fs.readFile(path.join(cacheDir, file.name), 'utf8')
    documents.push({
      source: file.name,
      content,
      outline: parseOutline(content, file.name),
    })
  }

  const characters = new Map()
  const locations = new Map()
  const objects = new Map()
  const plotEvents = new Map()
  const arcDocuments = []

  for (const document of documents) {
    if (document.source.toLowerCase() === 'characters.md') {
      addExplicitHeadingEntities(characters, 'character', document)
    }
    if (document.source.toLowerCase() === 'locations.md') {
      addExplicitHeadingEntities(locations, 'location', document)
    }
    if (document.source.toLowerCase() === 'objects.md') {
      addExplicitHeadingEntities(objects, 'object', document)
    }
    if (document.source.toLowerCase() === 'events.md') {
      addExplicitHeadingEntities(plotEvents, 'event', document)
    }
    if (document.source.toLowerCase() === 'arcs.md') {
      arcDocuments.push(document)
    }
  }

  indexEntityOccurrences({ characters, locations, objects, plotEvents }, documents)

  const characterList = finalizeEntities(characters)
  const locationList = finalizeEntities(locations)

  return {
    characters: characterList,
    locations: locationList,
    objects: finalizeEntities(objects),
    plotEvents: finalizeEntities(plotEvents),
    arcs: buildRegistryArcs(arcDocuments, events),
  }
}

function addExplicitHeadingEntities(map, kind, document) {
  for (const heading of document.outline.headings) {
    if (heading.depth !== 2) continue
    const name = cleanEntityName(heading.text.replace(/^(T\d{4})\s+[—-]\s+/, ''))
    if (!isEntityCandidate(name)) continue
    if (isContainerHeading(name, kind)) continue
    const section = findRegistrySection(document.content, name)
    const metadata = section ? parseRegistryMetadata(document.content, section) : null
    addEntityMention(map, {
      kind,
      name,
      source: document.source,
      lineNumber: heading.lineNumber,
      eventId: null,
      inferred: false,
      metadata,
    })
  }
}

function indexEntityOccurrences(maps, documents) {
  const registryFiles = new Set(Object.values(registryFileByKind).map((name) => name.toLowerCase()))
  const entities = [
    ...maps.characters.values(),
    ...maps.locations.values(),
    ...maps.objects.values(),
    ...maps.plotEvents.values(),
  ].filter((entity) => isEntityCandidate(entity.name))

  for (const entity of entities) {
    entity.instances = []
    entity.eventIds = new Set()
    entity.mentionCount = 0
  }

  for (const document of documents) {
    if (registryFiles.has(document.source.toLowerCase())) continue

    const lines = document.content.split(/\r?\n/)
    let currentEventId = null
    let inFence = false

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index]
      const lineNumber = index + 1

      if (/^\s*```/.test(rawLine)) {
        inFence = !inFence
      }

      const heading = rawLine.match(/^#{1,6}\s+(T\d{4})\s+[—-]\s+(.+?)\s*$/)
      if (heading) {
        currentEventId = heading[1]
      }

      if (inFence) continue

      const searchableLine = stripMarkdownTargets(rawLine)
      for (const entity of entities) {
        for (const searchName of getEntitySearchNames(entity)) {
          const matches = findNameOccurrences(searchableLine, searchName)
          for (const match of matches) {
            addEntityInstance(entity, {
              source: document.source,
              lineNumber,
              columnNumber: match.index + 1,
              excerpt: createOccurrenceExcerpt(searchableLine, match.index, searchName.length),
              eventId: currentEventId,
              match: searchName,
            })
          }
        }
      }
    }
  }
}

function getEntitySearchNames(entity) {
  return uniqueCleanList([entity.name, ...(entity.aliases ?? [])])
}

function stripMarkdownTargets(text) {
  return text
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]+\)/g, ']')
    .replace(/!\[[^\]\n]*\]\([^)]+\)/g, ' ')
}

function findNameOccurrences(text, name) {
  const matches = []
  const needle = name.toLocaleLowerCase()
  if (!needle) return matches

  const haystack = text.toLocaleLowerCase()
  let index = 0
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    const before = index > 0 ? text[index - 1] : ''
    const after = text[index + name.length] ?? ''
    if (isNameBoundary(before) && isNameBoundary(after)) {
      matches.push({ index })
    }
    index += Math.max(needle.length, 1)
  }

  return matches
}

function isNameBoundary(char) {
  return !char || !/[\p{L}\p{N}_]/u.test(char)
}

function addEntityInstance(entity, instance) {
  const id = `${instance.source}:${instance.lineNumber}:${instance.columnNumber}`
  if (entity.instances.some((existing) => existing.id === id)) return

  entity.instances.push({
    id,
    ...instance,
  })
  entity.mentionCount = entity.instances.length
  if (instance.eventId) {
    entity.eventIds.add(instance.eventId)
  }
}

function createOccurrenceExcerpt(text, start, length) {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 180) return compact

  const from = Math.max(0, start - 70)
  const to = Math.min(text.length, start + length + 100)
  const excerpt = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '...' : ''}${excerpt}${to < text.length ? '...' : ''}`
}

function addEntityMention(map, mention) {
  const id = slugify(`${mention.kind}:${mention.name}`)
  const existing =
    map.get(id) ??
    {
      id,
      kind: mention.kind,
      name: mention.name,
      source: mention.source,
      lineNumber: mention.lineNumber,
      eventIds: new Set(),
      mentionCount: 0,
      instances: [],
      aliases: [],
      description: '',
      inferred: true,
    }

  existing.mentionCount += 1
  if (mention.eventId) {
    existing.eventIds.add(mention.eventId)
  }
  if (!mention.inferred && existing.inferred) {
    existing.source = mention.source
    existing.lineNumber = mention.lineNumber
    existing.inferred = false
  }
  if (mention.lineNumber < existing.lineNumber && existing.inferred === mention.inferred) {
    existing.source = mention.source
    existing.lineNumber = mention.lineNumber
  }
  if (mention.metadata) {
    existing.aliases = mention.metadata.aliases ?? []
    existing.description = mention.metadata.description ?? ''
  }

  map.set(id, existing)
}

function finalizeEntities(map) {
  return [...map.values()]
    .map((entity) => ({
      ...entity,
      eventIds: [...entity.eventIds].sort(),
      eventCount: entity.eventIds.size,
      aliases: entity.aliases ?? [],
      description: entity.description ?? '',
    }))
    .filter((entity) => entity.eventCount > 0 || !entity.inferred)
    .sort(
      (a, b) =>
        b.eventCount - a.eventCount ||
        b.mentionCount - a.mentionCount ||
        a.name.localeCompare(b.name),
    )
}

function buildRegistryArcs(documents, events) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const arcs = []

  for (const document of documents) {
    for (const heading of document.outline.headings) {
      if (heading.depth !== 2) continue
      const title = cleanEntityName(heading.text)
      if (!isEntityCandidate(title) || isContainerHeading(title, 'arc')) continue

      const section = findRegistrySection(document.content, title)
      const metadata = section ? parseRegistryMetadata(document.content, section) : { aliases: [], description: '', eventIds: [] }
      const eventIds = metadata.eventIds.filter((eventId) => eventMap.has(eventId))
      arcs.push({
        id: slugify(`arc:${title}`),
        title,
        source: document.source,
        lineNumber: heading.lineNumber,
        eventIds,
        eventCount: eventIds.length,
        firstEventId: eventIds[0] ?? null,
        lastEventId: eventIds[eventIds.length - 1] ?? null,
        aliases: metadata.aliases,
        description: metadata.description,
      })
    }
  }

  return arcs.sort(
    (a, b) =>
      b.eventCount - a.eventCount ||
      a.title.localeCompare(b.title),
  )
}

function cleanEntityName(name) {
  return name
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,:;!?()[\]{}]+$/g, '')
    .trim()
}

function isEntityCandidate(name) {
  if (!name || name.length < 2 || name.length > 70) return false
  if (/^T\d{4}/.test(name)) return false
  if (/https?:\/\//i.test(name)) return false
  return /[A-Za-z]/.test(name)
}

function isContainerHeading(name, kind) {
  return (
    (kind === 'character' && /^characters?$/i.test(name)) ||
    (kind === 'location' && /^locations?$/i.test(name)) ||
    (kind === 'object' && /^objects?$/i.test(name)) ||
    (kind === 'event' && /^events?$/i.test(name)) ||
    (kind === 'arc' && /^arcs?$/i.test(name))
  )
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function orderContextSources(names) {
  const priority = [
    'bibisco.md',
    'timeline.md',
    'events.md',
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
    'events.md': 'Major Plot Events',
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

function assertOptionalString(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }
  return value.trim()
}

function assertChatGptContextMode(value) {
  if (value === 'full' || value === 'digest' || value === 'current') {
    return value
  }
  throw new Error(`Unsupported ChatGPT context mode: ${value}`)
}

function assertEntityKind(value) {
  if (
    value === 'character' ||
    value === 'location' ||
    value === 'object' ||
    value === 'event' ||
    value === 'arc'
  ) {
    return value
  }
  throw new Error(`Unsupported entity kind: ${value}`)
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

async function openUrl(url) {
  const command =
    process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, {
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
