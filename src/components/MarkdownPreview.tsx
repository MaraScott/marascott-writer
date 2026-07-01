import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewProps {
  value: string
}

export function MarkdownPreview({ value }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || '_No content to preview._'}</ReactMarkdown>
    </div>
  )
}
