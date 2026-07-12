/**
 * LLM Client Abstraction
 * Works with any LLM provider via a simple completion interface.
 */

export interface LLMCompletionOptions {
  /** System/instruction prompt */
  systemPrompt: string;
  /** User/content prompt */
  userPrompt: string;
  /** Temperature (0 = deterministic, 1 = creative) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMCompletionResult {
  /** Generated text */
  text: string;
  /** Model identifier */
  model?: string;
  /** Token usage if available */
  usage?: LLMUsage;
}

export interface LLMClient {
  /** Send a completion request */
  complete(options: LLMCompletionOptions): Promise<LLMCompletionResult>;
  /** Human-readable provider name */
  providerName: string;
}

/**
 * Recursively search an object/array for a value (case-insensitive substring match).
 */
function valueExistsInJSON(obj: unknown, target: string): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj).toLowerCase().includes(target.toLowerCase());
  }
  if (Array.isArray(obj)) {
    return obj.some(item => valueExistsInJSON(item, target));
  }
  if (typeof obj === 'object') {
    return Object.values(obj).some(val => valueExistsInJSON(val, target));
  }
  return false;
}

/**
 * Extract JSON from raw LLM text, handling markdown fences and extra prose.
 * Uses a stack-based approach to find balanced braces, then tries progressively
 * smaller substrings until we find valid JSON.
 */
function extractJSON(text: string): object | null {
  const trimmed = text.trim();

  // Match fenced JSON blocks first
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // Try all balanced brace pairs, preferring the largest valid JSON
  const candidates: string[] = [];
  const stack: number[] = [];

  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') {
      stack.push(i);
    } else if (trimmed[i] === '}' && stack.length > 0) {
      const start = stack.pop()!;
      if (stack.length === 0) {
        // Only consider top-level objects (not nested ones)
        candidates.push(trimmed.slice(start, i + 1));
      }
    }
  }

  // Try candidates from largest to smallest
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Fallback: try arrays too
  const arrCandidates: string[] = [];
  const arrStack: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '[') {
      arrStack.push(i);
    } else if (trimmed[i] === ']' && arrStack.length > 0) {
      const start = arrStack.pop()!;
      if (arrStack.length === 0) {
        arrCandidates.push(trimmed.slice(start, i + 1));
      }
    }
  }
  arrCandidates.sort((a, b) => b.length - a.length);
  for (const candidate of arrCandidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Continue
    }
  }

  return null;
}

export interface ProbeResult {
  supported: boolean;
  hitRate: number;
  foundValues: string[];
  totalValues: number;
  rawResponse: string;
  parseError?: string;
}

/**
 * Probe whether the LLM supports a given language for structured extraction.
 * We give the model a real mini-extraction task and verify it pulled out key facts,
 * regardless of JSON structure or field names.
 */
export async function probeLanguageSupport(
  client: LLMClient,
  languageCode: string,
  verbose?: boolean
): Promise<ProbeResult> {
  const miniTasks: Record<string, { text: string; expectedValues: string[] }> = {
    es: {
      text: 'Vivo en Madrid, España. Trabajo como camarero desde hace dos años. Necesito ganar al menos 15 euros por hora.',
      expectedValues: ['Madrid', 'España', 'camarero', '2', '15'],
    },
    fr: {
      text: "J'habite à Lyon, en France. Je travaille comme infirmier depuis trois ans. Je cherche un emploi à temps plein.",
      expectedValues: ['Lyon', 'France', 'infirmier', '3', 'plein'],
    },
    de: {
      text: 'Ich wohne in Berlin, Deutschland. Ich bin LKW-Fahrer seit fünf Jahren. Ich brauche mindestens 18 Euro pro Stunde.',
      expectedValues: ['Berlin', 'Deutschland', 'LKW', '5', '18'],
    },
    zh: {
      text: '我住在上海。我做软件工程师三年了。我想找一份全职工作。',
      expectedValues: ['上海', '软件', '3', '全职'],
    },
    ar: {
      text: 'أعيش في دبي. أعمل كمهندس منذ أربع سنوات. أحتاج إلى راتب لا يقل عن 20 درهماً في الساعة.',
      expectedValues: ['دبي', 'مهندس', '4', '20'],
    },
  };

  const task = miniTasks[languageCode];

  if (!task) {
    const englishResult = await probeLanguageSupportEnglish(client, languageCode);
    return {
      supported: englishResult,
      hitRate: englishResult ? 1 : 0,
      foundValues: [],
      totalValues: 0,
      rawResponse: englishResult ? 'YES' : 'NO',
    };
  }

  try {
    const result = await client.complete({
      systemPrompt: `You are a structured data extraction assistant. The user will give you text in ${languageCode}. Extract the important facts and return them as a JSON object. Return ONLY valid JSON. No extra text.`,
      userPrompt: `Extract the key facts from this text:\n\n${task.text}`,
      temperature: 0,
      maxTokens: 256,
      timeoutMs: 15000,
    });

    const rawText = result.text;
    const parsed = extractJSON(rawText);

    if (!parsed) {
      return {
        supported: false,
        hitRate: 0,
        foundValues: [],
        totalValues: task.expectedValues.length,
        rawResponse: rawText,
        parseError: 'Could not extract valid JSON from model response',
      };
    }

    // Count how many expected values appear anywhere in the parsed JSON
    const foundValues = task.expectedValues.filter(val => valueExistsInJSON(parsed, val));
    const hitRate = foundValues.length / task.expectedValues.length;

    return {
      supported: hitRate >= 0.6,
      hitRate,
      foundValues,
      totalValues: task.expectedValues.length,
      rawResponse: rawText,
    };
  } catch (error) {
    return {
      supported: false,
      hitRate: 0,
      foundValues: [],
      totalValues: task.expectedValues.length,
      rawResponse: '',
      parseError: error instanceof Error ? error.message : 'Unknown API error',
    };
  }
}

async function probeLanguageSupportEnglish(
  client: LLMClient,
  languageCode: string
): Promise<boolean> {
  try {
    const result = await client.complete({
      systemPrompt: 'You are a helpful assistant. Answer exactly as requested.',
      userPrompt: `Reply "YES" if you can understand and extract structured data from conversations in language code "${languageCode}". Reply "NO" if you cannot.`,
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 10000,
    });
    return result.text.toLowerCase().includes('yes');
  } catch {
    return false;
  }
}
