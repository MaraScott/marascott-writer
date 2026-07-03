export type FileKind = 'source' | 'generated' | 'conflict' | 'system'
export type FileSyncState = 'synced' | 'changed' | 'remote' | 'conflict' | 'untracked'

export interface CanonFileSummary {
  name: string
  kind: FileKind
  title: string
  size: number
  localHash: string | null
  remoteHash: string | null
  baseHash: string | null
  modifiedAt: string | null
  syncState: FileSyncState
  headingCount: number
  eventCount: number
}

export interface TimelineEvent {
  id: string
  title: string
  era: string
  source: string
  lineNumber: number
}

export interface CanonInstance {
  id: string
  source: string
  lineNumber: number
  columnNumber: number
  excerpt: string
  eventId: string | null
  match: string
}

export interface CanonEntity {
  id: string
  kind: 'character' | 'location' | 'object' | 'event'
  name: string
  source: string
  lineNumber: number
  eventCount: number
  mentionCount: number
  eventIds: string[]
  inferred: boolean
  instances: CanonInstance[]
  aliases: string[]
  description: string
}

export interface CanonArc {
  id: string
  title: string
  source: string
  lineNumber: number
  eventCount: number
  eventIds: string[]
  firstEventId: string | null
  lastEventId: string | null
  aliases: string[]
  description: string
}

export interface CanonConfigStatus {
  appRoot: string
  envPath: string
  envLoaded: boolean
  envKeys: string[]
  canonDir: string
  canonDirSource: 'saved' | 'env' | 'auto'
  canonDirExists: boolean
  cacheDir: string
  cacheDirExists: boolean
  configPath: string
  manifestPath: string
  defaultCanonDir: string
  defaultCanonDirExists: boolean
  sourceFileCount: number
}

export interface CanonStatus {
  canonDir: string
  cacheDir: string
  config: CanonConfigStatus
  files: CanonFileSummary[]
  events: TimelineEvent[]
  characters: CanonEntity[]
  locations: CanonEntity[]
  objects: CanonEntity[]
  plotEvents: CanonEntity[]
  arcs: CanonArc[]
  generatedAt: string
}

export interface SyncResult {
  action: 'sync-down' | 'sync-up' | 'export-context' | 'export-archive' | 'import-archive'
  copied: string[]
  uploaded: string[]
  downloaded: string[]
  skipped: string[]
  conflicts: string[]
  generated: string[]
  messages: string[]
  status: CanonStatus
}

export type ChatGptContextMode = 'digest' | 'full' | 'current'

export interface ChatGptRequest {
  name: string
  content: string
  chatGptUrl: string
  generatedAt: string
}

export interface ChatGptResponseResult {
  name: string
  generatedAt: string
  status: CanonStatus
}
