/**
 * LLM Extractor Plugin Base Class
 * Implements real LLM-powered extraction using prompt templates.
 * Plugins extend this and just define their metadata, prompts, and schema.
 */

import { z } from 'zod';
import {
  ExtractorPlugin,
  ExtractionResult,
  ExtractionContext,
  PromptTemplate,
  ValidationResult,
  PluginCategory,
} from '../types/index.js';

/**
 * Extract JSON from an LLM response, handling markdown fences and common LLM quirks.
 */
export function extractJSONFromLLMResponse(text: string): object | null {
  const trimmed = text.trim();

  // Try to find JSON inside markdown fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue to next strategy
    }
  }

  // Try the whole text as JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Try to find the first { ... } or [ ... ] block
  const objMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[1].trim());
    } catch {
      // continue
    }
  }

  const arrMatch = trimmed.match(/(\[[\s\S]*\])/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[1].trim());
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Build language-aware instructions to append to system prompts.
 */
function buildLanguageInstruction(language: string): string {
  if (language === 'en' || !language) return '';

  const instructions: Record<string, string> = {
    es: `\n\nImportant: The input conversation may be in Spanish or Spanglish. Extract the information accurately and return JSON with English field names as specified in the schema. If the input is Spanish, interpret regional terms and colloquialisms appropriately.`,
    fr: `\n\nImportant: The input conversation may be in French. Extract the information accurately and return JSON with English field names as specified in the schema.`,
    de: `\n\nImportant: The input conversation may be in German. Extract the information accurately and return JSON with English field names as specified in the schema.`,
    zh: `\n\nImportant: The input conversation may be in Chinese. Extract the information accurately and return JSON with English field names as specified in the schema.`,
    ar: `\n\nImportant: The input conversation may be in Arabic. Extract the information accurately and return JSON with English field names as specified in the schema.`,
  };

  return instructions[language] || `\n\nImportant: The input conversation may be in language "${language}". Extract the information accurately and return JSON with English field names as specified in the schema.`;
}

/**
 * Render a prompt template by replacing {{input}} and {{language}} placeholders.
 */
function renderPrompt(template: string, text: string, language: string): string {
  return template
    .replace(/\{\{input\}\}/g, text)
    .replace(/\{\{language\}\}/g, language);
}

export abstract class LLMExtractorPlugin<TOutput = Record<string, unknown>> implements ExtractorPlugin<string, TOutput> {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract version: string;
  abstract categories: PluginCategory[];
  abstract dependencies: string[];
  abstract outputSchema: z.ZodObject<any>;
  abstract promptTemplate: PromptTemplate;

  /**
   * Optional: override to provide prior-extraction context in the prompt.
   */
  protected buildPriorContext(context: ExtractionContext): string {
    const prior = context.priorExtractions;
    const keys = Object.keys(prior);
    if (keys.length === 0) return '';

    const parts: string[] = ['\n\nPreviously extracted information from other topics:'];
    for (const key of keys) {
      parts.push(`\n--- ${key} ---\n${JSON.stringify(prior[key], null, 2)}`);
    }
    return parts.join('');
  }

  canHandle(input: unknown): boolean {
    return typeof input === 'string' ||
           (typeof input === 'object' && input !== null);
  }

  async extract(
    input: unknown,
    context: ExtractionContext
  ): Promise<ExtractionResult<TOutput>> {
    const text = typeof input === 'string' ? input : JSON.stringify(input);

    // If no LLM client is available, fall back to the subclass's heuristic implementation
    if (!context.llmClient) {
      return this.mockExtract(text, context);
    }

    const lang = context.config.language || 'en';
    const systemPrompt = renderPrompt(
      this.promptTemplate.systemPrompt,
      text,
      lang
    ) + buildLanguageInstruction(lang);

    const userPrompt = renderPrompt(
      this.promptTemplate.userPrompt,
      text,
      lang
    ) + this.buildPriorContext(context);

    const startTime = Date.now();
    try {
      const llmResult = await context.llmClient.complete({
        systemPrompt,
        userPrompt,
        temperature: this.promptTemplate.temperature,
        timeoutMs: context.config.timeoutMs,
      });

      const rawText = llmResult.text;
      const parsed = extractJSONFromLLMResponse(rawText);

      if (!parsed || typeof parsed !== 'object') {
        return {
          success: false,
          data: null,
          extractedFields: [],
          missingFields: Object.keys(this.outputSchema.shape || {}),
          ambiguousFields: [],
          confidence: 0,
          durationMs: Date.now() - startTime,
          rawResponse: rawText,
          errors: [{ code: 'PARSE_ERROR', message: 'Could not parse JSON from LLM response' }],
          followUpQuestions: [],
        };
      }

      // Validate against Zod schema
      const validation = this.validate(parsed);
      const durationMs = Date.now() - startTime;

      const extractedFields = Object.keys(parsed).filter(k => {
        const val = (parsed as any)[k];
        return val !== undefined && val !== null &&
               (typeof val !== 'object' || Object.keys(val).length > 0) &&
               (!Array.isArray(val) || val.length > 0);
      });

      const shape = this.outputSchema.shape || {};
      const allFields = Object.keys(shape);
      const missingFields = allFields.filter(f => !extractedFields.includes(f));

      if (validation.valid && validation.data) {
        return {
          success: true,
          data: validation.data as TOutput,
          extractedFields,
          missingFields,
          ambiguousFields: (parsed as any).ambiguousFields || [],
          confidence: (parsed as any).confidence ?? 0.8,
          durationMs,
          rawResponse: rawText,
          errors: [],
          followUpQuestions: missingFields.map(f => `Can you provide more information about ${f}?`),
        };
      }

      // Partial success: LLM returned JSON but it failed schema validation
      return {
        success: false,
        data: parsed as TOutput,
        extractedFields,
        missingFields,
        ambiguousFields: (parsed as any).ambiguousFields || [],
        confidence: 0.3,
        durationMs,
        rawResponse: rawText,
        errors: validation.errors.map(e => ({
          code: 'VALIDATION_ERROR',
          message: e.message,
          field: e.path,
        })),
        followUpQuestions: missingFields.map(f => `Can you provide more information about ${f}?`),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        data: null,
        extractedFields: [],
        missingFields: Object.keys(this.outputSchema.shape || {}),
        ambiguousFields: [],
        confidence: 0,
        durationMs,
        errors: [{
          code: 'LLM_ERROR',
          message: error instanceof Error ? error.message : 'Unknown LLM error',
        }],
        followUpQuestions: [],
      };
    }
  }

  validate(data: unknown): ValidationResult<TOutput> {
    const result = this.outputSchema.safeParse(data);
    if (result.success) {
      return { valid: true, data: result.data as TOutput, errors: [] };
    }

    return {
      valid: false,
      data: null,
      errors: result.error.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
        value: issue.path.length > 0 ? (data as any)[issue.path[0]] : undefined,
      })),
    };
  }

  /**
   * Fallback heuristic extraction when no LLM client is available.
   * Subclasses should override this.
   */
  protected abstract mockExtract(
    text: string,
    context: ExtractionContext
  ): Promise<ExtractionResult<TOutput>>;
}
