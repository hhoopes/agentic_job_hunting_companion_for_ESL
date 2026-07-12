/**
 * Demographics Extractor Plugin
 * Extracts personal and household information from conversation or direct input
 */

import { z } from 'zod';
import {
  ExtractionResult,
  ExtractionContext,
  PromptTemplate,
  PluginCategory,
} from '../types/index.js';
import { DemographicsSchema } from '../schemas/index.js';
import { LLMExtractorPlugin } from '../core/llm-extractor.js';

export const demographicsPromptTemplate: PromptTemplate = {
  systemPrompt: `You are an intake assistant for a job placement service. Your task is to extract structured demographic and personal information from a conversation with a job seeker.

Extract the following information:
- Location (street address, city, state, zip where they live — needed for transit and job proximity)
- Schedule constraints (childcare, school, medical appointments, etc.)
- Accessibility or accommodation needs
- Languages spoken
- Household composition (if relevant to scheduling)
- Housing status (if relevant to job stability)

Rules:
1. Extract ONLY what is explicitly stated or can be reasonably inferred
2. Do NOT make up information
3. Use empty arrays for unknown lists
4. Flag ambiguous information
5. Respect privacy - do NOT ask for or extract SSN, exact birth dates, or other sensitive identifiers
6. Return valid JSON matching the requested schema
7. If information is missing, note it in the missingFields array`,

  userPrompt: `Please extract demographic and personal information from the following conversation or text:

{{input}}

Return a JSON object with this structure:
{
  "location": { "streetAddress": "..." (optional), "city": "...", "state": "...", "zipCode": "..." },
  "ageRange": "..." (optional),
  "accessibilityNeeds": [...],
  "scheduleConstraints": [
    { "type": "childcare|eldercare|school|medical|transportation|other", "description": "...", "daysAffected": [...], "timeRange": { "start": "HH:MM", "end": "HH:MM" }, "flexibility": "fixed|some|flexible" }
  ],
  "languages": [...],
  "household": { "adults": N, "children": N (optional), "childrenAges": [...] (optional), "hasPets": boolean (optional), "petTypes": [...] (optional) } (optional),
  "housingStatus": "..." (optional)
}

Also include:
- "missingFields": ["field1", "field2"] for information not found
- "ambiguousFields": [{"field": "...", "possibleValues": [...], "reasoning": "..."}] for unclear information
- "confidence": 0.0 to 1.0 overall confidence`,

  outputFormat: 'json',
  temperature: 0.1,
};

export class DemographicsExtractor extends LLMExtractorPlugin {
  id = 'demographics-extractor';
  name = 'Demographics & Personal Info Extractor';
  description = 'Extracts location, household info, schedule constraints, and accessibility needs';
  version = '1.0.0';
  categories: PluginCategory[] = ['demographics', 'constraints'];
  dependencies: string[] = [];
  outputSchema = DemographicsSchema;
  promptTemplate = demographicsPromptTemplate;

  protected async mockExtract(
    text: string,
    _context: ExtractionContext
  ): Promise<ExtractionResult> {
    const mockData = this.parseFromText(text);

    const extractedFields = Object.keys(mockData).filter(k => {
      const val = (mockData as any)[k];
      return val !== undefined && val !== null &&
             (typeof val !== 'object' || Object.keys(val).length > 0) &&
             (!Array.isArray(val) || val.length > 0);
    });

    const allFields = ['location', 'accessibilityNeeds', 'scheduleConstraints', 'languages'];
    const missingFields = allFields.filter(f => !extractedFields.includes(f));

    return {
      success: true,
      data: mockData,
      extractedFields,
      missingFields,
      ambiguousFields: [],
      confidence: extractedFields.length / allFields.length,
      durationMs: 0,
      errors: [],
      followUpQuestions: missingFields.map(f =>
        `Can you tell me more about your ${f}?`
      ),
    };
  }

  private parseFromText(text: string): any {
    const location = this.extractLocation(text);
    const constraints = this.extractConstraints(text);
    const languages = this.extractLanguages(text);

    return {
      location,
      accessibilityNeeds: text.toLowerCase().includes('accessibility') ||
                          text.toLowerCase().includes('accommodation') ?
                          ['unknown - needs clarification'] : [],
      scheduleConstraints: constraints,
      languages,
    };
  }

  private extractLocation(text: string): any {
    const cityStatePattern = /(?:in|near|around|from)\s+([A-Za-z\s]+),?\s*([A-Z]{2})/i;
    const match = text.match(cityStatePattern);

    if (match) {
      return {
        city: match[1].trim(),
        state: match[2]?.trim() || '',
        zipCode: '',
      };
    }

    return { city: '', state: '', zipCode: '' };
  }

  private extractConstraints(text: string): any[] {
    const constraints: any[] = [];
    const lowerText = text.toLowerCase();

    if (lowerText.includes('child') || lowerText.includes('daycare') || lowerText.includes('kids')) {
      constraints.push({
        type: 'childcare',
        description: 'Has childcare responsibilities',
        flexibility: 'some',
      });
    }

    if (lowerText.includes('school') || lowerText.includes('class')) {
      constraints.push({
        type: 'school',
        description: 'Attending school or classes',
        flexibility: 'fixed',
      });
    }

    if (lowerText.includes('medical') || lowerText.includes('doctor') || lowerText.includes('appointment')) {
      constraints.push({
        type: 'medical',
        description: 'Has medical appointments or treatments',
        flexibility: 'fixed',
      });
    }

    return constraints;
  }

  private extractLanguages(text: string): string[] {
    const languages = ['English'];
    const lowerText = text.toLowerCase();

    if (lowerText.includes('spanish') || lowerText.includes('español')) languages.push('Spanish');
    if (lowerText.includes('french') || lowerText.includes('français')) languages.push('French');
    if (lowerText.includes('mandarin') || lowerText.includes('chinese')) languages.push('Mandarin');
    if (lowerText.includes('arabic')) languages.push('Arabic');

    return [...new Set(languages)];
  }
}
