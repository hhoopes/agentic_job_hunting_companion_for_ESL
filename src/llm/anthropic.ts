/**
 * Anthropic Claude LLM Client
 * Works with Anthropic API and any proxy serving Anthropic-compatible endpoints.
 */

import { LLMClient, LLMCompletionOptions, LLMCompletionResult } from './types.js';

export interface AnthropicClientOptions {
  /** API key (or set ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model name (e.g., claude-3-5-sonnet-20241022, claude-3-opus-20240229) */
  model: string;
  /** Base URL (default: https://api.anthropic.com/v1) */
  baseUrl?: string;
  /** Default timeout */
  defaultTimeoutMs?: number;
}

export class AnthropicClient implements LLMClient {
  providerName = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private defaultTimeoutMs: number;

  constructor(options: AnthropicClientOptions) {
    const envKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY;
    this.apiKey = options.apiKey || envKey || '';
    this.model = options.model;
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.defaultTimeoutMs = options.defaultTimeoutMs || 60000;

    if (!this.apiKey) {
      console.warn('Warning: No API key provided for Anthropic client. Set ANTHROPIC_API_KEY or pass apiKey.');
    }
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const url = `${this.baseUrl}/messages`;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    const body = {
      model: this.model,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.1,
      system: options.systemPrompt,
      messages: [
        { role: 'user', content: options.userPrompt },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const text = data.content?.[0]?.text || '';

      return {
        text,
        model: data.model || this.model,
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens || 0,
          completionTokens: data.usage.output_tokens || 0,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}
