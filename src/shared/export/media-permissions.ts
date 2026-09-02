import type { ArticleExportOptions, ExportMediaResource } from './export-types'
import { isMediaEnabled } from './media-path-rewriter'

export function getRequiredMediaOrigins(
  resources: ExportMediaResource[],
  options: ArticleExportOptions,
): string[] {
  const origins = new Set<string>()
  for (const resource of resources) {
    if (!isMediaEnabled(resource, options) || resource.resolvedUrl.startsWith('data:')) continue
    try {
      const url = new URL(resource.resolvedUrl)
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(`${url.origin}/*`)
    } catch {
      // Invalid media URLs are filtered during collection and ignored here defensively.
    }
  }
  return [...origins].sort()
}

export async function getMissingMediaOrigins(origins: string[]): Promise<string[]> {
  const results = await Promise.all(origins.map(async (origin) => ({
    origin,
    granted: await chrome.permissions.contains({ origins: [origin] }),
  })))
  return results.filter((result) => !result.granted).map((result) => result.origin)
}
