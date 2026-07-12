/**
 * OpenAI-Compatible LLM Client
 * Works with OpenAI, Groq, Together, local models via Ollama/vLLM, etc.
 */

import { LLMClient, LLMCompletionOptions, LLMCompletionResult } from './types.js';

export interface OpenAIClientOptions {
  /** API key (or set OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Model name (e.g., gpt-4o, llama-3.1-70b, etc.) */
  model: string;
  /** Base URL for API (default: https://api.openai.com/v1) */
  baseUrl?: string;
  /** Default timeout for requests */
  defaultTimeoutMs?: number;
}

export class OpenAICompatibleClient implements LLMClient {
  providerName = 'openai-compatible';
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private defaultTimeoutMs: number;

  constructor(options: OpenAIClientOptions) {
    const envKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
    this.apiKey = options.apiKey || envKey || '';
    this.model = options.model;
    this.baseUrl = (options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.defaultTimeoutMs = options.defaultTimeoutMs || 60000;

    if (!this.apiKey && !this.baseUrl.includes('localhost') && !this.baseUrl.includes('127.0.0.1')) {
      console.warn('Warning: No API key provided for OpenAI-compatible client. Set OPENAI_API_KEY or pass apiKey.');
    }
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const choice = data.choices?.[0];
      const text = choice?.message?.content || '';

      return {
        text,
        model: data.model || this.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
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
