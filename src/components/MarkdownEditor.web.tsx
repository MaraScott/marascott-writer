import { useEffect, useMemo, useRef } from 'react'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, Prec, type EditorState as CodeMirrorState } from '@codemirror/state'
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  tagSuggestions?: TagSuggestion[]
  navigationTarget?: {
    lineNumber: number
    token: string
  } | null
}

interface TagSuggestion {
  kind: 'character' | 'location' | 'object' | 'event' | 'timeline'
  id: string
  label: string
  detail?: string
}

const EMPTY_TAG_SUGGESTIONS: TagSuggestion[] = []

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  readOnly = false,
  tagSuggestions = EMPTY_TAG_SUGGESTIONS,
  navigationTarget = null,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const extensions = useMemo(
    () => [
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown(),
      ...(tagSuggestions.length > 0
        ? [
            ooamTagHighlighting,
            autocompletion({
              override: [createOoamTagCompletionSource(tagSuggestions)],
            }),
          ]
        : []),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString())
          if (tagSuggestions.length > 0) {
            maybeStartOoamCompletion(update)
          }
        }
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.()
              return true
            },
          },
        ]),
      ),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
      ]),
      editorTheme,
    ],
    [readOnly, tagSuggestions],
  )

  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions,
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentValue = view.state.doc.toString()
    if (value === currentValue) return

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    })
    scrollToNavigationTarget(view, navigationTarget)
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    scrollToNavigationTarget(view, navigationTarget)
  }, [navigationTarget?.token])

  return <div ref={hostRef} className="markdown-editor" />
}

function scrollToNavigationTarget(
  view: EditorView,
  navigationTarget: MarkdownEditorProps['navigationTarget'],
) {
  if (!navigationTarget) return

  const lineNumber = Math.max(1, Math.min(navigationTarget.lineNumber, view.state.doc.lines))
  const line = view.state.doc.line(lineNumber)
  view.dispatch({
    selection: { anchor: line.from, head: line.to },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
  })
  view.focus()
}

interface CompletionToken {
  kind: TagSuggestion['kind']
  text: string
  from: number
  to: number
}

function createOoamTagCompletionSource(tagSuggestions: TagSuggestion[]) {
  return (context: CompletionContext) => {
    const token = getCompletionTokenAt(context.state, context.pos)
    if (!token) return null

    const existingOptions = tagSuggestions
      .filter((suggestion) => suggestion.kind === token.kind)
      .filter((suggestion) => suggestionMatchesToken(suggestion, token.text))
      .slice(0, token.kind === 'timeline' ? 40 : 25)
      .map((suggestion) => makeTagCompletion(suggestion, token.from, token.to))

    const options: Completion[] = [...existingOptions]
    const query = getTokenQuery(token)

    if (token.kind !== 'timeline' && query) {
      const label = toDisplayName(query)
      const id = slugifyForUri(label)
      if (!existingOptions.some((option) => option.label.toLowerCase() === label.toLowerCase())) {
        options.unshift(
          makeTagCompletion(
            {
              kind: token.kind,
              id,
              label,
              detail: `Create ${tagKindLabel[token.kind]}`,
            },
            token.from,
            token.to,
          ),
        )
      }
    }

    if (options.length === 0 && token.kind !== 'timeline') {
      options.push(makeInstructionCompletion(token.kind))
    }

    return {
      from: token.from,
      options,
      validFor: /^([@~$%][\wÀ-ÿ’' -]*|T\d{0,4})$/i,
    }
  }
}

function getCompletionTokenAt(state: CodeMirrorState, pos: number): CompletionToken | null {
  const line = state.doc.lineAt(pos)
  const beforeCursor = state.sliceDoc(line.from, pos)
  return getCompletionTokenFromText(beforeCursor, pos)
}

function getCompletionTokenFromText(beforeCursor: string, pos: number): CompletionToken | null {
  const tagMatch = beforeCursor.match(/(^|[\s([{])([@~$%][\wÀ-ÿ’' -]{0,80})$/)
  if (tagMatch) {
    const text = tagMatch[2]
    const kind = triggerToKind(text[0])
    if (!kind) return null
    return {
      kind,
      text,
      from: pos - text.length,
      to: pos,
    }
  }

  const timelineMatch = beforeCursor.match(/(^|[\s([{])(T\d{1,4})$/i)
  if (timelineMatch) {
    const text = timelineMatch[2].toUpperCase()
    return {
      kind: 'timeline',
      text,
      from: pos - timelineMatch[2].length,
      to: pos,
    }
  }

  return null
}

function suggestionMatchesToken(suggestion: TagSuggestion, tokenText: string) {
  const query = getTokenQuery({ kind: suggestion.kind, text: tokenText, from: 0, to: 0 })
    .toLowerCase()

  if (!query) return true
  return suggestion.id.toLowerCase().includes(query) || suggestion.label.toLowerCase().includes(query)
}

function getTokenQuery(token: CompletionToken) {
  if (token.kind === 'timeline') return token.text.toLowerCase()
  return token.text.slice(1).trim()
}

function makeTagCompletion(suggestion: TagSuggestion, from: number, to: number): Completion {
  return {
    label: suggestion.label,
    detail: suggestion.detail ?? suggestion.kind,
    type: suggestion.kind === 'timeline' ? 'constant' : 'variable',
    apply: (view) => {
      const uri =
        suggestion.kind === 'timeline'
          ? `ooam://timeline/${suggestion.id}`
          : `ooam://${suggestion.kind}/${suggestion.id || slugifyForUri(suggestion.label)}`
      view.dispatch({
        changes: {
          from,
          to,
          insert: `[${suggestion.label}](${uri})`,
        },
      })
    },
  }
}

function makeInstructionCompletion(kind: TagSuggestion['kind']): Completion {
  return {
    label: `Type ${tagKindLabel[kind]} name`,
    detail: 'then select Create',
    type: 'text',
    apply: () => {},
  }
}

function triggerToKind(trigger: string): TagSuggestion['kind'] | null {
  if (trigger === '@') return 'character'
  if (trigger === '~' || trigger === '!') return 'location'
  if (trigger === '$') return 'object'
  if (trigger === '%' || trigger === '*') return 'event'
  return null
}

const tagKindLabel: Record<TagSuggestion['kind'], string> = {
  character: 'character',
  location: 'location',
  object: 'object',
  event: 'plot event',
  timeline: 'timeline',
}

function maybeStartOoamCompletion(update: ViewUpdate) {
  if (!update.view.hasFocus) return
  const cursor = update.state.selection.main
  if (!cursor.empty || cursor.head === 0) return

  const token = getCompletionTokenAt(update.state, cursor.head)
  if (!token) return

  const view = update.view
  const expectedHead = cursor.head
  queueMicrotask(() => {
    const currentCursor = view.state.selection.main
    if (!currentCursor.empty || currentCursor.head !== expectedHead) return
    if (completionStatus(view.state) !== null) return
    startCompletion(update.view)
  })
}

function toDisplayName(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function slugifyForUri(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const ooamTagHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildOoamTagDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildOoamTagDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
)

function buildOoamTagDecorations(view: EditorView) {
  const ranges = []
  const tagRegex =
    /\[([^\]\n]+)\]\(ooam:\/\/(character|location|object|event|timeline)\/[^)\s]+\)/gi

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    tagRegex.lastIndex = 0
    let match
    while ((match = tagRegex.exec(text))) {
      const kind = match[2].toLowerCase()
      ranges.push(
        Decoration.mark({
          class: `cm-ooam-tag cm-ooam-tag-${kind}`,
        }).range(from + match.index, from + match.index + match[0].length),
      )
    }
  }

  const draft = getDraftTagDecoration(view)
  if (draft) {
    ranges.push(draft)
  }

  return Decoration.set(ranges)
}

function getDraftTagDecoration(view: EditorView) {
  const cursor = view.state.selection.main
  if (!cursor.empty) return null

  const line = view.state.doc.lineAt(cursor.head)
  const beforeCursor = view.state.sliceDoc(line.from, cursor.head)
  const token = getCompletionTokenFromText(beforeCursor, cursor.head)
  if (token && token.kind !== 'timeline') {
    return Decoration.mark({
      class: `cm-ooam-tag-draft cm-ooam-tag-draft-${token.kind}`,
    }).range(token.from, token.to)
  }

  if (token?.kind === 'timeline') {
    return Decoration.mark({
      class: 'cm-ooam-tag-draft cm-ooam-tag-draft-timeline',
    }).range(token.from, token.to)
  }

  return null
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#fbfdff',
    color: '#182230',
  },
  '.cm-scroller': {
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: '13px',
    lineHeight: '20px',
  },
  '.cm-content': {
    padding: '16px 0',
  },
  '.cm-line': {
    padding: '0 16px',
  },
  '.cm-gutters': {
    backgroundColor: '#f3f6fa',
    borderRight: '1px solid #d7dde8',
    color: '#8a95a6',
  },
  '.cm-activeLine': {
    backgroundColor: '#eef5ff',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#e2edf9',
    color: '#325b8c',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#325b8c',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#c8dcf2',
  },
  '.cm-ooam-tag': {
    borderRadius: '4px',
    padding: '0 2px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '.cm-ooam-tag-character': {
    backgroundColor: '#eaf4ff',
    color: '#245b8f',
  },
  '.cm-ooam-tag-location': {
    backgroundColor: '#edf8f0',
    color: '#276738',
  },
  '.cm-ooam-tag-object': {
    backgroundColor: '#fff3dc',
    color: '#855b14',
  },
  '.cm-ooam-tag-event': {
    backgroundColor: '#fff0f0',
    color: '#9f2f2f',
  },
  '.cm-ooam-tag-timeline': {
    backgroundColor: '#f0edff',
    color: '#5546a0',
  },
  '.cm-ooam-tag-draft': {
    borderBottom: '2px solid #325b8c',
    backgroundColor: '#f4f8ff',
  },
  '.cm-tooltip-autocomplete': {
    border: '1px solid #b7c4d6',
    borderRadius: '6px',
    boxShadow: '0 10px 28px rgba(16, 24, 40, 0.16)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: '#e7f0fa',
    color: '#182230',
  },
})
