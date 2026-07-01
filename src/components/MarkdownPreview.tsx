import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewProps {
  value: string
}

export function MarkdownPreview({ value }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {value || '_No content to preview._'}
      </ReactMarkdown>
    </div>
  )
}

const markdownComponents: Components = {
  a({ href, children, node: _node, ...props }) {
    if (href?.startsWith('ooam://')) {
      return <span>{children}</span>
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}
