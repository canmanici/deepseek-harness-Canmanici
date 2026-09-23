/** pi-ai model helpers assembled from public narrow entry points. */

import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type {
  Api,
  CreateModelsOptions,
  Model,
  ModelThinkingLevel,
  MutableModels,
  Provider,
  ProviderAuth,
  ProviderStreams,
} from '@earendil-works/pi-ai'
import { THINKING_LEVELS } from './catalog.ts'

/** Input accepted by the static providers this package builds. */
interface StaticProviderOptions {
  id: string
  name: string
  baseUrl?: string
  auth: ProviderAuth
  models: readonly Model<Api>[]
  /**
   * Protocol implementations keyed by `model.api`. A route may serve several
   * wire formats, and the model record is what says which one reaches it, so
   * dispatch reads that field; a model whose api has no entry fails its stream
   * rather than being sent through another protocol's implementation.
   */
  api: Readonly<Record<string, ProviderStreams>>
}

/**
 * Create an empty pi-ai collection without importing its aggregate entry point.
 * @param options - credential storage and ambient authentication integrations.
 * @returns a mutable collection with no registered providers.
 */
export function createModels(options?: CreateModelsOptions): MutableModels {
  const models = builtinModels(options)
  models.clearProviders()
  return models
}

/**
 * Create the static provider used by configured routes.
 * @param input - provider identity, models, authentication, and protocol implementations.
 * @returns a provider that delegates each operation to the protocol its model names.
 */
export function createProvider(input: StaticProviderOptions): Provider {
  const implementation = (model: Model<Api>): ProviderStreams => {
    const streams = input.api[model.api]
    if (streams === undefined) {
      throw new Error(`provider ${input.id} has no API implementation for "${model.api}"`)
    }
    return streams
  }
  return {
    id: input.id,
    name: input.name,
    ...input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl },
    auth: input.auth,
    getModels: () => input.models,
    stream: (model, context, options) => implementation(model).stream(model, context, options),
    streamSimple: (model, context, options) => implementation(model).streamSimple(model, context, options),
  }
}

/**
 * Resolve selectable reasoning levels from pi-ai's public model metadata.
 * @param model - model descriptor carrying reasoning support and wire mappings.
 * @returns supported levels in pi-ai's escalation order.
 */
export function getSupportedThinkingLevels(model: Model<Api>): ModelThinkingLevel[] {
  if (!model.reasoning) return ['off']
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}
