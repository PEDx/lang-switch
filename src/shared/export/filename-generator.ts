import { ExportError } from './export-types'

export interface ExportFilenameOptions {
  title: string
  hostname: string
  extension: 'md' | 'zip'
  maxLength?: number
  preserveUnicode?: boolean
}

const INVALID_PATH_CHARACTER = /[/\\:*?"<>|]/
const INVALID_PATH_CHARACTER_GLOBAL = /[/\\:*?"<>|]/g
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function sanitizeFilenameBase(
  value: string,
  options: { maxLength?: number; preserveUnicode?: boolean } = {},
): string {
  const preserveUnicode = options.preserveUnicode ?? true
  const normalized = [...value.normalize('NFKC')]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : character
    })
    .join('')
    .replace(INVALID_PATH_CHARACTER_GLOBAL, ' ')
  const characterSafe = preserveUnicode
    ? normalized
    : normalized.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
  let result = characterSafe
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.+$/g, '')
    .toLocaleLowerCase()
  if (RESERVED_WINDOWS_NAME.test(result)) result = `article-${result}`
  const maxLength = Math.max(24, options.maxLength ?? 120)
  result = [...result].slice(0, maxLength).join('').replace(/[-.]+$/g, '')
  return result
}

export function generateExportFilename(options: ExportFilenameOptions): string {
  const fallbackDate = new Date().toISOString().slice(0, 10)
  const base = sanitizeFilenameBase(options.title, options)
    || sanitizeFilenameBase(`${options.hostname}-${fallbackDate}`, options)
    || `article-${fallbackDate}`
  return `${base}.${options.extension}`
}

export function validateUserFilename(value: string): string {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (INVALID_PATH_CHARACTER.test(value) || hasControl || value.includes('..')) {
    throw new ExportError('INVALID_FILENAME', '文件名不能包含路径、控制字符或 ..')
  }
  const withoutExtension = value.replace(/\.(?:md|zip)$/i, '')
  const result = sanitizeFilenameBase(withoutExtension, { preserveUnicode: true })
  if (!result) throw new ExportError('INVALID_FILENAME', '请输入有效文件名')
  return result
}

export function sanitizeArchivePath(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => sanitizeFilenameBase(part, { preserveUnicode: true, maxLength: 120 }))
    .filter(Boolean)
  if (parts.length === 0) throw new ExportError('INVALID_FILENAME', 'ZIP 路径无效')
  return parts.join('/')
}
