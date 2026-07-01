import { TextInput, View } from 'react-native'

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

export function MarkdownEditor({ value, onChange, readOnly = false }: MarkdownEditorProps) {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={!readOnly}
        multiline
        textAlignVertical="top"
        autoCapitalize="sentences"
        autoCorrect
        spellCheck
        style={{
          flex: 1,
          minHeight: 0,
          padding: 16,
          backgroundColor: '#fbfdff',
          color: '#182230',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 20,
        }}
      />
    </View>
  )
}
