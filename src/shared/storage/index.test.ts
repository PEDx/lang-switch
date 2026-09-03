import { getSettings, saveSettings, STORAGE_KEYS } from './index'

describe('settings migration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the legacy default Provider as the primary Provider', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn().mockResolvedValue({
        [STORAGE_KEYS.settings]: { defaultProviderId: 'legacy-provider' },
      }) } },
    })

    await expect(getSettings()).resolves.toMatchObject({
      primaryProviderId: 'legacy-provider',
    })
  })

  it('does not persist the deprecated setting after a save', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}), set } } })

    await saveSettings({
      ...(await getSettings()),
      primaryProviderId: 'primary',
      defaultProviderId: 'legacy',
    })

    expect(set).toHaveBeenCalledOnce()
    expect(set.mock.calls[0][0][STORAGE_KEYS.settings]).not.toHaveProperty('defaultProviderId')
  })
})
