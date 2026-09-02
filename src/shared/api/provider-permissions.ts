import type { ProviderConfig } from '../types'

export function getProviderOriginPattern(provider: ProviderConfig): string {
  const endpoint = provider.endpoint?.trim() || provider.baseUrl
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Provider 只支持 HTTP 或 HTTPS 地址')
  }
  return `${url.origin}/*`
}

export function ensureProviderHostPermission(provider: ProviderConfig): Promise<boolean> {
  const origin = getProviderOriginPattern(provider)
  return chrome.permissions.request({ origins: [origin] })
}

export function requestHostPermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [origin] })
}
