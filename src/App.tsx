import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Input,
  ScrollView,
  Separator,
  Switch,
  Text,
  XStack,
  YStack,
} from 'tamagui'
import {
  DownloadCloud,
  FileArchive,
  FileText,
  MoveRight,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UploadCloud,
} from '@tamagui/lucide-icons'
import { MarkdownEditor } from './components/MarkdownEditor'
import { MarkdownPreview } from './components/MarkdownPreview'
import type {
  CanonArc,
  CanonEntity,
  CanonFileSummary,
  CanonInstance,
  CanonStatus,
  SyncResult,
  TimelineEvent,
} from './types'

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

interface EditorNavigationTarget {
  lineNumber: number
  token: string
}

type InspectorView = 'timeline' | 'events' | 'characters' | 'locations' | 'objects' | 'arcs'
type EntityInspectorView = 'events' | 'characters' | 'locations' | 'objects'
type RegistryInspectorView = EntityInspectorView | 'arcs'
type EntityKind = CanonEntity['kind']
type RegistryKind = EntityKind | 'arc'

interface MetadataDraft {
  aliases: string
  description: string
  eventIds: string
}

const registryKindByView: Record<RegistryInspectorView, RegistryKind> = {
  events: 'event',
  characters: 'character',
  locations: 'location',
  objects: 'object',
  arcs: 'arc',
}

const registryLabelByView: Record<RegistryInspectorView, string> = {
  events: 'plot event',
  characters: 'character',
  locations: 'location',
  objects: 'object',
  arcs: 'arc',
}

const entityLabelByKind: Record<EntityKind, string> = {
  character: 'Character',
  location: 'Location',
  object: 'Object',
  event: 'Event',
}

const entityViewByKind: Record<EntityKind, EntityInspectorView> = {
  character: 'characters',
  location: 'locations',
  object: 'objects',
  event: 'events',
}

const entityRegistryFileByKind: Record<EntityKind, string> = {
  character: 'characters.md',
  location: 'locations.md',
  object: 'objects.md',
  event: 'events.md',
}

const emptyMetadataDraft: MetadataDraft = {
  aliases: '',
  description: '',
  eventIds: '',
}

function isEntityInspectorView(view: InspectorView): view is EntityInspectorView {
  return view === 'events' || view === 'characters' || view === 'locations' || view === 'objects'
}

function isRegistryInspectorView(view: InspectorView): view is RegistryInspectorView {
  return isEntityInspectorView(view) || view === 'arcs'
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
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null)
  const [selectedReferenceKey, setSelectedReferenceKey] = useState<string | null>(null)
  const [editorTarget, setEditorTarget] = useState<EditorNavigationTarget | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [inspectorView, setInspectorView] = useState<InspectorView>('timeline')
  const [newEntryDraft, setNewEntryDraft] = useState('')
  const [editEntryDraft, setEditEntryDraft] = useState('')
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>(emptyMetadataDraft)
  const editorDirtyRef = useRef(false)
  const editorDraftRef = useRef('')
  const archiveImportInputRef = useRef<HTMLInputElement | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const metadataDraftRef = useRef<MetadataDraft>(emptyMetadataDraft)

  const setMetadataDraftValue = useCallback((draft: MetadataDraft) => {
    metadataDraftRef.current = draft
    setMetadataDraft(draft)
  }, [])

  const applyStatus = useCallback((next: CanonStatus, options: { force?: boolean } = {}) => {
    setPathDraft(next.canonDir)
    if (!options.force && editorDirtyRef.current) return
    setStatus((current) => (current && sameStatusPayload(current, next) ? current : next))
  }, [])

  const refreshStatus = useCallback(async () => {
    const next = await api<CanonStatus>('/api/status')
    applyStatus(next, { force: true })
    if (!selectedFile && next.files.length > 0) {
      setSelectedFile(next.files[0].name)
    }
    return next
  }, [applyStatus, selectedFile])

  const runAction = useCallback(
    async (label: string, action: () => Promise<SyncResult | CanonStatus>) => {
      setBusy(label)
      setError('')
      try {
        const result = await action()
        if ('status' in result) {
          applyStatus(result.status, { force: true })
          const uploaded = result.uploaded.length
          const downloaded = result.downloaded.length
          const copied = result.copied.length
          const conflicts = result.conflicts.length
          const generated = result.generated.length
          setNotice(
            `${label}: ${uploaded} uploaded, ${downloaded} downloaded, ${copied} restored, ${generated} generated, ${conflicts} conflicts.`,
          )
        } else {
          applyStatus(result, { force: true })
          setNotice(`${label}: refreshed.`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [applyStatus],
  )

  const syncDown = useCallback(
    () => runAction('Sync Down', () => api<SyncResult>('/api/sync/down', { method: 'POST' })),
    [runAction],
  )

  const syncUp = useCallback(
    () => runAction('Sync Up', () => api<SyncResult>('/api/sync/up', { method: 'POST' })),
    [runAction],
  )

  const exportArchive = useCallback(async () => {
    setBusy('Export')
    setError('')
    try {
      const result = await api<SyncResult>('/api/archive/export', { method: 'POST' })
      applyStatus(result.status, { force: true })
      const archiveName = result.generated[0] ?? 'ooam.timeline-tags.archive.md'
      const archive = await api<{ name: string; content: string }>(
        `/api/files/${encodeURIComponent(archiveName)}`,
      )
      downloadTextFile(archive.name, archive.content)
      setNotice(`Export: downloaded ${archive.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [applyStatus])

  const selectArchiveImport = useCallback(() => {
    archiveImportInputRef.current?.click()
  }, [])

  const importArchive = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return

      try {
        const content = await file.text()
        await runAction('Archive Import', () =>
          api<SyncResult>('/api/archive/import', {
            method: 'POST',
            body: JSON.stringify({ content }),
          }),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [runAction],
  )

  const reindexCanon = useCallback(
    () =>
      runAction('Reindex', () =>
        api<CanonStatus>('/api/index/rebuild', { method: 'POST' }),
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
        applyStatus(result.status, { force: true })
        setNotice(
          `Startup Sync: ${result.downloaded.length} downloaded, ${result.conflicts.length} conflicts.`,
        )
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        try {
          const next = await api<CanonStatus>('/api/status')
          if (cancelled) return
          applyStatus(next, { force: true })
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
  }, [applyStatus])

  useEffect(() => {
    if (!autoSync) return
    const interval = window.setInterval(() => {
      api<SyncResult>('/api/sync/down', { method: 'POST' })
        .then(() => api<SyncResult>('/api/sync/up', { method: 'POST' }))
        .then((result) => {
          applyStatus(result.status)
          setNotice(
            `Auto Sync: ${result.uploaded.length} uploaded, ${result.conflicts.length} conflicts.`,
          )
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }, 120000)

    return () => window.clearInterval(interval)
  }, [applyStatus, autoSync])

  useEffect(() => {
    const interval = window.setInterval(() => {
      api<CanonStatus>('/api/index/rebuild', { method: 'POST' })
        .then((next) => {
          applyStatus(next)
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }, 30000)

    return () => window.clearInterval(interval)
  }, [applyStatus])

  useEffect(() => {
    if (!selectedFile) return
    setError('')
    api<{ name: string; content: string }>(`/api/files/${encodeURIComponent(selectedFile)}`)
      .then((file) => {
        editorDraftRef.current = file.content
        setEditorValue(file.content)
        setSavedValue(file.content)
        editorDirtyRef.current = false
        setEditorDirty(false)
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

  const filteredCharacters = useMemo(
    () => filterEntities(status?.characters ?? [], query).slice(0, 120),
    [query, status],
  )

  const filteredLocations = useMemo(
    () => filterEntities(status?.locations ?? [], query).slice(0, 120),
    [query, status],
  )

  const filteredObjects = useMemo(
    () => filterEntities(status?.objects ?? [], query).slice(0, 120),
    [query, status],
  )

  const filteredPlotEvents = useMemo(
    () => filterEntities(status?.plotEvents ?? [], query).slice(0, 120),
    [query, status],
  )

  const filteredArcs = useMemo(() => {
    const arcs = status?.arcs ?? []
    const normalized = query.trim().toLowerCase()
    if (!normalized) return arcs
    return arcs.filter(
      (arc) =>
        arc.title.toLowerCase().includes(normalized) ||
        arc.description.toLowerCase().includes(normalized) ||
        arc.aliases.some((alias) => alias.toLowerCase().includes(normalized)) ||
        arc.eventIds.some((eventId) => eventId.toLowerCase().includes(normalized)),
    )
  }, [query, status])

  const selectedEntity = useMemo(() => {
    if (!status || !selectedReferenceKey || !isEntityInspectorView(inspectorView)) return null
    return (
      getEntitiesForInspectorView(status, inspectorView).find(
        (entity) => selectedReferenceKey === `${entity.kind}:${entity.id}`,
      ) ?? null
    )
  }, [inspectorView, selectedReferenceKey, status])

  const selectedArc = useMemo(() => {
    if (!status || !selectedReferenceKey || inspectorView !== 'arcs') return null
    return status.arcs.find((arc) => selectedReferenceKey === `arc:${arc.id}`) ?? null
  }, [inspectorView, selectedReferenceKey, status])

  useEffect(() => {
    if (selectedEntity) {
      setEditEntryDraft(selectedEntity.name)
      setMetadataDraftValue({
        aliases: selectedEntity.aliases.join(', '),
        description: selectedEntity.description,
        eventIds: '',
      })
      return
    }

    if (selectedArc) {
      setEditEntryDraft(selectedArc.title)
      setMetadataDraftValue({
        aliases: selectedArc.aliases.join(', '),
        description: selectedArc.description,
        eventIds: selectedArc.eventIds.join(', '),
      })
      return
    }

    setEditEntryDraft('')
    setMetadataDraftValue(emptyMetadataDraft)
  }, [
    selectedArc?.aliases,
    selectedArc?.description,
    selectedArc?.eventIds,
    selectedArc?.id,
    selectedArc?.title,
    selectedEntity?.aliases,
    selectedEntity?.description,
    selectedEntity?.id,
    selectedEntity?.kind,
    selectedEntity?.name,
    setMetadataDraftValue,
  ])

  const changedCount = status?.files.filter((file) => file.syncState === 'changed').length ?? 0
  const conflictCount = status?.files.filter((file) => file.syncState === 'conflict').length ?? 0
  const remoteCount = status?.files.filter((file) => file.syncState === 'remote').length ?? 0
  const hasUnsavedEditorChange = editorDirty

  useEffect(() => {
    editorDirtyRef.current = hasUnsavedEditorChange
  }, [hasUnsavedEditorChange])

  const handleEditorChange = useCallback(
    (value: string) => {
      editorDraftRef.current = value
      const nextDirty = value !== savedValue
      editorDirtyRef.current = nextDirty
      setEditorDirty((current) => (current === nextDirty ? current : nextDirty))
    },
    [savedValue],
  )

  const saveFile = async () => {
    if (!selectedFile) return
    const content = editorDraftRef.current
    setBusy('Save')
    setError('')
    try {
      await api(`/api/files/${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      })
      setEditorValue(content)
      setSavedValue(content)
      editorDirtyRef.current = false
      setEditorDirty(false)
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
      applyStatus(next, { force: true })
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

  const addRegistryEntry = async () => {
    if (!isRegistryInspectorView(inspectorView)) return
    const name = newEntryDraft.trim()
    if (!name) return

    const kind = registryKindByView[inspectorView]
    setBusy('Add Entry')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities', {
        method: 'POST',
        body: JSON.stringify({ kind, name }),
      })
      applyStatus(next, { force: true })
      setNewEntryDraft('')
      setSelectedReferenceKey(null)
      setNotice(`Added ${name} to ${registryLabelByView[inspectorView]} registry.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const updateSelectedArcName = async () => {
    if (!selectedArc) return
    const nextName = editEntryDraft.trim()
    if (!nextName) {
      setEditEntryDraft(selectedArc.title)
      return
    }
    if (nextName === selectedArc.title) return

    setBusy('Rename Arc')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities', {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'arc',
          name: selectedArc.title,
          nextKind: 'arc',
          nextName,
        }),
      })
      applyStatus(next, { force: true })
      setSelectedReferenceKey(findArcReferenceKey(next, nextName))
      setNotice(`Updated ${selectedArc.title} to ${nextName}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const updateSelectedMetadata = async (draft: MetadataDraft = metadataDraftRef.current) => {
    const subject = selectedEntity ?? selectedArc
    if (!subject) return

    const kind = selectedEntity?.kind ?? 'arc'
    const name = selectedEntity?.name ?? selectedArc?.title
    if (!name) return

    const currentDraft = draft
    metadataDraftRef.current = currentDraft
    const metadata = {
      aliases: parseDraftList(currentDraft.aliases),
      description: currentDraft.description.trim(),
      eventIds: selectedArc ? parseEventIdDraft(currentDraft.eventIds) : [],
    }

    if (metadataMatchesSelection(metadata, selectedEntity, selectedArc)) return

    setBusy('Save Metadata')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities/metadata', {
        method: 'PATCH',
        body: JSON.stringify({ kind, name, metadata }),
      })
      applyStatus(next, { force: true })
      setSelectedReferenceKey(
        selectedEntity
          ? findEntityReferenceKey(next, selectedEntity.kind, selectedEntity.name)
          : findArcReferenceKey(next, name),
      )
      setNotice(`Saved metadata for ${name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const updateSelectedRegistryEntry = async () => {
    if (!selectedEntity) return
    const nextName = editEntryDraft.trim()
    if (!nextName) {
      setEditEntryDraft(selectedEntity.name)
      return
    }
    if (nextName === selectedEntity.name) return

    await mutateSelectedRegistryEntry({
      nextKind: selectedEntity.kind,
      nextName,
      busyLabel: 'Rename Entry',
      notice: `Updated ${selectedEntity.name} to ${nextName}.`,
    })
  }

  const moveSelectedRegistryEntry = async (nextKind: EntityKind) => {
    if (!selectedEntity) return
    const nextName = editEntryDraft.trim() || selectedEntity.name
    if (nextKind === selectedEntity.kind) {
      await updateSelectedRegistryEntry()
      return
    }
    await mutateSelectedRegistryEntry({
      nextKind,
      nextName,
      busyLabel: 'Move Entry',
      notice: `Moved ${selectedEntity.name} to ${entityLabelByKind[nextKind].toLowerCase()}s.`,
    })
  }

  const mutateSelectedRegistryEntry = async ({
    nextKind,
    nextName,
    busyLabel,
    notice: nextNotice,
  }: {
    nextKind: EntityKind
    nextName: string
    busyLabel: string
    notice: string
  }) => {
    if (!selectedEntity) return

    setBusy(busyLabel)
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities', {
        method: 'PATCH',
        body: JSON.stringify({
          kind: selectedEntity.kind,
          name: selectedEntity.name,
          nextKind,
          nextName,
        }),
      })
      applyStatus(next, { force: true })
      setInspectorView(entityViewByKind[nextKind])
      setSelectedReferenceKey(findEntityReferenceKey(next, nextKind, nextName))
      setNotice(nextNotice)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const removeSelectedRegistryEntry = async () => {
    if (!selectedEntity) return
    const shouldRemove = window.confirm(`Remove ${selectedEntity.name} from ${selectedEntity.source}?`)
    if (!shouldRemove) return

    setBusy('Remove Entry')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities', {
        method: 'DELETE',
        body: JSON.stringify({
          kind: selectedEntity.kind,
          name: selectedEntity.name,
        }),
      })
      applyStatus(next, { force: true })
      setSelectedReferenceKey(null)
      setEditEntryDraft('')
      setNotice(`Removed ${selectedEntity.name} from the registry.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const removeSelectedRegistryArc = async () => {
    if (!selectedArc) return
    const shouldRemove = window.confirm(`Remove ${selectedArc.title} from ${selectedArc.source}?`)
    if (!shouldRemove) return

    setBusy('Remove Arc')
    setError('')
    try {
      const next = await api<CanonStatus>('/api/entities', {
        method: 'DELETE',
        body: JSON.stringify({
          kind: 'arc',
          name: selectedArc.title,
        }),
      })
      applyStatus(next, { force: true })
      setSelectedReferenceKey(null)
      setEditEntryDraft('')
      setMetadataDraftValue(emptyMetadataDraft)
      setNotice(`Removed ${selectedArc.title} from the registry.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const openSourceReference = ({
    source,
    lineNumber,
    key,
    label,
    rememberReference = true,
  }: {
    source: string
    lineNumber: number
    key: string
    label: string
    rememberReference?: boolean
  }) => {
    if (hasUnsavedEditorChange && selectedFile && selectedFile !== source) {
      const shouldContinue = window.confirm(
        'You have unsaved local edits in the current file. Switch files without saving them?',
      )
      if (!shouldContinue) return
    }

    if (rememberReference) {
      setSelectedReferenceKey(key)
    }
    setSelectedFile(source)
    setEditorTarget({
      lineNumber,
      token: `${key}:${Date.now()}`,
    })
    setPreviewMode(false)
    setNotice(`Opened ${label} in ${source} at line ${lineNumber}.`)
  }

  const selectTimelineEvent = (event: TimelineEvent) => {
    const eventKey = `${event.source}:${event.id}`
    setSelectedEventKey(eventKey)
    openSourceReference({
      source: event.source,
      lineNumber: event.lineNumber,
      key: eventKey,
      label: event.id,
    })
  }

  const selectEntity = (entity: CanonEntity) => {
    setSelectedEventKey(null)
    setSelectedReferenceKey(`${entity.kind}:${entity.id}`)
    setNotice(`${entity.name}: ${entity.instances.length} occurrences indexed.`)
  }

  const selectEntityInstance = (entity: CanonEntity, instance: CanonInstance) => {
    setSelectedEventKey(null)
    openSourceReference({
      source: instance.source,
      lineNumber: instance.lineNumber,
      key: `${entity.kind}:${entity.id}:${instance.id}`,
      label: entity.name,
      rememberReference: false,
    })
  }

  const selectArc = (arc: CanonArc) => {
    setSelectedEventKey(null)
    setSelectedReferenceKey(`arc:${arc.id}`)
    setNotice(`${arc.title}: ${arc.eventCount} timeline events referenced.`)
  }

  const changeInspectorView = (view: InspectorView) => {
    setInspectorView(view)
    setSelectedEventKey(null)
    setSelectedReferenceKey(null)
    setNewEntryDraft('')
    setMetadataDraftValue(emptyMetadataDraft)
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
          <input
            ref={archiveImportInputRef}
            className="archive-import-input"
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={importArchive}
          />
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
            onPress={exportArchive}
            title="Export timeline and tag files as one importable Markdown file"
          >
            Export
          </Button>
          <Button
            icon={UploadCloud}
            disabled={!!busy}
            onPress={selectArchiveImport}
            title="Import a timeline/tag Markdown archive into separate source files"
          >
            Import
          </Button>
          <Button
            icon={RefreshCw}
            disabled={!!busy}
            onPress={reindexCanon}
            title="Parse saved Markdown files and refresh canon views"
          >
            Reindex
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
            <XStack className="preview-toggle">
              <Text className={!previewMode ? 'toggle-label active' : 'toggle-label'}>Edit</Text>
              <Switch size="$3" checked={previewMode} onCheckedChange={setPreviewMode}>
                <Switch.Thumb animation="quick" />
              </Switch>
              <Text className={previewMode ? 'toggle-label active' : 'toggle-label'}>Preview</Text>
            </XStack>
            <Button icon={Save} disabled={!selectedFile || !!busy || !hasUnsavedEditorChange} onPress={saveFile}>
              Save Local
            </Button>
          </XStack>
          {previewMode ? (
            <MarkdownPreview value={editorDraftRef.current} />
          ) : (
            <MarkdownEditor
              value={editorValue}
              onChange={handleEditorChange}
              onSave={saveFile}
              navigationTarget={editorTarget}
            />
          )}
        </YStack>

        <YStack className="inspector">
          <XStack className="inspector-tabs">
            <InspectorTab
              label="Timeline"
              active={inspectorView === 'timeline'}
              onPress={() => changeInspectorView('timeline')}
            />
            <InspectorTab
              label="Events"
              active={inspectorView === 'events'}
              onPress={() => changeInspectorView('events')}
            />
            <InspectorTab
              label="Characters"
              active={inspectorView === 'characters'}
              onPress={() => changeInspectorView('characters')}
            />
            <InspectorTab
              label="Locations"
              active={inspectorView === 'locations'}
              onPress={() => changeInspectorView('locations')}
            />
            <InspectorTab
              label="Objects"
              active={inspectorView === 'objects'}
              onPress={() => changeInspectorView('objects')}
            />
            <InspectorTab
              label="Arcs"
              active={inspectorView === 'arcs'}
              onPress={() => changeInspectorView('arcs')}
            />
          </XStack>

          {isRegistryInspectorView(inspectorView) && (
            <XStack className="entry-add">
              <Input
                className="search-input"
                value={newEntryDraft}
                onChangeText={setNewEntryDraft}
                placeholder={`Add ${registryLabelByView[inspectorView]}`}
              />
              <Button icon={Plus} disabled={!!busy || !newEntryDraft.trim()} onPress={addRegistryEntry}>
                Add
              </Button>
            </XStack>
          )}

          {inspectorView === 'timeline' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredEvents.length === 0 && <EmptyView label="No timeline events found." />}
                {filteredEvents.map((event) => (
                  <EventRow
                    key={`${event.source}-${event.id}`}
                    event={event}
                    active={selectedEventKey === `${event.source}:${event.id}`}
                    onPress={() => selectTimelineEvent(event)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {inspectorView === 'events' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredPlotEvents.length === 0 && (
                  <EmptyView label="No saved plot event entries." />
                )}
                {filteredPlotEvents.map((entity) => (
                  <EntityRow
                    key={entity.id}
                    entity={entity}
                    active={selectedReferenceKey === `${entity.kind}:${entity.id}`}
                    onPress={() => selectEntity(entity)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {inspectorView === 'characters' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredCharacters.length === 0 && (
                  <EmptyView label="No saved character entries." />
                )}
                {filteredCharacters.map((entity) => (
                  <EntityRow
                    key={entity.id}
                    entity={entity}
                    active={selectedReferenceKey === `${entity.kind}:${entity.id}`}
                    onPress={() => selectEntity(entity)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {inspectorView === 'locations' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredLocations.length === 0 && (
                  <EmptyView label="No saved location entries." />
                )}
                {filteredLocations.map((entity) => (
                  <EntityRow
                    key={entity.id}
                    entity={entity}
                    active={selectedReferenceKey === `${entity.kind}:${entity.id}`}
                    onPress={() => selectEntity(entity)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {inspectorView === 'arcs' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredArcs.length === 0 && (
                  <EmptyView label="No saved arc entries." />
                )}
                {filteredArcs.map((arc) => (
                  <ArcRow
                    key={arc.id}
                    arc={arc}
                    active={selectedReferenceKey === `arc:${arc.id}`}
                    onPress={() => selectArc(arc)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {inspectorView === 'objects' && (
            <ScrollView className="event-list">
              <YStack gap="$2">
                {filteredObjects.length === 0 && (
                  <EmptyView label="No saved object entries." />
                )}
                {filteredObjects.map((entity) => (
                  <EntityRow
                    key={entity.id}
                    entity={entity}
                    active={selectedReferenceKey === `${entity.kind}:${entity.id}`}
                    onPress={() => selectEntity(entity)}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}

          {selectedEntity && (
            <InstancePanel
              entity={selectedEntity}
              canEdit={isRegistryBackedEntity(selectedEntity)}
              editName={editEntryDraft}
              metadataDraft={metadataDraft}
              disabled={!!busy}
              onEditNameChange={setEditEntryDraft}
              onEditNameBlur={updateSelectedRegistryEntry}
              onMetadataCommit={updateSelectedMetadata}
              onMove={moveSelectedRegistryEntry}
              onRemove={removeSelectedRegistryEntry}
              onPress={(instance) => selectEntityInstance(selectedEntity, instance)}
            />
          )}

          {selectedArc && (
            <ArcPanel
              arc={selectedArc}
              events={status?.events ?? []}
              editName={editEntryDraft}
              metadataDraft={metadataDraft}
              disabled={!!busy}
              onEditNameChange={setEditEntryDraft}
              onEditNameBlur={updateSelectedArcName}
              onMetadataCommit={updateSelectedMetadata}
              onRemove={removeSelectedRegistryArc}
              onOpenEvent={selectTimelineEvent}
            />
          )}

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

function InspectorTab({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Button chromeless className={`inspector-tab ${active ? 'active' : ''}`} onPress={onPress}>
      <Text className={active ? 'inspector-tab-label active' : 'inspector-tab-label'}>{label}</Text>
    </Button>
  )
}

function StatePill({ state }: { state: CanonFileSummary['syncState'] }) {
  return <Text className={`state-pill ${state}`}>{stateLabel[state]}</Text>
}

function EventRow({
  event,
  active,
  onPress,
}: {
  event: TimelineEvent
  active: boolean
  onPress: () => void
}) {
  return (
    <Button
      chromeless
      className={`event-row ${active ? 'active' : ''}`}
      onPress={onPress}
      title={`Open ${event.id} in ${event.source}`}
    >
      <YStack width="100%" gap="$1">
        <XStack justifyContent="space-between" gap="$2">
          <Text className="event-id">{event.id}</Text>
          <Text className="event-source">{event.source} · line {event.lineNumber}</Text>
        </XStack>
        <Text className="event-title">{event.title}</Text>
        <Text className="event-era" numberOfLines={1}>
          {event.era}
        </Text>
      </YStack>
    </Button>
  )
}

function EntityRow({
  entity,
  active,
  onPress,
}: {
  entity: CanonEntity
  active: boolean
  onPress: () => void
}) {
  return (
    <Button
      chromeless
      className={`event-row entity-row ${active ? 'active' : ''}`}
      onPress={onPress}
      title={`Show occurrences for ${entity.name}`}
    >
      <YStack width="100%" gap="$1">
        <XStack justifyContent="space-between" gap="$2">
          <Text className="event-id">{entity.name}</Text>
          <Text className="event-source">{entity.source} · line {entity.lineNumber}</Text>
        </XStack>
        <Text className="event-title">
          {entity.instances.length} occurrences · {entity.eventCount} timeline events
        </Text>
        <Text className="event-era" numberOfLines={1}>
          {entity.description || 'Saved in flat file'}
          {entity.aliases.length ? ` · aliases: ${entity.aliases.slice(0, 4).join(', ')}` : ''}
        </Text>
      </YStack>
    </Button>
  )
}

function InstancePanel({
  entity,
  canEdit,
  editName,
  metadataDraft,
  disabled,
  onEditNameChange,
  onEditNameBlur,
  onMetadataCommit,
  onMove,
  onRemove,
  onPress,
}: {
  entity: CanonEntity
  canEdit: boolean
  editName: string
  metadataDraft: MetadataDraft
  disabled: boolean
  onEditNameChange: (name: string) => void
  onEditNameBlur: () => void
  onMetadataCommit: (draft: MetadataDraft) => void
  onMove: (kind: EntityKind) => void
  onRemove: () => void
  onPress: (instance: CanonInstance) => void
}) {
  return (
    <YStack className="instance-panel">
      <XStack className="instance-heading">
        <Text className="section-title" numberOfLines={1}>
          {entity.name}
        </Text>
        <Text className="event-source">
          {entity.instances.length} occurrence{entity.instances.length === 1 ? '' : 's'}
        </Text>
      </XStack>

      <YStack className="entity-actions">
        {canEdit ? (
          <>
            <XStack className="entity-edit-row">
              <Input
                className="entity-edit-input"
                value={editName}
                onChangeText={onEditNameChange}
                onBlur={onEditNameBlur}
                placeholder="Registry name"
              />
              <Button
                icon={Trash2}
                disabled={disabled}
                onPress={onRemove}
                title="Remove this registry item"
              >
                Remove
              </Button>
            </XStack>
            <MetadataFields
              draft={metadataDraft}
              showEvents={false}
              disabled={disabled}
              onCommit={onMetadataCommit}
            />
            <XStack className="entity-move-row">
              {(['event', 'character', 'location', 'object'] as EntityKind[])
                .filter((kind) => kind !== entity.kind)
                .map((kind) => (
                  <Button
                    key={kind}
                    size="$2"
                    icon={MoveRight}
                    disabled={disabled}
                    onPress={() => onMove(kind)}
                    title={`Move to ${entityLabelByKind[kind]}`}
                  >
                    {entityLabelByKind[kind]}
                  </Button>
                ))}
            </XStack>
          </>
        ) : (
          <Text className="entity-action-note">
            This item was inferred from story text. Add it to the registry before editing the item itself.
          </Text>
        )}
      </YStack>

      {entity.instances.length === 0 ? (
        <EmptyView label="No saved occurrences found yet. Add the exact name in Markdown, save, then Reindex." />
      ) : (
        <ScrollView className="instance-list">
          <YStack gap="$2">
            {entity.instances.map((instance) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                onPress={() => onPress(instance)}
              />
            ))}
          </YStack>
        </ScrollView>
      )}
    </YStack>
  )
}

function MetadataFields({
  draft,
  showEvents,
  disabled,
  onCommit,
}: {
  draft: MetadataDraft
  showEvents: boolean
  disabled: boolean
  onCommit: (draft: MetadataDraft) => void
}) {
  const [localDraft, setLocalDraft] = useState(draft)
  const localDraftRef = useRef(draft)

  const setLocalDraftValue = useCallback((next: MetadataDraft) => {
    localDraftRef.current = next
    setLocalDraft(next)
  }, [])

  useEffect(() => {
    localDraftRef.current = draft
    setLocalDraft(draft)
  }, [draft.aliases, draft.description, draft.eventIds])

  return (
    <YStack className="metadata-fields">
      <Input
        className="metadata-input"
        value={localDraft.aliases}
        disabled={disabled}
        onChangeText={(aliases) => setLocalDraftValue({ ...localDraftRef.current, aliases })}
        onBlur={() => onCommit(localDraftRef.current)}
        placeholder="Aliases, comma separated"
      />
      <Input
        className="metadata-input"
        value={localDraft.description}
        disabled={disabled}
        onChangeText={(description) => setLocalDraftValue({ ...localDraftRef.current, description })}
        onBlur={() => onCommit(localDraftRef.current)}
        placeholder="Description"
      />
      {showEvents && (
        <Input
          className="metadata-input"
          value={localDraft.eventIds}
          disabled={disabled}
          onChangeText={(eventIds) => setLocalDraftValue({ ...localDraftRef.current, eventIds })}
          onBlur={() => onCommit(localDraftRef.current)}
          placeholder="Timeline events: T0001, T0002"
        />
      )}
    </YStack>
  )
}

function ArcPanel({
  arc,
  events,
  editName,
  metadataDraft,
  disabled,
  onEditNameChange,
  onEditNameBlur,
  onMetadataCommit,
  onRemove,
  onOpenEvent,
}: {
  arc: CanonArc
  events: TimelineEvent[]
  editName: string
  metadataDraft: MetadataDraft
  disabled: boolean
  onEditNameChange: (name: string) => void
  onEditNameBlur: () => void
  onMetadataCommit: (draft: MetadataDraft) => void
  onRemove: () => void
  onOpenEvent: (event: TimelineEvent) => void
}) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const arcEvents = arc.eventIds.map((eventId) => eventMap.get(eventId) ?? null)

  return (
    <YStack className="instance-panel">
      <XStack className="instance-heading">
        <Text className="section-title" numberOfLines={1}>
          {arc.title}
        </Text>
        <Text className="event-source">
          {arc.eventCount} event{arc.eventCount === 1 ? '' : 's'}
        </Text>
      </XStack>

      <YStack className="entity-actions">
        <XStack className="entity-edit-row">
          <Input
            className="entity-edit-input"
            value={editName}
            disabled={disabled}
            onChangeText={onEditNameChange}
            onBlur={onEditNameBlur}
            placeholder="Arc name"
          />
          <Button icon={Trash2} disabled={disabled} onPress={onRemove} title="Remove this arc">
            Remove
          </Button>
        </XStack>
        <MetadataFields
          draft={metadataDraft}
          showEvents
          disabled={disabled}
          onCommit={onMetadataCommit}
        />
      </YStack>

      {arc.eventIds.length === 0 ? (
        <EmptyView label="No timeline events referenced. Add TXXXX ids in the Events metadata field." />
      ) : (
        <ScrollView className="instance-list">
          <YStack gap="$2">
            {arc.eventIds.map((eventId, index) => {
              const event = arcEvents[index]
              return event ? (
                <EventRow
                  key={eventId}
                  event={event}
                  active={false}
                  onPress={() => onOpenEvent(event)}
                />
              ) : (
                <Text key={eventId} className="empty-view">
                  {eventId} is not present in the timeline.
                </Text>
              )
            })}
          </YStack>
        </ScrollView>
      )}
    </YStack>
  )
}

function InstanceRow({
  instance,
  onPress,
}: {
  instance: CanonInstance
  onPress: () => void
}) {
  return (
    <Button
      chromeless
      className="instance-row"
      onPress={onPress}
      title={`Open ${instance.source} line ${instance.lineNumber}`}
    >
      <YStack width="100%" gap="$1">
        <XStack justifyContent="space-between" gap="$2">
          <Text className="event-id">
            {instance.source} · line {instance.lineNumber}
          </Text>
          <Text className="event-source">
            {instance.eventId ?? `col ${instance.columnNumber}`}
            {instance.match ? ` · ${instance.match}` : ''}
          </Text>
        </XStack>
        <Text className="instance-excerpt" numberOfLines={3}>
          {instance.excerpt}
        </Text>
      </YStack>
    </Button>
  )
}

function ArcRow({
  arc,
  active,
  onPress,
}: {
  arc: CanonArc
  active: boolean
  onPress: () => void
}) {
  return (
    <Button
      chromeless
      className={`event-row arc-row ${active ? 'active' : ''}`}
      onPress={onPress}
      title={`Open ${arc.title}`}
    >
      <YStack width="100%" gap="$1">
        <XStack justifyContent="space-between" gap="$2">
          <Text className="event-id">{arc.title}</Text>
          <Text className="event-source">{arc.source} · line {arc.lineNumber}</Text>
        </XStack>
        <Text className="event-title">
          {arc.eventCount} events · {arc.firstEventId ?? 'n/a'} to {arc.lastEventId ?? 'n/a'}
        </Text>
        <Text className="event-era" numberOfLines={1}>
          {arc.description || arc.eventIds.slice(0, 8).join(', ')}
        </Text>
      </YStack>
    </Button>
  )
}

function Prompt({ text }: { text: string }) {
  return <Text className="prompt">{text}</Text>
}

function EmptyView({ label }: { label: string }) {
  return <Text className="empty-view">{label}</Text>
}

function downloadTextFile(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function filterEntities(entities: CanonEntity[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return entities
  return entities.filter(
    (entity) =>
      entity.name.toLowerCase().includes(normalized) ||
      entity.source.toLowerCase().includes(normalized) ||
      entity.description.toLowerCase().includes(normalized) ||
      entity.aliases.some((alias) => alias.toLowerCase().includes(normalized)) ||
      entity.eventIds.some((eventId) => eventId.toLowerCase().includes(normalized)),
  )
}

function getEntitiesForInspectorView(status: CanonStatus, view: EntityInspectorView) {
  if (view === 'events') return status.plotEvents
  if (view === 'characters') return status.characters
  if (view === 'locations') return status.locations
  return status.objects
}

function getEntitiesForKind(status: CanonStatus, kind: EntityKind) {
  if (kind === 'event') return status.plotEvents
  if (kind === 'character') return status.characters
  if (kind === 'location') return status.locations
  return status.objects
}

function findEntityReferenceKey(status: CanonStatus, kind: EntityKind, name: string) {
  const normalizedName = normalizeEntityName(name)
  const entity = getEntitiesForKind(status, kind).find(
    (candidate) => normalizeEntityName(candidate.name) === normalizedName,
  )
  return entity ? `${entity.kind}:${entity.id}` : null
}

function findArcReferenceKey(status: CanonStatus, title: string) {
  const normalizedTitle = normalizeEntityName(title)
  const arc = status.arcs.find((candidate) => normalizeEntityName(candidate.title) === normalizedTitle)
  return arc ? `arc:${arc.id}` : null
}

function isRegistryBackedEntity(entity: CanonEntity) {
  return entity.source.toLowerCase() === entityRegistryFileByKind[entity.kind]
}

function normalizeEntityName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function parseDraftList(value: string) {
  return uniqueDraftList(value.split(/[,;]/))
}

function parseEventIdDraft(value: string) {
  return uniqueDraftList(value.match(/T\d{4}/gi) ?? []).map((eventId) => eventId.toUpperCase())
}

function uniqueDraftList(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const clean = value.trim().replace(/\s+/g, ' ')
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function metadataMatchesSelection(
  metadata: { aliases: string[]; description: string; eventIds: string[] },
  entity: CanonEntity | null,
  arc: CanonArc | null,
) {
  if (entity) {
    return sameStringList(metadata.aliases, entity.aliases) && metadata.description === entity.description
  }
  if (arc) {
    return (
      sameStringList(metadata.aliases, arc.aliases) &&
      metadata.description === arc.description &&
      sameStringList(metadata.eventIds, arc.eventIds)
    )
  }
  return true
}

function sameStringList(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function sameStatusPayload(current: CanonStatus, next: CanonStatus) {
  return statusPayloadFingerprint(current) === statusPayloadFingerprint(next)
}

function statusPayloadFingerprint(status: CanonStatus) {
  return JSON.stringify({
    canonDir: status.canonDir,
    cacheDir: status.cacheDir,
    config: status.config,
    files: status.files,
    events: status.events,
    characters: status.characters,
    locations: status.locations,
    objects: status.objects,
    plotEvents: status.plotEvents,
    arcs: status.arcs,
  })
}
