import type { ReactElement } from 'react'

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  navigationTarget?: {
    lineNumber: number
    token: string
  } | null
}

export declare function MarkdownEditor(props: MarkdownEditorProps): ReactElement
