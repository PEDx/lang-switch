import { strToU8, zipSync } from 'fflate'
import type { DownloadedMedia } from './media-downloader'
import { ExportError } from './export-types'
import { sanitizeArchivePath, validateUserFilename } from './filename-generator'

export function buildExportZip(input: {
  markdown: string
  markdownFilename: string
  media: DownloadedMedia[]
}): Uint8Array {
  try {
    const markdownBase = validateUserFilename(input.markdownFilename)
    const files: Record<string, Uint8Array> = {
      [`${markdownBase}.md`]: strToU8(input.markdown),
      'media/': new Uint8Array(),
    }
    for (const item of input.media) {
      const path = sanitizeArchivePath(item.localPath)
      if (!path.startsWith('media/')) throw new ExportError('ZIP_BUILD_FAILED', '媒体 ZIP 路径无效')
      files[path] = item.data
    }
    return zipSync(files, { level: 0 })
  } catch (error) {
    if (error instanceof ExportError) throw error
    throw new ExportError('ZIP_BUILD_FAILED', error instanceof Error ? error.message : 'ZIP 生成失败')
  }
}
