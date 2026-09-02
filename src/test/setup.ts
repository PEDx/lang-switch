import { afterEach } from 'vitest'

if (!globalThis.CSS) Object.defineProperty(globalThis, 'CSS', { value: {} })
if (!globalThis.CSS.escape) {
  globalThis.CSS.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

afterEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
})
