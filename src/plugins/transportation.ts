/**
 * Transportation Extractor Plugin
 * Extracts commute preferences, vehicle info, and transit access
 */

import {
  ExtractionResult,
  ExtractionContext,
  PromptTemplate,
  PluginCategory,
} from '../types/index.js';
import { TransportationSchema } from '../schemas/index.js';
import { LLMExtractorPlugin } from '../core/llm-extractor.js';

export const transportationPromptTemplate: PromptTemplate = {
  systemPrompt: `You are a job placement logistics assistant. Extract transportation and commute information from a job seeker conversation.

Extract:
- Primary and available transportation methods (car, bus, bike, walk, etc.)
- Vehicle details (if they have one): make, year, reliability, insurance, registration, license status
- Public transit access: routes, pass type, limitations
- Maximum acceptable commute (time or distance)
- Preferred commute time
- Commute flexibility
- Willingness to relocate and constraints

Rules:
1. Be precise about distances and times
2. Note vehicle reliability issues as these affect job viability
3. Flag transit limitations that restrict job locations
4. Return valid JSON
5. Mark unknown fields in missingFields`,

  userPrompt: `Extract transportation information from this conversation or text:

{{input}}

Return JSON:
{
  "primaryMethod": "car|public_transit|bike|walk|carpool|rideshare|mixed",
  "availableMethods": [...],
  "vehicle": {
    "hasVehicle": boolean,
    "makeModel": "..." (optional),
    "year": N (optional),
    "reliability": "reliable|needs_repair|unreliable" (optional),
    "insuranceCurrent": boolean (optional),
    "registrationCurrent": boolean (optional),
    "licenseValid": boolean (optional),
    "restrictions": [...] (optional)
  } (optional),
  "publicTransit": {
    "hasAccess": boolean,
    "routes": [...] (optional),
    "passType": "..." (optional),
    "limitations": [...] (optional)
  } (optional),
  "maxCommuteTime": { "value": N, "unit": "minutes|miles|km" },
  "preferredCommuteTime": { "value": N, "unit": "minutes|miles|km" } (optional),
  "commuteFlexibility": "none|some|high",
  "relocationWilling": boolean,
  "relocationConstraints": [...] (optional)
}

Include:
- "missingFields": []
- "ambiguousFields": []
- "confidence": 0.0-1.0`,

  outputFormat: 'json',
  temperature: 0.1,
};

export class TransportationExtractor extends LLMExtractorPlugin {
  id = 'transportation-extractor';
  name = 'Transportation & Commute Extractor';
  description = 'Extracts transportation methods, vehicle status, and commute preferences';
  version = '1.0.0';
  categories: PluginCategory[] = ['transportation', 'constraints'];
  dependencies: string[] = [];
  outputSchema = TransportationSchema;
  promptTemplate = transportationPromptTemplate;

  protected async mockExtract(
    text: string,
    _context: ExtractionContext
  ): Promise<ExtractionResult> {
    const mockData = this.parseFromText(text);

    const requiredFields = ['primaryMethod', 'availableMethods', 'maxCommuteTime', 'commuteFlexibility', 'relocationWilling', 'publicTransit'];
    const extractedFields = Object.keys(mockData).filter(k => {
      const val = (mockData as any)[k];
      return val !== undefined && val !== null &&
             (typeof val !== 'object' || Object.keys(val).length > 0) &&
             (!Array.isArray(val) || val.length > 0);
    });
    const missingFields = requiredFields.filter(f => !extractedFields.includes(f));

    return {
      success: true,
      data: mockData,
      extractedFields,
      missingFields,
      ambiguousFields: [],
      confidence: extractedFields.length / requiredFields.length,
      durationMs: 0,
      errors: [],
      followUpQuestions: this.generateFollowUps(missingFields),
    };
  }

  private parseFromText(text: string): any {
    const lowerText = text.toLowerCase();

    let primaryMethod = 'mixed';
    const methods: string[] = [];

    if (lowerText.includes('car') || lowerText.includes('drive') || lowerText.includes('vehicle')) {
      primaryMethod = 'car';
      methods.push('car');
    }
    if (lowerText.includes('bus') || lowerText.includes('train') || lowerText.includes('transit') || lowerText.includes('metro')) {
      if (primaryMethod === 'mixed') primaryMethod = 'public_transit';
      methods.push('public_transit');
    }
    if (lowerText.includes('bike') || lowerText.includes('bicycle')) {
      methods.push('bike');
    }
    if (lowerText.includes('walk')) {
      methods.push('walk');
    }
    if (lowerText.includes('carpool')) {
      methods.push('carpool');
    }
    if (lowerText.includes('uber') || lowerText.includes('lyft') || lowerText.includes('rideshare')) {
      methods.push('rideshare');
    }

    if (methods.length === 0) {
      methods.push('mixed');
    }

    let vehicle: any = undefined;
    if (lowerText.includes('car') || lowerText.includes('truck') || lowerText.includes('vehicle')) {
      vehicle = {
        hasVehicle: true,
        reliability: lowerText.includes('break') || lowerText.includes('unreliable') ? 'unreliable' :
                     lowerText.includes('repair') || lowerText.includes('fix') ? 'needs_repair' :
                     'reliable',
        licenseValid: !lowerText.includes('suspended') && !lowerText.includes('no license'),
        insuranceCurrent: !lowerText.includes('no insurance') && !lowerText.includes('expired insurance'),
        registrationCurrent: !lowerText.includes('expired registration'),
      };
    } else if (lowerText.includes('no car') || lowerText.includes("don't have a car") || lowerText.includes("don't drive")) {
      vehicle = { hasVehicle: false };
    }

    let publicTransit: any = undefined;
    if (lowerText.includes('bus') || lowerText.includes('train') || lowerText.includes('transit')) {
      publicTransit = {
        hasAccess: true,
        limitations: lowerText.includes('limited') || lowerText.includes('no bus') ?
                    ['Limited route availability'] : undefined,
      };
    }

    const commutePatterns = [
      /(\d+)\s*(minute|min|mile|mi|km)/i,
      /(\d+)-(\d+)\s*(minute|min|mile|mi|km)/i,
    ];

    type CommuteUnit = 'minutes' | 'miles' | 'km';
    let maxCommuteTime: { value: number; unit: CommuteUnit } = { value: 30, unit: 'minutes' };
    for (const pattern of commutePatterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseInt(match[1]);
        const unitStr = match[match.length - 1].toLowerCase();
        const unit: CommuteUnit = unitStr.startsWith('min') ? 'minutes' :
                     unitStr.startsWith('mi') ? 'miles' :
                     unitStr === 'km' ? 'km' : 'minutes';
        maxCommuteTime = { value, unit };
        break;
      }
    }

    const relocationWilling = lowerText.includes('relocate') || lowerText.includes('move') || lowerText.includes('willing to move');
    const relocationConstraints: string[] = [];
    if (relocationWilling && lowerText.includes('family')) {
      relocationConstraints.push('Must stay near family');
    }

    return {
      primaryMethod,
      availableMethods: methods,
      vehicle,
      publicTransit,
      maxCommuteTime,
      commuteFlexibility: lowerText.includes('flexible') ? 'high' :
                         lowerText.includes('some') ? 'some' : 'some',
      relocationWilling,
      relocationConstraints: relocationConstraints.length > 0 ? relocationConstraints : undefined,
    };
  }

  private generateFollowUps(missingFields: string[]): string[] {
    const questions: string[] = [];

    if (missingFields.includes('primaryMethod')) {
      questions.push('How do you usually get around? Do you have a car, take the bus, bike, or walk?');
    }

    if (missingFields.includes('maxCommuteTime')) {
      questions.push('How far are you willing to travel for work?');
    }

    if (missingFields.includes('vehicle')) {
      questions.push('Do you have a reliable vehicle? Is your license, insurance, and registration current?');
    }

    return questions;
  }
}
