import { useEffect, useMemo, useRef } from 'react'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
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
import { EditorState, Prec } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  navigationTarget?: {
    lineNumber: number
    token: string
  } | null
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  readOnly = false,
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
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString())
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
    [readOnly],
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
})
