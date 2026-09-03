import type {
  ProviderConfig,
  TranslationStage,
  UserSettings,
} from '../types'

export interface ResolvedTranslationProviders {
  primary: ProviderConfig
  analysis: ProviderConfig
  initial: ProviderConfig
  review: ProviderConfig
  refinement: ProviderConfig
}

const STAGES: TranslationStage[] = ['analysis', 'initial', 'review', 'refinement']

/** Resolve deleted or missing stage overrides back to the selected primary Provider. */
export function resolveTranslationProviders(
  providers: ProviderConfig[],
  settings: Pick<UserSettings, 'primaryProviderId' | 'defaultProviderId' | 'translationStageProviderIds'>,
  preferredPrimaryId?: string,
): ResolvedTranslationProviders | null {
  const primaryId = preferredPrimaryId ?? settings.primaryProviderId ?? settings.defaultProviderId
  const primary = providers.find((provider) => provider.id === primaryId) ?? providers[0]
  if (!primary) return null

  const resolved = Object.fromEntries(STAGES.map((stage) => {
    const overrideId = settings.translationStageProviderIds?.[stage]
    return [stage, providers.find((provider) => provider.id === overrideId) ?? primary]
  })) as Record<TranslationStage, ProviderConfig>

  return { primary, ...resolved }
}

export function uniqueTranslationProviders(
  resolved: ResolvedTranslationProviders,
): ProviderConfig[] {
  return [...new Map(
    [resolved.primary, resolved.analysis, resolved.initial, resolved.review, resolved.refinement]
      .map((provider) => [provider.id, provider]),
  ).values()]
}
