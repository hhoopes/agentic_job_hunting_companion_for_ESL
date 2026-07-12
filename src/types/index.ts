/**
 * Job Hunting Companion
 * Core type definitions for the plugin-based extraction system
 */

import { LLMClient } from '../llm/types.js';

export interface ExtractorPlugin<TInput = unknown, TOutput = Record<string, unknown>> {
  /** Unique plugin identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what this plugin extracts */
  description: string;
  
  /** Version for compatibility tracking */
  version: string;
  
  /** Categories this plugin belongs to */
  categories: PluginCategory[];
  
  /** Plugins that should run before this one */
  dependencies: string[];
  
  /** JSON Schema describing the expected output structure */
  outputSchema: object;
  
  /** Prompt template for LLM extraction */
  promptTemplate: PromptTemplate;
  
  /** Extract structured data from input */
  extract: (input: TInput, context: ExtractionContext) => Promise<ExtractionResult<TOutput>>;
  
  /** Validate extracted data against schema */
  validate: (data: unknown) => ValidationResult<TOutput>;
  
  /** Check if this plugin can handle the given input */
  canHandle: (input: TInput) => boolean;
}

export type PluginCategory = 
  | 'demographics' 
  | 'experience' 
  | 'transportation' 
  | 'preferences' 
  | 'constraints' 
  | 'skills'
  | 'education';

export interface PromptTemplate {
  /** System prompt describing the extraction task */
  systemPrompt: string;
  
  /** User prompt template with placeholders */
  userPrompt: string;
  
  /** Example inputs/outputs for few-shot learning */
  examples?: Example[];
  
  /** Output format instructions */
  outputFormat: 'json' | 'yaml' | 'xml';
  
  /** Temperature for LLM calls (0 = deterministic, 1 = creative) */
  temperature: number;
}

export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

export interface ExtractionContext {
  /** Previously extracted data from other plugins */
  priorExtractions: Record<string, unknown>;

  /** Conversation history if extracting from chat */
  conversationHistory?: Message[];

  /** User preferences for extraction */
  config: ExtractionConfig;

  /** Metadata about the person being helped */
  subjectProfile?: SubjectProfile;

  /** LLM client for plugin extraction. If absent, plugins fall back to heuristics. */
  llmClient?: LLMClient;
}

export interface ExtractionConfig {
  /** Language for extraction */
  language: string;
  
  /** Whether to include confidence scores */
  includeConfidence: boolean;
  
  /** Whether to note uncertain/ambiguous information */
  flagAmbiguity: boolean;
  
  /** Maximum extraction depth */
  maxDepth: number;
  
  /** Timeout in milliseconds */
  timeoutMs: number;
}

export interface SubjectProfile {
  /** Anonymous identifier */
  id: string;
  
  /** Optional nickname */
  displayName?: string;
  
  /** When the profile was created */
  createdAt: Date;
  
  /** Last update timestamp */
  updatedAt: Date;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface ExtractionResult<T = Record<string, unknown>> {
  /** Whether extraction succeeded */
  success: boolean;
  
  /** Extracted structured data */
  data: T | null;
  
  /** Fields that were successfully extracted */
  extractedFields: string[];
  
  /** Fields that could not be determined */
  missingFields: string[];
  
  /** Fields with low confidence or ambiguity */
  ambiguousFields: AmbiguousField[];
  
  /** Confidence score 0-1 */
  confidence: number;
  
  /** Raw LLM response for debugging */
  rawResponse?: string;
  
  /** Time taken to extract */
  durationMs: number;
  
  /** Any errors encountered */
  errors: ExtractionError[];
  
  /** Suggested follow-up questions */
  followUpQuestions: string[];
}

export interface AmbiguousField {
  field: string;
  possibleValues: string[];
  reasoning: string;
}

export interface ExtractionError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  data: T | null;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

export interface HandoffPackage {
  /** Package schema version */
  schemaVersion: string;
  
  /** Unique identifier for this handoff */
  handoffId: string;
  
  /** When the handoff was created */
  timestamp: Date;
  
  /** Subject profile */
  subject: SubjectProfile;
  
  /** All extracted data organized by plugin */
  extractions: Record<string, ExtractionResult>;
  
  /** Merged and normalized profile */
  mergedProfile: JobSeekerProfile;
  
  /** Identified gaps that need follow-up */
  gaps: ProfileGap[];
  
  /** Recommended next actions for job hunting agents */
  recommendations: Recommendation[];
  
  /** Context about the extraction process */
  metadata: HandoffMetadata;
}

export interface JobSeekerProfile {
  /** Demographics and personal info */
  demographics: DemographicsData;
  
  /** Work history and experience */
  experience: ExperienceData;
  
  /** Transportation situation */
  transportation: TransportationData;
  
  /** Job preferences */
  preferences: PreferencesData;
  
  /** Constraints and limitations */
  constraints: ConstraintsData;
}

export interface DemographicsData {
  /** Location including street address and zip for transit/job proximity */
  location: LocationInfo;

  /** Age range or specific age */
  ageRange?: string;

  /** Accessibility requirements */
  accessibilityNeeds: string[];

  /** Preferred schedule constraints */
  scheduleConstraints: ScheduleConstraint[];

  /** Languages spoken */
  languages: string[];

  /** Household composition (dependents, etc.) */
  household?: HouseholdInfo;

  /** Housing situation */
  housingStatus?: string;
}

export interface LocationInfo {
  streetAddress?: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string;
  timezone?: string;
}

export interface ScheduleConstraint {
  type: 'childcare' | 'eldercare' | 'school' | 'medical' | 'transportation' | 'other';
  description: string;
  daysAffected?: string[];
  timeRange?: { start: string; end: string };
  flexibility?: 'fixed' | 'some' | 'flexible';
}

export interface HouseholdInfo {
  adults: number;
  children?: number;
  childrenAges?: number[];
  hasPets?: boolean;
  petTypes?: string[];
}

export interface ExperienceData {
  /** Work history, most recent first */
  workHistory: WorkExperience[];
  
  /** Total years of relevant experience */
  totalYearsExperience?: number;
  
  /** Industries worked in */
  industries: string[];
  
  /** Hard skills */
  hardSkills: string[];
  
  /** Soft skills */
  softSkills: string[];
  
  /** Certifications and licenses */
  certifications: Certification[];
  
  /** Education history */
  education: EducationEntry[];
  
  /** Notable achievements */
  achievements: string[];
  
  /** Summary of experience for resumes */
  summary?: string;
}

export interface WorkExperience {
  employer: string;
  title: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  responsibilities: string[];
  skillsUsed: string[];
  location?: string;
  payRange?: { min?: number; max?: number; period?: 'hour' | 'week' | 'month' | 'year' };
  reasonForLeaving?: string;
}

export interface Certification {
  name: string;
  issuer: string;
  dateObtained: string;
  expirationDate?: string;
  credentialId?: string;
}

export interface EducationEntry {
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  completed: boolean;
  gpa?: number;
}

export interface TransportationData {
  /** Primary commute method */
  primaryMethod: 'car' | 'public_transit' | 'bike' | 'walk' | 'carpool' | 'rideshare' | 'mixed';
  
  /** All available methods */
  availableMethods: string[];
  
  /** Vehicle information if applicable */
  vehicle?: VehicleInfo;
  
  /** Public transit access */
  publicTransit?: PublicTransitInfo;
  
  /** Maximum acceptable commute time */
  maxCommuteTime: { value: number; unit: 'minutes' | 'miles' | 'km' };
  
  /** Preferred commute time */
  preferredCommuteTime?: { value: number; unit: 'minutes' | 'miles' | 'km' };
  
  /** Commute flexibility */
  commuteFlexibility: 'none' | 'some' | 'high';
  
  /** Relocation willingness */
  relocationWilling: boolean;
  
  /** Relocation constraints if willing */
  relocationConstraints?: string[];
}

export interface VehicleInfo {
  hasVehicle: boolean;
  makeModel?: string;
  year?: number;
  reliability?: 'reliable' | 'needs_repair' | 'unreliable';
  insuranceCurrent: boolean;
  registrationCurrent: boolean;
  licenseValid: boolean;
  restrictions?: string[];
}

export interface PublicTransitInfo {
  hasAccess: boolean;
  routes?: string[];
  passType?: string;
  limitations?: string[];
}

export interface PreferencesData {
  /** Desired job types */
  jobTypes: ('full_time' | 'part_time' | 'contract' | 'temp' | 'internship' | 'gig')[];
  
  /** Preferred industries */
  preferredIndustries: string[];
  
  /** Industries to avoid */
  avoidedIndustries: string[];
  
  /** Minimum acceptable pay */
  minimumPay: { amount: number; period: 'hour' | 'week' | 'month' | 'year' };
  
  /** Ideal pay range */
  targetPay?: { min: number; max: number; period: 'hour' | 'week' | 'month' | 'year' };
  
  /** Work environment preference */
  workEnvironment: 'remote' | 'onsite' | 'hybrid' | 'no_preference';
  
  /** Shift preferences */
  shiftPreference: ('day' | 'evening' | 'night' | 'weekend' | 'rotating' | 'any')[];
  
  /** Company size preference */
  companySize?: ('startup' | 'small' | 'medium' | 'large' | 'enterprise')[];
  
  /** Benefits priorities */
  benefitsPriority: string[];
  
  /** Career goals */
  careerGoals?: string;
  
  /** Willingness to learn new skills */
  learningWillingness: boolean;
}

export interface ConstraintsData {
  /** Legal or background check concerns */
  backgroundConcerns?: string[];
  
  /** Physical limitations */
  physicalLimitations?: string[];
  
  /** Technology access constraints */
  technologyAccess?: string[];
  
  /** Time-bound constraints (start date, etc.) */
  timeConstraints?: string[];
  
  /** Financial constraints affecting job search */
  financialConstraints?: string[];
  
  /** Other limiting factors */
  otherConstraints?: string[];
}

export interface ProfileGap {
  category: string;
  field: string;
  importance: 'critical' | 'important' | 'nice_to_have';
  reason: string;
  suggestedQuestion: string;
}

export interface Recommendation {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  agentType: string;
  estimatedEffort: string;
}

export interface HandoffMetadata {
  /** Which plugins contributed data */
  pluginsUsed: string[];
  
  /** Extraction timestamps */
  extractionTimes: Record<string, Date>;
  
  /** Overall confidence score */
  overallConfidence: number;
  
  /** Number of follow-up interactions needed */
  interactionCount: number;
  
  /** Any notes from the helper */
  helperNotes?: string;
}

export interface PluginRegistry {
  register: (plugin: ExtractorPlugin) => void;
  unregister: (pluginId: string) => void;
  get: (pluginId: string) => ExtractorPlugin | undefined;
  list: () => ExtractorPlugin[];
  listByCategory: (category: PluginCategory) => ExtractorPlugin[];
  resolveDependencies: (pluginIds: string[]) => string[];
}

export interface Orchestrator {
  /** Run a single plugin */
  runPlugin: (pluginId: string, input: unknown, context: ExtractionContext) => Promise<ExtractionResult>;
  
  /** Run multiple plugins in dependency order */
  runPipeline: (pluginIds: string[], input: unknown, config: ExtractionConfig) => Promise<HandoffPackage>;
  
  /** Auto-detect which plugins to run based on input */
  autoDetect: (input: unknown, config: ExtractionConfig) => Promise<HandoffPackage>;
  
  /** Check for gaps in existing extractions */
  identifyGaps: (extractions: Record<string, ExtractionResult>) => ProfileGap[];
  
  /** Generate follow-up questions */
  generateFollowUps: (gaps: ProfileGap[]) => string[];
  
  /** Generate intelligent, context-aware follow-up questions using LLM */
  generateIntelligentFollowUps: (
    transcript: string,
    extractions: Record<string, ExtractionResult>,
    config: ExtractionConfig
  ) => Promise<string[]>;
}
