import type { ReactElement } from 'react'

export interface TagSuggestion {
  kind: 'character' | 'location' | 'object' | 'event' | 'timeline'
  id: string
  label: string
  detail?: string
}

export interface MarkdownEditorProps {
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

export declare function MarkdownEditor(props: MarkdownEditorProps): ReactElement
