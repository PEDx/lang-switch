import { unzipSync } from 'fflate'
import { DEFAULT_EXPORT_OPTIONS } from './export-types'
import { generateExportFilename, sanitizeArchivePath, validateUserFilename } from './filename-generator'
import { MediaCollector, normalizeExportUrl, normalizePageLink } from './media-collector'
import { downloadMediaResources, extensionForMedia } from './media-downloader'
import { rewriteMediaPaths } from './media-path-rewriter'
import { buildExportZip } from './zip-builder'
import { getRequiredMediaOrigins } from './media-permissions'

describe('export media utilities', () => {
  it('normalizes safe URLs, preserves anchors, rejects unsupported protocols, and deduplicates', () => {
    expect(normalizePageLink('../guide', 'https://example.com/docs/page')).toBe('https://example.com/guide')
    expect(normalizePageLink('#summary', 'https://example.com')).toBe('#summary')
    expect(normalizePageLink('../guide#part', 'https://example.com/docs/page')).toBe('https://example.com/guide#part')
    expect(normalizeExportUrl('javascript:alert(1)', 'https://example.com')).toBeNull()
    expect(normalizeExportUrl('blob:https://example.com/a', 'https://example.com')).toBeNull()
    const collector = new MediaCollector('https://example.com/post')
    const first = collector.add({ type: 'image', url: '/image.png' })
    const second = collector.add({ type: 'image', url: 'https://example.com/image.png' })
    expect(first?.id).toBe(second?.id)
    expect(collector.list()).toHaveLength(1)
    expect(getRequiredMediaOrigins([
      first!,
      { id: 'video', type: 'video', originalUrl: 'v', resolvedUrl: 'https://video.test/a.mp4' },
      { id: 'audio', type: 'audio', originalUrl: 'a', resolvedUrl: 'https://audio.test/a.mp3' },
    ], DEFAULT_EXPORT_OPTIONS)).toEqual(['https://example.com/*', 'https://video.test/*'])
  })

  it('generates safe filenames and MIME-correct extensions', () => {
    expect(generateExportFilename({ title: 'Understanding React / Components', hostname: 'example.com', extension: 'md' })).toBe('understanding-react-components.md')
    expect(() => validateUserFilename('../secret')).toThrow('文件名')
    expect(sanitizeArchivePath('../media/../image.png')).toBe('media/image.png')
    expect(extensionForMedia({ id: 'm', type: 'image', originalUrl: 'a', resolvedUrl: 'https://x.test/file.bin' }, 'image/webp')).toBe('webp')
  })

  it('downloads image and video concurrently while isolating a failed resource', async () => {
    const resources = [
      { id: 'image', type: 'image' as const, originalUrl: '/a.png', resolvedUrl: 'https://cdn.test/a.png', suggestedFilename: 'image-001.png' },
      { id: 'video', type: 'video' as const, originalUrl: '/a.mp4', resolvedUrl: 'https://cdn.test/a.mp4', suggestedFilename: 'video-001.mp4' },
      { id: 'poster', type: 'poster' as const, originalUrl: '/missing.jpg', resolvedUrl: 'https://cdn.test/missing.jpg', suggestedFilename: 'poster-001.jpg' },
    ]
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.includes('missing')) return new Response('no', { status: 404 })
      const type = value.endsWith('.mp4') ? 'video/mp4' : 'image/png'
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': type, 'content-length': '3' } })
    }) as typeof fetch
    const result = await downloadMediaResources({
      resources,
      options: { ...DEFAULT_EXPORT_OPTIONS, mediaMode: 'local', downloadPosters: true, filename: 'article' },
      signal: new AbortController().signal,
      fetcher,
    })
    expect(result.downloaded).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    expect(result.downloadedBytes).toBe(6)
  })

  it('isolates media that exceeds the configured single-file limit', async () => {
    const result = await downloadMediaResources({
      resources: [{ id: 'large', type: 'image', originalUrl: '/large.png', resolvedUrl: 'https://cdn.test/large.png' }],
      options: {
        ...DEFAULT_EXPORT_OPTIONS,
        mediaMode: 'local',
        filename: 'article',
        limits: { ...DEFAULT_EXPORT_OPTIONS.limits, maxSingleFileBytes: 2 },
      },
      signal: new AbortController().signal,
      fetcher: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })) as typeof fetch,
    })
    expect(result.downloaded).toHaveLength(0)
    expect(result.failed[0].error).toContain('大小限制')
  })

  it('rewrites successful paths, keeps failed remote URLs, and creates a safe binary ZIP', () => {
    const resources = [
      { id: 'image', type: 'image' as const, originalUrl: '/a.png', resolvedUrl: 'https://cdn.test/a.png' },
      { id: 'video', type: 'video' as const, originalUrl: '/a.mp4', resolvedUrl: 'https://cdn.test/a.mp4' },
    ]
    const markdown = '![A]({{AI_READER_MEDIA:image}})\n\n<video controls src="{{AI_READER_MEDIA:video}}"></video>'
    const rewritten = rewriteMediaPaths({
      markdown, resources, localPaths: new Map([['image', 'media/image-001.png']]),
      failureStrategy: 'keep-remote-url',
    })
    expect(rewritten).toContain('media/image-001.png')
    expect(rewritten).toContain('https://cdn.test/a.mp4')

    const bytes = new Uint8Array([0, 255, 4, 8])
    const zip = buildExportZip({
      markdown: rewritten,
      markdownFilename: 'article',
      media: [{ resource: { ...resources[0], localPath: 'media/image-001.png' }, data: bytes, localPath: 'media/image-001.png' }],
    })
    const files = unzipSync(zip)
    expect(new TextDecoder().decode(files['article.md'])).toContain('media/image-001.png')
    expect(files['media/image-001.png']).toEqual(bytes)
    expect(files).toHaveProperty('media/')
    expect(Object.keys(files).some((path) => path.includes('..'))).toBe(false)

    const removed = rewriteMediaPaths({
      markdown: '![Missing]({{AI_READER_MEDIA:image}})',
      resources,
      localPaths: new Map(),
      failureStrategy: 'remove-reference',
    })
    expect(removed).not.toContain('Missing')
  })
})
