/**
 * Preferences Extractor Plugin
 * Extracts job preferences, desired pay, work environment, and career goals
 */

import {
  ExtractionResult,
  ExtractionContext,
  PromptTemplate,
  PluginCategory,
} from '../types/index.js';
import { PreferencesSchema } from '../schemas/index.js';
import { LLMExtractorPlugin } from '../core/llm-extractor.js';

export const preferencesPromptTemplate: PromptTemplate = {
  systemPrompt: `You are a job search preferences assistant. Extract job seeker preferences and requirements from conversation.

Extract:
- Desired job types (full-time, part-time, contract, temp, gig, internship)
- Preferred and avoided industries
- Minimum pay requirements (must cover living expenses)
- Target/ideal pay range
- Work environment preference (remote, onsite, hybrid)
- Shift preferences (day, evening, night, weekend, rotating)
- Preferred company sizes
- Most important benefits
- Career goals and aspirations
- Willingness to learn new skills

Rules:
1. Distinguish between minimum needs and ideal preferences
2. Pay is sensitive - extract what they volunteer, don't push
3. Note when preferences are flexible vs. firm
4. Return valid JSON
5. Be respectful of financial privacy`,

  userPrompt: `Extract job preferences from this conversation or text:

{{input}}

Return JSON:
{
  "jobTypes": ["full_time|part_time|contract|temp|internship|gig"],
  "preferredIndustries": [...],
  "avoidedIndustries": [...],
  "minimumPay": { "amount": N, "period": "hour|week|month|year" },
  "targetPay": { "min": N, "max": N, "period": "hour|week|month|year" } (optional),
  "workEnvironment": "remote|onsite|hybrid|no_preference",
  "shiftPreference": ["day|evening|night|weekend|rotating|any"],
  "companySize": ["startup|small|medium|large|enterprise"] (optional),
  "benefitsPriority": [...],
  "careerGoals": "..." (optional),
  "learningWillingness": boolean
}

Include:
- "missingFields": []
- "ambiguousFields": []
- "confidence": 0.0-1.0`,

  outputFormat: 'json',
  temperature: 0.2,
};

export class PreferencesExtractor extends LLMExtractorPlugin {
  id = 'preferences-extractor';
  name = 'Job Preferences Extractor';
  description = 'Extracts job type, pay, environment, and career preferences';
  version = '1.0.0';
  categories: PluginCategory[] = ['preferences'];
  dependencies: string[] = [];
  outputSchema = PreferencesSchema;
  promptTemplate = preferencesPromptTemplate;

  protected async mockExtract(
    text: string,
    _context: ExtractionContext
  ): Promise<ExtractionResult> {
    const mockData = this.parseFromText(text);

    const requiredFields = ['jobTypes', 'preferredIndustries', 'minimumPay', 'workEnvironment', 'shiftPreference', 'benefitsPriority', 'learningWillingness'];
    const extractedFields = Object.keys(mockData).filter(k => {
      const val = (mockData as any)[k];
      return val !== undefined && val !== null &&
             (typeof val !== 'object' || Object.keys(val).length > 0) &&
             (!Array.isArray(val) || val.length > 0) &&
             val !== '';
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

    const jobTypes: string[] = [];
    if (lowerText.includes('full time') || lowerText.includes('full-time')) jobTypes.push('full_time');
    if (lowerText.includes('part time') || lowerText.includes('part-time')) jobTypes.push('part_time');
    if (lowerText.includes('contract')) jobTypes.push('contract');
    if (lowerText.includes('temp')) jobTypes.push('temp');
    if (lowerText.includes('gig')) jobTypes.push('gig');
    if (lowerText.includes('intern')) jobTypes.push('internship');
    if (jobTypes.length === 0) jobTypes.push('full_time');

    const payPattern = /\$?(\d+(?:\.\d+)?)\s*(?:per|an?|\/)?\s*(hour|hr|h|week|wk|month|year|yr|annually)/i;
    const payMatch = text.match(payPattern);
    type PayPeriod = 'hour' | 'week' | 'month' | 'year';
    let minimumPay: { amount: number; period: PayPeriod } = { amount: 0, period: 'hour' };
    let targetPay: any = undefined;

    if (payMatch) {
      const amount = parseFloat(payMatch[1]);
      const periodStr = payMatch[2].toLowerCase();
      const period: PayPeriod = periodStr.startsWith('h') ? 'hour' :
                     periodStr.startsWith('w') ? 'week' :
                     periodStr.startsWith('m') ? 'month' : 'year';

      if (lowerText.includes('at least') || lowerText.includes('minimum') || lowerText.includes('need')) {
        minimumPay = { amount, period };
      } else {
        targetPay = { min: amount * 0.9, max: amount * 1.2, period };
      }
    }

    let workEnvironment: any = 'no_preference';
    if (lowerText.includes('remote') || lowerText.includes('work from home') || lowerText.includes('wfh')) {
      workEnvironment = 'remote';
    } else if (lowerText.includes('hybrid')) {
      workEnvironment = 'hybrid';
    } else if (lowerText.includes('in office') || lowerText.includes('on site') || lowerText.includes('onsite')) {
      workEnvironment = 'onsite';
    }

    const shiftPreference: string[] = [];
    if (lowerText.includes('day shift') || lowerText.includes('daytime') || lowerText.includes('9 to 5')) {
      shiftPreference.push('day');
    }
    if (lowerText.includes('evening') || lowerText.includes('night')) {
      shiftPreference.push('evening');
    }
    if (lowerText.includes('weekend')) {
      shiftPreference.push('weekend');
    }
    if (lowerText.includes('any shift') || lowerText.includes('flexible')) {
      shiftPreference.push('any');
    }
    if (shiftPreference.length === 0) shiftPreference.push('day');

    const benefitsPriority: string[] = [];
    if (lowerText.includes('health insurance') || lowerText.includes('medical')) benefitsPriority.push('health insurance');
    if (lowerText.includes('dental')) benefitsPriority.push('dental');
    if (lowerText.includes('vision')) benefitsPriority.push('vision');
    if (lowerText.includes('paid time off') || lowerText.includes('pto') || lowerText.includes('vacation')) benefitsPriority.push('paid time off');
    if (lowerText.includes('flexible')) benefitsPriority.push('flexible schedule');
    if (lowerText.includes('childcare') || lowerText.includes('daycare')) benefitsPriority.push('childcare assistance');
    if (lowerText.includes('tuition') || lowerText.includes('education')) benefitsPriority.push('tuition reimbursement');

    return {
      jobTypes,
      preferredIndustries: [],
      avoidedIndustries: [],
      minimumPay,
      targetPay,
      workEnvironment,
      shiftPreference,
      benefitsPriority,
      learningWillingness: !lowerText.includes('not willing') && !lowerText.includes("won't learn"),
    };
  }

  private generateFollowUps(missingFields: string[]): string[] {
    const questions: string[] = [];

    if (missingFields.includes('minimumPay')) {
      questions.push('What is the minimum pay you need to cover your expenses? This helps me find jobs that actually work for you.');
    }

    if (missingFields.includes('jobTypes')) {
      questions.push('Are you looking for full-time, part-time, or something else?');
    }

    if (missingFields.includes('workEnvironment')) {
      questions.push('Do you want to work from home, in an office, or a mix of both?');
    }

    if (missingFields.includes('shiftPreference')) {
      questions.push('What shifts are you available for? Days, evenings, nights, weekends?');
    }

    return questions;
  }
}
