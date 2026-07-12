/**
 * Experience Extractor Plugin
 * Extracts work history, skills, education, and certifications
 */

import {
  ExtractionResult,
  ExtractionContext,
  PromptTemplate,
  PluginCategory,
} from '../types/index.js';
import { ExperienceSchema } from '../schemas/index.js';
import { LLMExtractorPlugin } from '../core/llm-extractor.js';

export const experiencePromptTemplate: PromptTemplate = {
  systemPrompt: `You are a career counselor assistant. Extract structured employment history, skills, and education from a conversation with a job seeker.

Extract:
- Work history (employer, title, dates, responsibilities, skills used)
- Total years of experience
- Industries worked in
- Hard skills (technical abilities, tools, software)
- Soft skills (communication, teamwork, leadership)
- Certifications and licenses
- Education history
- Key achievements
- A brief professional summary

Rules:
1. Extract ONLY stated information
2. Infer skills from job responsibilities when reasonable
3. Parse dates in any format to YYYY-MM
4. Return valid JSON matching the schema
5. Flag uncertain information as ambiguous
6. Do NOT hallucinate employers or credentials`,

  userPrompt: `Extract work experience information from this conversation or text:

{{input}}

Return JSON with this structure:
{
  "workHistory": [
    {
      "employer": "...",
      "title": "...",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM or present",
      "current": boolean,
      "responsibilities": [...],
      "skillsUsed": [...],
      "location": "...",
      "payRange": { "min": N, "max": N, "period": "hour|week|month|year" } (optional),
      "reasonForLeaving": "..." (optional)
    }
  ],
  "totalYearsExperience": N (optional),
  "industries": [...],
  "hardSkills": [...],
  "softSkills": [...],
  "certifications": [
    { "name": "...", "issuer": "...", "dateObtained": "YYYY-MM", "expirationDate": "YYYY-MM" (optional), "credentialId": "..." (optional) }
  ],
  "education": [
    { "institution": "...", "degree": "...", "fieldOfStudy": "...", "startDate": "YYYY-MM", "endDate": "YYYY-MM", "completed": boolean, "gpa": N (optional) }
  ],
  "achievements": [...],
  "summary": "..." (optional)
}

Include:
- "missingFields": [] for unextracted required fields
- "ambiguousFields": [] for unclear info
- "confidence": 0.0-1.0`,

  outputFormat: 'json',
  temperature: 0.2,
};

export class ExperienceExtractor extends LLMExtractorPlugin {
  id = 'experience-extractor';
  name = 'Work Experience & Skills Extractor';
  description = 'Extracts employment history, skills, education, and certifications';
  version = '1.0.0';
  categories: PluginCategory[] = ['experience', 'skills', 'education'];
  dependencies: string[] = [];
  outputSchema = ExperienceSchema;
  promptTemplate = experiencePromptTemplate;

  protected async mockExtract(
    text: string,
    _context: ExtractionContext
  ): Promise<ExtractionResult> {
    const mockData = this.parseFromText(text);

    const requiredFields = ['workHistory', 'industries', 'hardSkills', 'softSkills', 'certifications', 'education', 'achievements'];
    const extractedFields = Object.keys(mockData).filter(k => {
      const val = (mockData as any)[k];
      return val !== undefined && val !== null &&
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
      followUpQuestions: this.generateFollowUps(missingFields, mockData),
    };
  }

  private parseFromText(text: string): any {
    const lowerText = text.toLowerCase();

    const jobPatterns = [
      /(?:worked as|was a|am a|job as|position as|role as)\s+([a-z\s]+?)(?:\s+at|\s+for|\s+from|,|\.|\n)/i,
      /(?:i am|i'm)\s+(?:a|an)\s+([a-z\s]+?)(?:\s+at|\s+for|,|\.|\n)/i,
    ];

    const workHistory: any[] = [];
    for (const pattern of jobPatterns) {
      const match = text.match(pattern);
      if (match) {
        workHistory.push({
          employer: 'Unknown',
          title: match[1].trim(),
          startDate: '',
          current: lowerText.includes('currently') || lowerText.includes('i am'),
          responsibilities: [],
          skillsUsed: [],
        });
      }
    }

    const hardSkills = this.extractSkills(text);

    const education: any[] = [];
    if (lowerText.includes('high school') || lowerText.includes('ged')) {
      education.push({
        institution: 'Unknown',
        degree: lowerText.includes('ged') ? 'GED' : 'High School Diploma',
        completed: true,
      });
    }
    if (lowerText.includes('college') || lowerText.includes('university') || lowerText.includes('degree')) {
      education.push({
        institution: 'Unknown',
        degree: 'Unknown Degree',
        completed: !lowerText.includes('dropped') && !lowerText.includes('incomplete'),
      });
    }

    return {
      workHistory: workHistory.length > 0 ? workHistory : [],
      industries: this.extractIndustries(text),
      hardSkills,
      softSkills: this.extractSoftSkills(text),
      certifications: [],
      education: education.length > 0 ? education : [],
      achievements: [],
    };
  }

  private extractSkills(text: string): string[] {
    const skillKeywords = [
      'microsoft office', 'excel', 'word', 'powerpoint',
      'customer service', 'cash handling', 'data entry',
      'forklift', 'warehouse', 'driving', 'cdl',
      'cooking', 'food prep', 'cleaning', 'maintenance',
      'sales', 'retail', 'phone', 'computer',
      'typing', 'organizing', 'scheduling', 'inventory',
    ];

    const found: string[] = [];
    const lowerText = text.toLowerCase();

    for (const skill of skillKeywords) {
      if (lowerText.includes(skill)) {
        found.push(skill);
      }
    }

    return [...new Set(found)];
  }

  private extractSoftSkills(text: string): string[] {
    const keywords = [
      'communication', 'teamwork', 'leadership', 'problem solving',
      'time management', 'reliable', 'punctual', 'friendly',
      'organized', 'detail-oriented', 'multitasking', 'patience',
    ];

    const found: string[] = [];
    const lowerText = text.toLowerCase();

    for (const skill of keywords) {
      if (lowerText.includes(skill)) {
        found.push(skill);
      }
    }

    return [...new Set(found)];
  }

  private extractIndustries(text: string): string[] {
    const industryKeywords = [
      'retail', 'restaurant', 'food service', 'healthcare',
      'construction', 'manufacturing', 'warehouse', 'logistics',
      'customer service', 'administrative', 'education',
      'hospitality', 'cleaning', 'maintenance', 'driving',
      'agriculture', 'technology', 'finance', 'sales',
    ];

    const found: string[] = [];
    const lowerText = text.toLowerCase();

    for (const industry of industryKeywords) {
      if (lowerText.includes(industry)) {
        found.push(industry);
      }
    }

    return [...new Set(found)];
  }

  private generateFollowUps(missingFields: string[], data: any): string[] {
    const questions: string[] = [];

    if (missingFields.includes('workHistory') || data.workHistory?.length === 0) {
      questions.push('Can you tell me about your most recent job? Where did you work and what did you do?');
    }

    if (missingFields.includes('hardSkills') || data.hardSkills?.length === 0) {
      questions.push('What specific skills do you have? For example: computer skills, equipment operation, languages, tools?');
    }

    if (missingFields.includes('education')) {
      questions.push('What is your highest level of education?');
    }

    return questions;
  }
}
