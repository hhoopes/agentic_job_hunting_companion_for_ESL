/**
 * Job Hunting Companion
 * A plugin-based system for extracting structured job seeker information
 * 
 * Usage:
 * ```typescript
 * import { JobHuntingCompanion } from 'job-hunting-companion';
 * 
 * const companion = new JobHuntingCompanion();
 * const handoff = await companion.extractFromConversation(conversationText);
 * ```
 */

// Core types
export * from './types/index.js';

// Schemas - exported under a namespace to avoid conflicts with types
export * as schemas from './schemas/index.js';

// Core engine
export {
  PluginRegistryImpl,
  OrchestratorImpl,
  createDefaultRegistry,
  createOrchestrator,
} from './core/index.js';

// LLM clients
export {
  LLMClient,
  LLMCompletionOptions,
  LLMCompletionResult,
  LLMUsage,
  probeLanguageSupport,
} from './llm/types.js';
export {
  OpenAICompatibleClient,
  OpenAIClientOptions,
} from './llm/openai.js';
export {
  AnthropicClient,
  AnthropicClientOptions,
} from './llm/anthropic.js';

// Plugins
export {
  registerAllPlugins,
  DemographicsExtractor,
  ExperienceExtractor,
  TransportationExtractor,
  PreferencesExtractor,
} from './plugins/index.js';

// Convenience class
import {
  PluginRegistry,
  Orchestrator,
  ExtractionConfig,
  HandoffPackage,
  JobSeekerProfile,
  ProfileGap,
} from './types/index.js';
import { LLMClient } from './llm/types.js';
import { registerAllPlugins } from './plugins/index.js';
import { createOrchestrator } from './core/index.js';

export class JobHuntingCompanion {
  private registry: PluginRegistry;
  private orchestrator: Orchestrator;

  constructor(registry?: PluginRegistry, llmClient?: LLMClient) {
    this.registry = registry || registerAllPlugins();
    this.orchestrator = createOrchestrator(this.registry, llmClient);
  }

  /**
   * Extract a complete profile from conversation text or structured input
   */
  async extractFromConversation(
    text: string,
    config?: Partial<ExtractionConfig>
  ): Promise<HandoffPackage> {
    const fullConfig: ExtractionConfig = {
      language: 'en',
      includeConfidence: true,
      flagAmbiguity: true,
      maxDepth: 3,
      timeoutMs: 30000,
      ...config,
    };

    return this.orchestrator.autoDetect(text, fullConfig);
  }

  /**
   * Run specific extractors
   */
  async extractWithPlugins(
    text: string,
    pluginIds: string[],
    config?: Partial<ExtractionConfig>
  ): Promise<HandoffPackage> {
    const fullConfig: ExtractionConfig = {
      language: 'en',
      includeConfidence: true,
      flagAmbiguity: true,
      maxDepth: 3,
      timeoutMs: 30000,
      ...config,
    };

    return this.orchestrator.runPipeline(pluginIds, text, fullConfig);
  }

  /**
   * Get gaps from existing extractions
   */
  identifyGaps(extractions: Record<string, any>): ProfileGap[] {
    return this.orchestrator.identifyGaps(extractions);
  }

  /**
   * Generate follow-up questions
   */
  generateFollowUps(gaps: ProfileGap[]): string[] {
    return this.orchestrator.generateFollowUps(gaps);
  }

  /**
   * Get all registered plugins
   */
  getPlugins() {
    return this.registry.list();
  }

  /**
   * Get a specific plugin
   */
  getPlugin(id: string) {
    return this.registry.get(id);
  }
}

export default JobHuntingCompanion;
