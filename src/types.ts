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
  generatedAt: string
}

export interface SyncResult {
  action: 'sync-down' | 'sync-up' | 'export-context'
  copied: string[]
  uploaded: string[]
  downloaded: string[]
  skipped: string[]
  conflicts: string[]
  generated: string[]
  messages: string[]
  status: CanonStatus
}
