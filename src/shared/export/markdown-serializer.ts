import type { SemanticSegment } from '../types'
import type { ExportBlock, ExportTemplateToken } from './export-types'
import {
  MediaCollector,
  mediaPlaceholder,
  normalizePageLink,
  selectImageUrl,
} from './media-collector'

const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'button', 'input', 'textarea', 'select',
  'nav', 'footer', 'form', 'dialog', '[aria-hidden="true"]', '[data-ai-reader-inserted]',
].join(',')
const UNRELATED_PATTERN = /(?:^|[-_])(comment|comments|recommend|related|advert|ads|sidebar|navigation)(?:[-_]|$)/i

interface InlineResult {
  markdown: string
  mediaIds: string[]
}

interface SerializerContext {
  baseUrl: string
  collector: MediaCollector
  segmentByElement: Map<Element, SemanticSegment>
  nextBlockId: number
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]<>])/g, '\\$1')
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ')
}

function wrapInlineCode(value: string): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  const padding = /^\s|\s$|^`|`$/.test(value) ? ' ' : ''
  return `${fence}${padding}${value}${padding}${fence}`
}

function formatDestination(url: string): string {
  return url.replace(/ /g, '%20').replace(/\)/g, '%29')
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function elementIdentity(element: Element): string {
  return `${element.id} ${element.className}`
}

function shouldSkip(element: Element): boolean {
  return element.matches(SKIP_SELECTOR) || UNRELATED_PATTERN.test(elementIdentity(element))
}

function serializeImage(image: HTMLImageElement, context: SerializerContext): InlineResult {
  const figureCaption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
  const alt = image.getAttribute('alt')?.trim() || figureCaption || ''
  const resource = context.collector.add({
    type: 'image',
    url: selectImageUrl(image),
    sourceElementPath: image.id ? `#${image.id}` : undefined,
  })
  if (!resource) return { markdown: '', mediaIds: [] }
  return {
    markdown: `![${escapeMarkdownText(alt).replace(/\]/g, '\\]')}](${mediaPlaceholder(resource.id)})`,
    mediaIds: [resource.id],
  }
}

function serializeInline(node: Node, context: SerializerContext): InlineResult {
  if (node.nodeType === Node.TEXT_NODE) {
    return { markdown: escapeMarkdownText(normalizeInlineWhitespace(node.textContent ?? '')), mediaIds: [] }
  }
  if (!(node instanceof Element) || shouldSkip(node)) return { markdown: '', mediaIds: [] }
  const tag = node.tagName.toLowerCase()
  if (tag === 'img') return serializeImage(node as HTMLImageElement, context)
  if (tag === 'picture') {
    const image = node.querySelector('img')
    return image ? serializeImage(image, context) : { markdown: '', mediaIds: [] }
  }
  if (tag === 'br') return { markdown: '  \n', mediaIds: [] }
  if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
    return { markdown: wrapInlineCode(node.textContent ?? ''), mediaIds: [] }
  }

  const children = [...node.childNodes].map((child) => serializeInline(child, context))
  const markdown = children.map((child) => child.markdown).join('')
  const mediaIds = unique(children.flatMap((child) => child.mediaIds))
  if (tag === 'strong' || tag === 'b') return { markdown: `**${markdown.trim()}**`, mediaIds }
  if (tag === 'em' || tag === 'i') return { markdown: `*${markdown.trim()}*`, mediaIds }
  if (tag === 'del' || tag === 's') return { markdown: `~~${markdown.trim()}~~`, mediaIds }
  if (tag === 'a') {
    const href = normalizePageLink(node.getAttribute('href'), context.baseUrl)
    if (!href) return { markdown, mediaIds }
    return { markdown: `[${markdown.trim() || href}](${formatDestination(href)})`, mediaIds }
  }
  if (tag === 'math' || node.matches('.katex,.MathJax')) {
    const tex = node.getAttribute('data-tex')
      || node.querySelector('annotation[encoding="application/x-tex"]')?.textContent
      || node.getAttribute('aria-label')
    return { markdown: tex ? `$${tex.trim()}$` : markdown, mediaIds }
  }
  return { markdown, mediaIds }
}

function serializeInlineChildren(element: Element, context: SerializerContext): InlineResult {
  const children = [...element.childNodes].map((node) => serializeInline(node, context))
  return {
    markdown: children.map((child) => child.markdown).join('').trim(),
    mediaIds: unique(children.flatMap((child) => child.mediaIds)),
  }
}

function segmentTemplate(
  segment: SemanticSegment | undefined,
  before = '',
  after = '',
  linePrefix?: string,
): ExportTemplateToken[] | undefined {
  if (!segment) return undefined
  return [
    ...(before ? [{ type: 'text' as const, value: before }] : []),
    { type: 'segment' as const, segmentId: segment.id, linePrefix },
    ...(after ? [{ type: 'text' as const, value: after }] : []),
  ]
}

function createBlock(
  context: SerializerContext,
  input: Omit<ExportBlock, 'id'>,
): ExportBlock {
  context.nextBlockId += 1
  return { id: `export-block-${context.nextBlockId}`, ...input }
}

function serializeCodeBlock(pre: Element, context: SerializerContext): ExportBlock {
  const code = pre.querySelector('code') ?? pre
  const className = `${pre.className} ${code.className}`
  const language = /(?:language|lang)-([a-z0-9_+-]+)/i.exec(className)?.[1] ?? ''
  const value = (code.textContent ?? '').replace(/^\n|\n$/g, '')
  const longest = Math.max(2, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return createBlock(context, {
    type: 'code',
    sourceMarkdown: `${fence}${language}\n${value}\n${fence}`,
    segmentIds: [],
    mediaIds: [],
  })
}

function serializeList(list: Element, context: SerializerContext, depth = 0): ExportBlock[] {
  const ordered = list.tagName.toLowerCase() === 'ol'
  const start = Number(list.getAttribute('start') ?? 1)
  const items = [...list.children].filter((child) => child.tagName.toLowerCase() === 'li')
  const blocks: ExportBlock[] = []
  items.forEach((item, index) => {
    const inlineNodes = [...item.childNodes].filter((node) =>
      !(node instanceof Element && ['ul', 'ol', 'pre'].includes(node.tagName.toLowerCase())),
    )
    const inline = inlineNodes.map((node) => serializeInline(node, context))
    const content = inline.map((part) => part.markdown).join('').trim()
    const marker = ordered ? `${start + index}. ` : '- '
    const prefix = `${'  '.repeat(depth)}${marker}`
    const segment = context.segmentByElement.get(item)
    blocks.push(createBlock(context, {
      type: 'list-item',
      sourceMarkdown: `${prefix}${content}`,
      segmentIds: segment ? [segment.id] : [],
      translationTemplate: segmentTemplate(segment, prefix),
      mediaIds: unique(inline.flatMap((part) => part.mediaIds)),
    }))
    for (const codeElement of [...item.children].filter((child) => child.tagName.toLowerCase() === 'pre')) {
      const codeBlock = serializeCodeBlock(codeElement, context)
      const indentation = '  '.repeat(depth + 1)
      blocks.push({
        ...codeBlock,
        sourceMarkdown: codeBlock.sourceMarkdown.split('\n').map((line) => `${indentation}${line}`).join('\n'),
      })
    }
    for (const nested of [...item.children].filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))) {
      blocks.push(...serializeList(nested, context, depth + 1))
    }
  })
  return blocks
}

function serializeTable(table: HTMLTableElement, context: SerializerContext): ExportBlock {
  const rows = [...table.querySelectorAll('tr')]
  const complex = Boolean(table.querySelector('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])'))
  if (complex || rows.length === 0) {
    const body = rows.map((row) => `<tr>${[...row.cells].map((cell) => `<${cell.tagName.toLowerCase()}>${escapeHtmlText(cell.textContent ?? '')}</${cell.tagName.toLowerCase()}>`).join('')}</tr>`).join('\n')
    return createBlock(context, {
      type: 'html', sourceMarkdown: `<table>\n${body}\n</table>`, segmentIds: [], mediaIds: [],
    })
  }

  const columnCount = Math.max(...rows.map((row) => row.cells.length))
  const sourceLines: string[] = []
  const tokens: ExportTemplateToken[] = []
  const segmentIds: string[] = []
  const mediaIds: string[] = []
  rows.forEach((row, rowIndex) => {
    const cells = [...row.cells]
    sourceLines.push(`| ${Array.from({ length: columnCount }, (_, index) => serializeInlineChildren(cells[index] ?? document.createElement('td'), context).markdown.replace(/\|/g, '\\|')).join(' | ')} |`)
    tokens.push({ type: 'text', value: '| ' })
    for (let index = 0; index < columnCount; index += 1) {
      const cell = cells[index]
      const segment = cell ? context.segmentByElement.get(cell) : undefined
      if (segment) {
        segmentIds.push(segment.id)
        tokens.push({ type: 'segment', segmentId: segment.id })
      } else {
        tokens.push({ type: 'text', value: cell ? serializeInlineChildren(cell, context).markdown : '' })
      }
      tokens.push({ type: 'text', value: index === columnCount - 1 ? ' |\n' : ' | ' })
      if (cell) mediaIds.push(...serializeInlineChildren(cell, context).mediaIds)
    }
    if (rowIndex === 0) {
      const separator = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`
      sourceLines.push(separator)
      tokens.push({ type: 'text', value: `${separator}\n` })
    }
  })
  return createBlock(context, {
    type: 'table',
    sourceMarkdown: sourceLines.join('\n'),
    segmentIds: unique(segmentIds),
    translationTemplate: segmentIds.length > 0 ? tokens : undefined,
    mediaIds: unique(mediaIds),
  })
}

function serializeVideo(element: HTMLVideoElement, context: SerializerContext): ExportBlock | null {
  const mediaIds: string[] = []
  const poster = context.collector.add({ type: 'poster', url: element.getAttribute('poster') })
  if (poster) mediaIds.push(poster.id)
  const direct = context.collector.add({
    type: 'video', url: element.getAttribute('src'), mimeType: element.getAttribute('type') ?? undefined,
  })
  if (direct) mediaIds.push(direct.id)
  const sources = [...element.querySelectorAll('source[src]')].map((source) => context.collector.add({
    type: 'video', url: source.getAttribute('src'), mimeType: source.getAttribute('type') ?? undefined,
  })).filter(Boolean)
  mediaIds.push(...sources.map((resource) => resource!.id))
  if (!direct && sources.length === 0) return null
  const posterAttribute = poster ? ` poster="${mediaPlaceholder(poster.id)}"` : ''
  const sourceAttribute = direct ? ` src="${mediaPlaceholder(direct.id)}"` : ''
  const markdown = sources.length > 0
    ? `<video controls${posterAttribute}>\n${sources.map((resource) => `  <source src="${mediaPlaceholder(resource!.id)}"${resource!.mimeType ? ` type="${escapeHtmlAttribute(resource!.mimeType)}"` : ''}>`).join('\n')}\n</video>`
    : `<video controls${posterAttribute}${sourceAttribute}></video>`
  return createBlock(context, { type: 'media', sourceMarkdown: markdown, segmentIds: [], mediaIds: unique(mediaIds) })
}

function serializeAudio(element: HTMLAudioElement, context: SerializerContext): ExportBlock | null {
  const direct = context.collector.add({
    type: 'audio', url: element.getAttribute('src'), mimeType: element.getAttribute('type') ?? undefined,
  })
  const sources = [...element.querySelectorAll('source[src]')].map((source) => context.collector.add({
    type: 'audio', url: source.getAttribute('src'), mimeType: source.getAttribute('type') ?? undefined,
  })).filter(Boolean)
  const resources = direct ? [direct, ...sources] : sources
  if (resources.length === 0) return null
  const markdown = sources.length > 0
    ? `<audio controls>\n${sources.map((resource) => `  <source src="${mediaPlaceholder(resource!.id)}"${resource!.mimeType ? ` type="${escapeHtmlAttribute(resource!.mimeType)}"` : ''}>`).join('\n')}\n</audio>`
    : `<audio controls src="${mediaPlaceholder(direct!.id)}"></audio>`
  return createBlock(context, { type: 'media', sourceMarkdown: markdown, segmentIds: [], mediaIds: resources.map((resource) => resource!.id) })
}

function serializeFigure(figure: HTMLElement, context: SerializerContext): ExportBlock | null {
  const images = [...figure.querySelectorAll('img')].map((image) => serializeImage(image, context))
  const caption = figure.querySelector('figcaption')
  const captionInline = caption ? serializeInlineChildren(caption, context) : null
  const parts = images.map((image) => image.markdown).filter(Boolean)
  if (captionInline?.markdown) parts.push(`*${captionInline.markdown}*`)
  if (parts.length === 0) return null
  const segment = caption ? context.segmentByElement.get(caption) : undefined
  const template: ExportTemplateToken[] = images.flatMap((image, index) => [
    { type: 'text' as const, value: `${index ? '\n\n' : ''}${image.markdown}` },
  ])
  if (segment) {
    template.push({ type: 'text', value: '\n\n*' }, { type: 'segment', segmentId: segment.id }, { type: 'text', value: '*' })
  }
  return createBlock(context, {
    type: 'figure',
    sourceMarkdown: parts.join('\n\n'),
    segmentIds: segment ? [segment.id] : [],
    translationTemplate: segment ? template : undefined,
    mediaIds: unique([...images.flatMap((image) => image.mediaIds), ...(captionInline?.mediaIds ?? [])]),
  })
}

function serializeElement(element: HTMLElement, context: SerializerContext): ExportBlock[] {
  if (shouldSkip(element)) return []
  const tag = element.tagName.toLowerCase()
  const segment = context.segmentByElement.get(element)
  const inline = () => serializeInlineChildren(element, context)
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    const content = inline()
    return [createBlock(context, {
      type: 'heading', sourceMarkdown: `${'#'.repeat(level)} ${content.markdown}`,
      segmentIds: segment ? [segment.id] : [], translationTemplate: segmentTemplate(segment, `${'#'.repeat(level)} `),
      mediaIds: content.mediaIds,
    })]
  }
  if (tag === 'p' || tag === 'figcaption') {
    const content = inline()
    if (!content.markdown) return []
    return [createBlock(context, {
      type: 'paragraph', sourceMarkdown: content.markdown,
      segmentIds: segment ? [segment.id] : [], translationTemplate: segmentTemplate(segment), mediaIds: content.mediaIds,
    })]
  }
  if (tag === 'ul' || tag === 'ol') return serializeList(element, context)
  if (tag === 'blockquote') {
    const content = inline()
    const quoted = content.markdown.split('\n').map((line) => `> ${line}`).join('\n')
    return [createBlock(context, {
      type: 'quote', sourceMarkdown: quoted,
      segmentIds: segment ? [segment.id] : [], translationTemplate: segmentTemplate(segment, '', '', '> '), mediaIds: content.mediaIds,
    })]
  }
  if (tag === 'pre') return [serializeCodeBlock(element, context)]
  if (tag === 'table') return [serializeTable(element as HTMLTableElement, context)]
  if (tag === 'figure') {
    const block = serializeFigure(element, context)
    return block ? [block] : []
  }
  if (tag === 'img' || tag === 'picture') {
    const content = tag === 'img'
      ? serializeImage(element as HTMLImageElement, context)
      : serializeInline(element, context)
    return content.markdown ? [createBlock(context, {
      type: 'media', sourceMarkdown: content.markdown, segmentIds: [], mediaIds: content.mediaIds,
    })] : []
  }
  if (tag === 'video') {
    const block = serializeVideo(element as HTMLVideoElement, context)
    return block ? [block] : []
  }
  if (tag === 'audio') {
    const block = serializeAudio(element as HTMLAudioElement, context)
    return block ? [block] : []
  }
  if (tag === 'iframe') {
    const src = normalizePageLink(element.getAttribute('src'), context.baseUrl)
    return src ? [createBlock(context, {
      type: 'media', sourceMarkdown: `[查看嵌入视频](${formatDestination(src)})`, segmentIds: [], mediaIds: [],
    })] : []
  }
  if (tag === 'hr') return [createBlock(context, { type: 'horizontal-rule', sourceMarkdown: '---', segmentIds: [], mediaIds: [] })]
  if (tag === 'details') {
    const summary = element.querySelector(':scope > summary')?.textContent?.trim() || 'Details'
    const children = [...element.children]
      .filter((child) => child.tagName.toLowerCase() !== 'summary')
      .flatMap((child) => serializeElement(child as HTMLElement, context))
    const body = children.map((block) => block.sourceMarkdown).join('\n\n')
    return [createBlock(context, {
      type: 'details', sourceMarkdown: `<details>\n<summary>${escapeHtmlText(summary)}</summary>\n\n${body}\n\n</details>`,
      segmentIds: unique(children.flatMap((block) => block.segmentIds)),
      mediaIds: unique(children.flatMap((block) => block.mediaIds)),
    })]
  }
  return [...element.children].flatMap((child) => serializeElement(child as HTMLElement, context))
}

export function serializeArticleToBlocks(input: {
  root: HTMLElement
  segments: SemanticSegment[]
  baseUrl: string
}): { blocks: ExportBlock[]; media: ReturnType<MediaCollector['list']> } {
  const segmentByElement = new Map<Element, SemanticSegment>()
  for (const segment of input.segments) {
    try {
      const element = input.root.ownerDocument.querySelector(segment.elementPath)
      if (element && input.root.contains(element)) segmentByElement.set(element, segment)
    } catch {
      // A stale selector is ignored; remaining article blocks are still exportable.
    }
  }
  const collector = new MediaCollector(input.baseUrl)
  const context: SerializerContext = {
    baseUrl: input.baseUrl,
    collector,
    segmentByElement,
    nextBlockId: 0,
  }
  const blocks = input.root.matches('h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,figure,img,picture,video,audio,iframe,hr,details')
    ? serializeElement(input.root, context)
    : [...input.root.children].flatMap((child) => serializeElement(child as HTMLElement, context))
  return { blocks, media: collector.list() }
}
