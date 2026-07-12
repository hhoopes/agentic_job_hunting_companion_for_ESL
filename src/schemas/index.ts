/**
 * Zod Schema Definitions
 * These define the structure for all extracted data and can generate JSON Schema
 * for use with any LLM system (ChatGPT, Gemini, Claude, etc.)
 */

import { z } from 'zod';

// ============================================================================
// Demographics Schemas
// ============================================================================

export const LocationSchema = z.object({
  streetAddress: z.string().optional().describe('Street address (needed for transit and job proximity)'),
  city: z.string().min(1).describe('City where the person is looking for work'),
  state: z.string().min(1).describe('State or province'),
  zipCode: z.string().optional().describe('ZIP or postal code (needed for transit and job proximity)'),
  county: z.string().optional().describe('County or region'),
  timezone: z.string().optional().describe('Timezone'),
});

export const ScheduleConstraintSchema = z.object({
  type: z.enum(['childcare', 'eldercare', 'school', 'medical', 'transportation', 'other'])
    .describe('Type of constraint'),
  description: z.string().describe('Details about the constraint'),
  daysAffected: z.array(z.string()).optional().describe('Days of week affected (e.g., monday, tuesday)'),
  timeRange: z.object({
    start: z.string().describe('Start time in HH:MM format'),
    end: z.string().describe('End time in HH:MM format'),
  }).optional().describe('Time range of constraint'),
  flexibility: z.enum(['fixed', 'some', 'flexible']).optional().describe('How flexible this constraint is'),
});

export const HouseholdSchema = z.object({
  adults: z.number().int().min(1).describe('Number of adults in household'),
  children: z.number().int().optional().describe('Number of children'),
  childrenAges: z.array(z.number()).optional().describe('Ages of children'),
  hasPets: z.boolean().optional().describe('Whether household has pets'),
  petTypes: z.array(z.string()).optional().describe('Types of pets'),
});

export const DemographicsSchema = z.object({
  location: LocationSchema.describe('Work search location'),
  ageRange: z.string().optional().describe('Age range (e.g., "25-34", "55+")'),
  accessibilityNeeds: z.array(z.string()).describe('Accessibility or accommodation needs'),
  scheduleConstraints: z.array(ScheduleConstraintSchema).describe('Schedule limitations'),
  languages: z.array(z.string()).describe('Languages spoken'),
  household: HouseholdSchema.optional().describe('Household composition'),
  housingStatus: z.string().optional().describe('Housing situation (renting, owning, temporary)'),
});

// ============================================================================
// Experience Schemas
// ============================================================================

export const WorkExperienceSchema = z.object({
  employer: z.string().describe('Company or organization name'),
  title: z.string().describe('Job title'),
  startDate: z.string().describe('Start date (YYYY-MM or present)'),
  endDate: z.string().optional().describe('End date if no longer working there'),
  current: z.boolean().describe('Is this their current job'),
  responsibilities: z.array(z.string()).describe('Key responsibilities and duties'),
  skillsUsed: z.array(z.string()).describe('Skills utilized in this role'),
  location: z.string().optional().describe('Job location'),
  payRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    period: z.enum(['hour', 'week', 'month', 'year']).optional(),
  }).optional().describe('Pay range if known'),
  reasonForLeaving: z.string().optional().describe('Why they left or are leaving'),
});

export const CertificationSchema = z.object({
  name: z.string().describe('Certification or license name'),
  issuer: z.string().describe('Issuing organization'),
  dateObtained: z.string().describe('Date obtained'),
  expirationDate: z.string().optional().describe('Expiration date if applicable'),
  credentialId: z.string().optional().describe('Credential ID or license number'),
});

export const EducationSchema = z.object({
  institution: z.string().describe('School, university, or training provider'),
  degree: z.string().describe('Degree, diploma, or certificate type'),
  fieldOfStudy: z.string().optional().describe('Major or field of study'),
  startDate: z.string().optional().describe('Start date'),
  endDate: z.string().optional().describe('Completion date'),
  completed: z.boolean().describe('Whether completed or in progress'),
  gpa: z.number().optional().describe('GPA if relevant'),
});

export const ExperienceSchema = z.object({
  workHistory: z.array(WorkExperienceSchema).describe('Work history, most recent first'),
  totalYearsExperience: z.number().optional().describe('Total years of work experience'),
  industries: z.array(z.string()).describe('Industries worked in'),
  hardSkills: z.array(z.string()).describe('Technical/hard skills'),
  softSkills: z.array(z.string()).describe('Soft/people skills'),
  certifications: z.array(CertificationSchema).describe('Professional certifications and licenses'),
  education: z.array(EducationSchema).describe('Educational background'),
  achievements: z.array(z.string()).describe('Notable achievements or accomplishments'),
  summary: z.string().optional().describe('Brief professional summary'),
});

// ============================================================================
// Transportation Schemas
// ============================================================================

export const VehicleSchema = z.object({
  hasVehicle: z.boolean().describe('Whether they have access to a vehicle'),
  makeModel: z.string().optional().describe('Vehicle make and model'),
  year: z.number().int().optional().describe('Vehicle year'),
  reliability: z.enum(['reliable', 'needs_repair', 'unreliable']).optional().describe('Vehicle reliability'),
  insuranceCurrent: z.boolean().optional().describe('Insurance is current'),
  registrationCurrent: z.boolean().optional().describe('Registration is current'),
  licenseValid: z.boolean().optional().describe('Driver license is valid and current'),
  restrictions: z.array(z.string()).optional().describe('Any driving restrictions'),
});

export const PublicTransitSchema = z.object({
  hasAccess: z.boolean().describe('Has access to public transit'),
  routes: z.array(z.string()).optional().describe('Available bus/train routes'),
  passType: z.string().optional().describe('Type of transit pass if applicable'),
  limitations: z.array(z.string()).optional().describe('Transit limitations (limited routes, schedules)'),
});

export const TransportationSchema = z.object({
  primaryMethod: z.enum(['car', 'public_transit', 'bike', 'walk', 'carpool', 'rideshare', 'mixed'])
    .describe('Primary transportation method'),
  availableMethods: z.array(z.string()).describe('All available transportation methods'),
  vehicle: VehicleSchema.optional().describe('Vehicle details if applicable'),
  publicTransit: PublicTransitSchema.optional().describe('Public transit details'),
  maxCommuteTime: z.object({
    value: z.number().describe('Numeric value'),
    unit: z.enum(['minutes', 'miles', 'km']).describe('Unit of measurement'),
  }).describe('Maximum acceptable commute'),
  preferredCommuteTime: z.object({
    value: z.number().describe('Numeric value'),
    unit: z.enum(['minutes', 'miles', 'km']).describe('Unit of measurement'),
  }).optional().describe('Preferred commute time/distance'),
  commuteFlexibility: z.enum(['none', 'some', 'high']).describe('Flexibility on commute'),
  relocationWilling: z.boolean().describe('Willing to relocate for work'),
  relocationConstraints: z.array(z.string()).optional().describe('Relocation limitations'),
});

// ============================================================================
// Preferences Schemas
// ============================================================================

export const PreferencesSchema = z.object({
  jobTypes: z.array(z.enum(['full_time', 'part_time', 'contract', 'temp', 'internship', 'gig']))
    .describe('Desired employment types'),
  preferredIndustries: z.array(z.string()).describe('Industries they want to work in'),
  avoidedIndustries: z.array(z.string()).describe('Industries to avoid'),
  minimumPay: z.object({
    amount: z.number().describe('Minimum pay amount'),
    period: z.enum(['hour', 'week', 'month', 'year']).describe('Pay period'),
  }).describe('Minimum acceptable pay'),
  targetPay: z.object({
    min: z.number().describe('Minimum of target range'),
    max: z.number().describe('Maximum of target range'),
    period: z.enum(['hour', 'week', 'month', 'year']).describe('Pay period'),
  }).optional().describe('Ideal pay range'),
  workEnvironment: z.enum(['remote', 'onsite', 'hybrid', 'no_preference'])
    .describe('Work environment preference'),
  shiftPreference: z.array(z.enum(['day', 'evening', 'night', 'weekend', 'rotating', 'any']))
    .describe('Preferred shifts'),
  companySize: z.array(z.enum(['startup', 'small', 'medium', 'large', 'enterprise']))
    .optional().describe('Preferred company sizes'),
  benefitsPriority: z.array(z.string()).describe('Most important benefits'),
  careerGoals: z.string().optional().describe('Short and long-term career goals'),
  learningWillingness: z.boolean().describe('Willing to learn new skills'),
});

// ============================================================================
// Constraints Schema
// ============================================================================

export const ConstraintsSchema = z.object({
  backgroundConcerns: z.array(z.string()).optional().describe('Background check concerns'),
  physicalLimitations: z.array(z.string()).optional().describe('Physical restrictions'),
  technologyAccess: z.array(z.string()).optional().describe('Technology access limitations'),
  timeConstraints: z.array(z.string()).optional().describe('Time-bound constraints'),
  financialConstraints: z.array(z.string()).optional().describe('Financial limitations affecting search'),
  otherConstraints: z.array(z.string()).optional().describe('Other limiting factors'),
});

// ============================================================================
// Complete Profile Schema
// ============================================================================

export const JobSeekerProfileSchema = z.object({
  demographics: DemographicsSchema,
  experience: ExperienceSchema,
  transportation: TransportationSchema,
  preferences: PreferencesSchema,
  constraints: ConstraintsSchema,
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate JSON Schema from a Zod schema for LLM consumption.
 * Zod v4 has .toJSONSchema() built-in!
 * Compatible with OpenAI function calling, Gemini, etc.
 */
export function toJSONSchema(schema: z.ZodType<any, any, any>, title?: string): object {
  // Zod v4 has built-in toJSONSchema
  const jsonSchema = schema.toJSONSchema();
  return {
    title: title || 'Schema',
    ...jsonSchema,
  };
}

// ============================================================================
// Type Exports
// ============================================================================

export type Demographics = z.infer<typeof DemographicsSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Transportation = z.infer<typeof TransportationSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type JobSeekerProfile = z.infer<typeof JobSeekerProfileSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type WorkExperience = z.infer<typeof WorkExperienceSchema>;
export type Certification = z.infer<typeof CertificationSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Vehicle = z.infer<typeof VehicleSchema>;
export type PublicTransit = z.infer<typeof PublicTransitSchema>;
export type ScheduleConstraint = z.infer<typeof ScheduleConstraintSchema>;
