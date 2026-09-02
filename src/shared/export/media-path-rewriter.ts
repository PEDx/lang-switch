import type {
  ArticleExportOptions,
  ExportMediaResource,
  MediaFailureStrategy,
} from './export-types'
import { mediaPlaceholder } from './media-collector'

export function isMediaEnabled(
  resource: ExportMediaResource,
  options: ArticleExportOptions,
): boolean {
  if (resource.type === 'image') return options.downloadImages
  if (resource.type === 'video') return options.downloadVideos
  if (resource.type === 'audio') return options.downloadAudio
  return options.downloadPosters
}

export function rewriteMediaPaths(input: {
  markdown: string
  resources: ExportMediaResource[]
  localPaths?: Map<string, string>
  failureStrategy: MediaFailureStrategy
}): string {
  let markdown = input.markdown
  for (const resource of input.resources) {
    const localPath = input.localPaths?.get(resource.id)
    const replacement = localPath
      ?? (input.failureStrategy === 'remove-reference' ? '' : resource.resolvedUrl)
    markdown = markdown.split(mediaPlaceholder(resource.id)).join(replacement)
  }
  if (input.failureStrategy === 'remove-reference') {
    markdown = markdown
      .replace(/!\[[^\]]*\]\(\)/g, '')
      .replace(/\[\]\([^)]+\)/g, '')
      .replace(/^\s*<source\s+[^>]*src=""[^>]*>\s*$/gm, '')
      .replace(/\s+poster=""/g, '')
      .replace(/^\s*<(?:video|audio)[^>]*src=""[^>]*><\/(?:video|audio)>\s*$/gm, '')
      .replace(/<(video|audio)([^>]*)>\s*<\/\1>/g, '')
      .replace(/\n{3,}/g, '\n\n')
  }
  return markdown
}
