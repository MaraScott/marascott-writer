import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  ScrollView,
  Separator,
  Switch,
  Text,
  TextArea,
  XStack,
  YStack,
} from 'tamagui'
import {
  DownloadCloud,
  FileArchive,
  FileText,
  RefreshCw,
  Save,
  Search,
  UploadCloud,
} from '@tamagui/lucide-icons'
import type { CanonFileSummary, CanonStatus, SyncResult, TimelineEvent } from './types'

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

const stateLabel: Record<CanonFileSummary['syncState'], string> = {
  changed: 'Changed',
  conflict: 'Conflict',
  remote: 'Remote',
  synced: 'Synced',
  untracked: 'Untracked',
}

const fileKindLabel: Record<CanonFileSummary['kind'], string> = {
  conflict: 'Conflict',
  generated: 'Generated',
  source: 'Source',
  system: 'System',
}

const configSourceLabel: Record<CanonStatus['config']['canonDirSource'], string> = {
  auto: 'Auto default',
  env: '.env',
  saved: 'Saved config',
}

export function App() {
  const [status, setStatus] = useState<CanonStatus | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [savedValue, setSavedValue] = useState('')
  const [query, setQuery] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [autoSync, setAutoSync] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refreshStatus = useCallback(async () => {
    const next = await api<CanonStatus>('/api/status')
    setStatus(next)
    setPathDraft(next.canonDir)
    if (!selectedFile && next.files.length > 0) {
      setSelectedFile(next.files[0].name)
    }
    return next
  }, [selectedFile])

  const runAction = useCallback(
    async (label: string, action: () => Promise<SyncResult | CanonStatus>) => {
      setBusy(label)
      setError('')
      try {
        const result = await action()
        if ('status' in result) {
          setStatus(result.status)
          const uploaded = result.uploaded.length
          const downloaded = result.downloaded.length
          const conflicts = result.conflicts.length
          const generated = result.generated.length
          setNotice(
            `${label}: ${uploaded} uploaded, ${downloaded} downloaded, ${generated} generated, ${conflicts} conflicts.`,
          )
        } else {
          setStatus(result)
          setNotice(`${label}: refreshed.`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const syncDown = useCallback(
    () => runAction('Sync Down', () => api<SyncResult>('/api/sync/down', { method: 'POST' })),
    [runAction],
  )

  const syncUp = useCallback(
    () => runAction('Sync Up', () => api<SyncResult>('/api/sync/up', { method: 'POST' })),
    [runAction],
  )

  const exportContext = useCallback(
    () =>
      runAction('Context Export', () =>
        api<SyncResult>('/api/context/export', { method: 'POST' }),
      ),
    [runAction],
  )

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      setBusy('Startup Sync')
      setError('')
      try {
        const result = await api<SyncResult>('/api/sync/down', { method: 'POST' })
        if (cancelled) return
        setStatus(result.status)
        setPathDraft(result.status.canonDir)
        setNotice(
          `Startup Sync: ${result.downloaded.length} downloaded, ${result.conflicts.length} conflicts.`,
        )
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        try {
          const next = await api<CanonStatus>('/api/status')
          if (cancelled) return
          setStatus(next)
          setPathDraft(next.canonDir)
        } catch {
          // Keep the original startup error visible.
        }
      } finally {
        if (!cancelled) setBusy(null)
      }
    }

    start()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!autoSync) return
    const interval = window.setInterval(() => {
      api<SyncResult>('/api/sync/down', { method: 'POST' })
        .then(() => api<SyncResult>('/api/sync/up', { method: 'POST' }))
        .then((result) => {
          setStatus(result.status)
          setNotice(
            `Auto Sync: ${result.uploaded.length} uploaded, ${result.conflicts.length} conflicts.`,
          )
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }, 120000)

    return () => window.clearInterval(interval)
  }, [autoSync])

  useEffect(() => {
    if (!selectedFile) return
    setError('')
    api<{ name: string; content: string }>(`/api/files/${encodeURIComponent(selectedFile)}`)
      .then((file) => {
        setEditorValue(file.content)
        setSavedValue(file.content)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [selectedFile])

  const selectedSummary = useMemo(
    () => status?.files.find((file) => file.name === selectedFile) ?? null,
    [selectedFile, status],
  )

  const config = status?.config ?? null

  const filteredFiles = useMemo(() => {
    const files = status?.files ?? []
    const normalized = query.trim().toLowerCase()
    if (!normalized) return files
    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(normalized) ||
        file.title.toLowerCase().includes(normalized) ||
        file.syncState.toLowerCase().includes(normalized),
    )
  }, [query, status])

  const filteredEvents = useMemo(() => {
    const events = status?.events ?? []
    const normalized = query.trim().toLowerCase()
    if (!normalized) return events.slice(0, 80)
    return events
      .filter(
        (event) =>
          event.id.toLowerCase().includes(normalized) ||
          event.title.toLowerCase().includes(normalized) ||
          event.era.toLowerCase().includes(normalized),
      )
      .slice(0, 80)
  }, [query, status])

  const changedCount = status?.files.filter((file) => file.syncState === 'changed').length ?? 0
  const conflictCount = status?.files.filter((file) => file.syncState === 'conflict').length ?? 0
  const remoteCount = status?.files.filter((file) => file.syncState === 'remote').length ?? 0
  const hasUnsavedEditorChange = editorValue !== savedValue

  const saveFile = async () => {
    if (!selectedFile) return
    setBusy('Save')
    setError('')
    try {
      await api(`/api/files/${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editorValue }),
      })
      setSavedValue(editorValue)
      await refreshStatus()
      setNotice(`Saved ${selectedFile} to the local working copy.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const savePath = async () => {
    setBusy('Path')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/config', {
        method: 'POST',
        body: JSON.stringify({ canonDir: pathDraft }),
      })
      setStatus(next)
      setSelectedFile(next.files[0]?.name ?? null)
      setNotice('Canon folder updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const openFolder = async (label: string, endpoint: string) => {
    setBusy(label)
    setError('')
    try {
      const result = await api<{ opened: string }>(endpoint, { method: 'POST' })
      setNotice(`${label}: ${result.opened}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <YStack className="app-shell">
      <XStack className="topbar">
        <YStack gap="$1" minWidth={0}>
          <Text className="brand">OoaM Canon Workbench</Text>
          <Text className="subtle" numberOfLines={1}>
            {status?.canonDir ?? 'Loading canon folder'}
          </Text>
        </YStack>
        <XStack className="topbar-actions">
          <Button
            icon={DownloadCloud}
            disabled={!!busy}
            onPress={syncDown}
            title="Sync down all files"
          >
            Sync Down
          </Button>
          <Button
            icon={UploadCloud}
            disabled={!!busy}
            onPress={syncUp}
            title="Sync up all changed files"
          >
            Sync Up
          </Button>
          <Button
            icon={FileArchive}
            disabled={!!busy}
            onPress={exportContext}
            title="Generate context pack"
          >
            Export
          </Button>
          <Button icon={RefreshCw} disabled={!!busy} onPress={() => runAction('Refresh', refreshStatus)}>
            Refresh
          </Button>
        </XStack>
      </XStack>

      <XStack className="status-strip">
        <Metric label="Changed" value={changedCount} tone={changedCount ? 'amber' : 'neutral'} />
        <Metric label="Remote" value={remoteCount} tone={remoteCount ? 'cyan' : 'neutral'} />
        <Metric label="Conflicts" value={conflictCount} tone={conflictCount ? 'red' : 'neutral'} />
        <XStack className="autosync">
          <Text className="metric-label">Auto Sync</Text>
          <Switch size="$3" checked={autoSync} onCheckedChange={setAutoSync}>
            <Switch.Thumb animation="quick" />
          </Switch>
        </XStack>
        <Text className="notice" numberOfLines={1}>
          {busy ? `${busy}...` : error || notice || 'Ready'}
        </Text>
      </XStack>

      <XStack className="workspace">
        <YStack className="sidebar">
          <XStack className="search-box">
            <Search size={16} color="#667085" />
            <Input
              className="search-input"
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
            />
          </XStack>

          <YStack className="path-editor">
            <Text className="section-title">Canon Folder</Text>
            <Input value={pathDraft} onChangeText={setPathDraft} />
            {config && (
              <YStack className="config-card">
                <XStack className="config-row">
                  <Text className={`config-pill ${config.canonDirExists ? 'ok' : 'bad'}`}>
                    {config.canonDirExists ? 'Folder OK' : 'Missing'}
                  </Text>
                  <Text className="config-meta">
                    Source: {configSourceLabel[config.canonDirSource]}
                  </Text>
                </XStack>
                <Text className="config-meta">
                  {config.sourceFileCount} source files · .env {config.envLoaded ? 'loaded' : 'not loaded'}
                </Text>
                <Text className="config-meta" numberOfLines={1}>
                  Default: {config.defaultCanonDir}
                </Text>
              </YStack>
            )}
            <XStack className="path-actions">
              <Button size="$3" onPress={savePath} disabled={!!busy || !pathDraft.trim()}>
                Apply Path
              </Button>
              <Button
                size="$3"
                icon={FileArchive}
                disabled={!!busy || !config?.canonDirExists}
                onPress={() => openFolder('Open Canon', '/api/open/canon')}
              >
                Canon
              </Button>
              <Button
                size="$3"
                icon={FileArchive}
                disabled={!!busy}
                onPress={() => openFolder('Open Working Copy', '/api/open/cache')}
              >
                Work
              </Button>
            </XStack>
          </YStack>

          <Separator />

          <Text className="section-title">Files</Text>
          <ScrollView className="file-list">
            <YStack gap="$2">
              {filteredFiles.map((file) => (
                <Button
                  key={file.name}
                  className={`file-row ${selectedFile === file.name ? 'selected' : ''}`}
                  onPress={() => setSelectedFile(file.name)}
                  chromeless
                >
                  <XStack gap="$2" alignItems="center" width="100%">
                    <FileText size={16} color="#344054" />
                    <YStack minWidth={0} flex={1}>
                      <Text className="file-name" numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text className="file-meta" numberOfLines={1}>
                        {fileKindLabel[file.kind]} · {stateLabel[file.syncState]}
                      </Text>
                    </YStack>
                    <StatePill state={file.syncState} />
                  </XStack>
                </Button>
              ))}
            </YStack>
          </ScrollView>
        </YStack>

        <YStack className="editor-pane">
          <XStack className="editor-header">
            <YStack minWidth={0} flex={1}>
              <Text className="section-title" numberOfLines={1}>
                {selectedFile ?? 'No file selected'}
              </Text>
              {selectedSummary && (
                <Text className="subtle" numberOfLines={1}>
                  {selectedSummary.headingCount} headings · {selectedSummary.eventCount} events ·{' '}
                  {stateLabel[selectedSummary.syncState]}
                </Text>
              )}
            </YStack>
            <Button icon={Save} disabled={!selectedFile || !!busy || !hasUnsavedEditorChange} onPress={saveFile}>
              Save Local
            </Button>
          </XStack>
          <TextArea
            className="markdown-editor"
            value={editorValue}
            onChangeText={setEditorValue}
            spellCheck={false}
          />
        </YStack>

        <YStack className="inspector">
          <Text className="section-title">Timeline</Text>
          <ScrollView className="event-list">
            <YStack gap="$2">
              {filteredEvents.map((event) => (
                <EventRow key={`${event.source}-${event.id}`} event={event} />
              ))}
            </YStack>
          </ScrollView>

          <Separator />

          <Text className="section-title">Bibisco Lens</Text>
          <YStack className="prompt-list">
            <Prompt text="Who wants something here?" />
            <Prompt text="What changes after this event?" />
            <Prompt text="Which flaw, wound, or contradiction is exposed?" />
            <Prompt text="What does the reader know versus the truth?" />
            <Prompt text="Which motif or faction myth is reinforced?" />
          </YStack>
        </YStack>
      </XStack>
    </YStack>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'amber' | 'cyan' | 'red'
}) {
  return (
    <XStack className={`metric ${tone}`}>
      <Text className="metric-value">{value}</Text>
      <Text className="metric-label">{label}</Text>
    </XStack>
  )
}

function StatePill({ state }: { state: CanonFileSummary['syncState'] }) {
  return <Text className={`state-pill ${state}`}>{stateLabel[state]}</Text>
}

function EventRow({ event }: { event: TimelineEvent }) {
  return (
    <YStack className="event-row">
      <XStack justifyContent="space-between" gap="$2">
        <Text className="event-id">{event.id}</Text>
        <Text className="event-source">{event.source}</Text>
      </XStack>
      <Text className="event-title">{event.title}</Text>
      <Text className="event-era" numberOfLines={1}>
        {event.era}
      </Text>
    </YStack>
  )
}

function Prompt({ text }: { text: string }) {
  return <Text className="prompt">{text}</Text>
}
