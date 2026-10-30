// Loose article text has no element of its own. Keep discovery read-only;
// wrappers are created only when a translation is written back to the page.
export const SOURCE_WRAPPER_SELECTOR = '[data-ai-reader-source-wrapper]'
export const TEXT_CONTAINER_SELECTOR = 'div,article,main,section,[role="main"],[role="article"]'
export const SEMANTIC_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,dt,dd'
export const IGNORED_SELECTOR =
  'script,style,noscript,template,textarea,input,select,option,button,svg,canvas,video,audio,code,pre,kbd,samp,[aria-hidden="true"],[data-ai-reader-inserted]'
export const TEXT_BOUNDARY_SELECTOR = `${SEMANTIC_SELECTOR},${TEXT_CONTAINER_SELECTOR},br,figure,picture,img,iframe,video,audio,svg,canvas,pre,hr,ul,ol,table,header,footer,nav,aside,form,details`

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function extractNodesText(nodes: Node[]): string {
  return normalizeText(nodes.map((node) => {
    const clone = node.cloneNode(true)
    if (clone instanceof Element) {
      if (clone.matches(IGNORED_SELECTOR)) return ''
      clone.querySelectorAll(IGNORED_SELECTOR).forEach((ignored) => ignored.remove())
    }
    return clone.textContent ?? ''
  }).join(''))
}

export function isMeaningfulText(text: string): boolean {
  return text.length >= 2
    && !/^[\d\s.,:%+\-–—/()]+$/.test(text)
    && !/^(https?:\/\/|www\.)\S+$/i.test(text)
    && !/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text)
}

export interface TextRun {
  nodes: Node[]
  text: string
}

export function getTextRuns(container: HTMLElement): TextRun[] {
  const runs: TextRun[] = []
  let nodes: Node[] = []
  const flush = () => {
    const text = extractNodesText(nodes)
    if (isMeaningfulText(text)) runs.push({ nodes, text })
    nodes = []
  }
  const visit = (node: Node) => {
    if (node instanceof Element) {
      // Rendering must not change run indices or split an existing run.
      if (node.matches('[data-ai-reader-inserted]')) return
      if (node.matches(SOURCE_WRAPPER_SELECTOR)) {
        node.childNodes.forEach(visit)
        return
      }
      if (node.matches(IGNORED_SELECTOR)) {
        flush()
        return
      }
      if (node.matches(TEXT_BOUNDARY_SELECTOR) || node.querySelector(TEXT_BOUNDARY_SELECTOR)) {
        flush()
        return
      }
      if (node instanceof HTMLElement) {
        const style = window.getComputedStyle(node)
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          flush()
          return
        }
      }
    } else if (node.nodeType !== Node.TEXT_NODE) {
      return
    }
    nodes.push(node)
  }
  container.childNodes.forEach(visit)
  flush()
  return runs
}
