export function observeArticleMutations(
  root: HTMLElement,
  onMeaningfulChange: () => void,
  debounceMs = 500,
): () => void {
  let timeout: number | undefined
  const observer = new MutationObserver((mutations) => {
    const meaningful = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof HTMLElement &&
          !node.matches('[data-ai-reader-inserted]') &&
          !node.closest('[data-ai-reader-inserted]'),
      ),
    )
    if (!meaningful) return
    window.clearTimeout(timeout)
    timeout = window.setTimeout(onMeaningfulChange, debounceMs)
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => {
    window.clearTimeout(timeout)
    observer.disconnect()
  }
}
