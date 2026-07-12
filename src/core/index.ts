/**
 * Core Plugin Registry and Orchestrator
 * Manages extractor plugins and coordinates extraction pipelines
 */

import {
  ExtractorPlugin,
  PluginRegistry,
  Orchestrator,
  ExtractionContext,
  ExtractionConfig,
  ExtractionResult,
  HandoffPackage,
  ProfileGap,
  SubjectProfile,
  JobSeekerProfile,
  ValidationResult,
  HandoffMetadata,
} from '../types/index.js';
import { LLMClient } from '../llm/types.js';
import { LLMExtractorPlugin, extractJSONFromLLMResponse } from './llm-extractor.js';
export { LLMExtractorPlugin, extractJSONFromLLMResponse };

export class PluginRegistryImpl implements PluginRegistry {
  private plugins: Map<string, ExtractorPlugin> = new Map();

  register(plugin: ExtractorPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  get(pluginId: string): ExtractorPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): ExtractorPlugin[] {
    return Array.from(this.plugins.values());
  }

  listByCategory(category: string): ExtractorPlugin[] {
    return this.list().filter(p => p.categories.includes(category as any));
  }

  resolveDependencies(pluginIds: string[]): string[] {
    const resolved: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving plugin ${id}`);
      }
      
      visiting.add(id);
      const plugin = this.get(id);
      if (!plugin) {
        throw new Error(`Plugin ${id} not found`);
      }

      for (const dep of plugin.dependencies) {
        visit(dep);
      }

      visiting.delete(id);
      visited.add(id);
      resolved.push(id);
    };

    for (const id of pluginIds) {
      visit(id);
    }

    return resolved;
  }
}

export class OrchestratorImpl implements Orchestrator {
  constructor(
    private registry: PluginRegistry,
    private llmClient?: LLMClient
  ) {}

  async runPlugin(
    pluginId: string,
    input: unknown,
    context: ExtractionContext
  ): Promise<ExtractionResult> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (!plugin.canHandle(input)) {
      return {
        success: false,
        data: null,
        extractedFields: [],
        missingFields: Object.keys(plugin.outputSchema),
        ambiguousFields: [],
        confidence: 0,
        durationMs: 0,
        errors: [{ code: 'CANNOT_HANDLE', message: 'Plugin cannot handle this input type' }],
        followUpQuestions: [],
      };
    }

    const startTime = Date.now();
    try {
      const result = await plugin.extract(input, context);
      result.durationMs = Date.now() - startTime;

      // Validate if extraction succeeded
      if (result.success && result.data) {
        const validation = plugin.validate(result.data);
        if (!validation.valid) {
          result.success = false;
          result.errors.push(...validation.errors.map(e => ({
            code: 'VALIDATION_ERROR',
            message: e.message,
            field: e.path,
          })));
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        data: null,
        extractedFields: [],
        missingFields: Object.keys(plugin.outputSchema),
        ambiguousFields: [],
        confidence: 0,
        durationMs: Date.now() - startTime,
        errors: [{
          code: 'EXTRACTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }],
        followUpQuestions: [],
      };
    }
  }

  async runPipeline(
    pluginIds: string[],
    input: unknown,
    config: ExtractionConfig
  ): Promise<HandoffPackage> {
    const orderedPlugins = this.registry.resolveDependencies(pluginIds);
    const extractions: Record<string, ExtractionResult> = {};
    const extractionTimes: Record<string, Date> = {};

    const subject: SubjectProfile = {
      id: `subject_${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ExtractionContext = {
      priorExtractions: {},
      config,
      subjectProfile: subject,
      llmClient: this.llmClient,
    };

    for (const pluginId of orderedPlugins) {
      const result = await this.runPlugin(pluginId, input, {
        ...context,
        priorExtractions: { ...extractions },
      });

      extractions[pluginId] = result;
      extractionTimes[pluginId] = new Date();

      if (result.success && result.data) {
        context.priorExtractions[pluginId] = result.data;
      }
    }

    const gaps = this.identifyGaps(extractions);
    const mergedProfile = this.mergeProfile(extractions);
    const recommendations = this.generateRecommendations(gaps, mergedProfile);

    const overallConfidence = Object.values(extractions).reduce(
      (sum, r) => sum + r.confidence, 
      0
    ) / Object.values(extractions).length || 0;

    const metadata: HandoffMetadata = {
      pluginsUsed: orderedPlugins,
      extractionTimes,
      overallConfidence,
      interactionCount: 0,
    };

    return {
      schemaVersion: '1.0.0',
      handoffId: `handoff_${Date.now()}`,
      timestamp: new Date(),
      subject,
      extractions,
      mergedProfile,
      gaps,
      recommendations,
      metadata,
    };
  }

  async autoDetect(
    input: unknown,
    config: ExtractionConfig
  ): Promise<HandoffPackage> {
    // Determine which plugins can handle the input
    const applicablePlugins = this.registry.list()
      .filter(p => p.canHandle(input))
      .map(p => p.id);

    return this.runPipeline(applicablePlugins, input, config);
  }

  /** Fields that are never relevant for basic job placement and should be skipped entirely */
  private static readonly SKIPPED_FIELDS = new Set([
    'companySize',
    'benefitsPriority',
    'careerGoals',
    'industries',
    'preferredIndustries',
  ]);

  identifyGaps(extractions: Record<string, ExtractionResult>): ProfileGap[] {
    const gaps: ProfileGap[] = [];

    for (const [pluginId, result] of Object.entries(extractions)) {
      for (const field of result.missingFields) {
        if (OrchestratorImpl.SKIPPED_FIELDS.has(field)) continue;
        gaps.push({
          category: pluginId,
          field,
          importance: this.determineImportance(pluginId, field),
          reason: `Could not extract ${field} from ${pluginId}`,
          suggestedQuestion: this.generateQuestionForField(pluginId, field),
        });
      }

      for (const ambig of result.ambiguousFields) {
        if (OrchestratorImpl.SKIPPED_FIELDS.has(ambig.field)) continue;
        gaps.push({
          category: pluginId,
          field: ambig.field,
          importance: 'important',
          reason: `Ambiguous: ${ambig.reasoning}`,
          suggestedQuestion: `To clarify about ${ambig.field}: ${ambig.possibleValues?.join(' or ') || 'unknown'}?`,
        });
      }
    }

    return gaps;
  }

  generateFollowUps(gaps: ProfileGap[]): string[] {
    return gaps
      .filter(g => g.importance === 'critical' || g.importance === 'important')
      .map(g => g.suggestedQuestion);
  }

  private determineImportance(pluginId: string, field: string): 'critical' | 'important' | 'nice_to_have' {
    const criticalFields: Record<string, string[]> = {
      'demographics': ['location'],
      'experience': ['workHistory', 'skills'],
      'transportation': ['primaryMethod', 'maxCommuteTime'],
      'preferences': ['jobTypes', 'minimumPay'],
    };

    const importantFields: Record<string, string[]> = {
      'demographics': ['scheduleConstraints', 'languages'],
      'experience': ['education', 'certifications'],
      'transportation': ['vehicle', 'publicTransit'],
      'preferences': ['shiftPreference'],
    };

    for (const [cat, fields] of Object.entries(criticalFields)) {
      if (pluginId.includes(cat) && fields.includes(field)) return 'critical';
    }

    for (const [cat, fields] of Object.entries(importantFields)) {
      if (pluginId.includes(cat) && fields.includes(field)) return 'important';
    }

    return 'nice_to_have';
  }

  private generateQuestionForField(pluginId: string, field: string): string {
    const questionTemplates: Record<string, Record<string, string>> = {
      'demographics': {
        'location': 'What city and state are you looking for work in?',
        'scheduleConstraints': 'Are there any schedule constraints I should know about (childcare, school, medical appointments)?',
        'accessibilityNeeds': 'Do you have any accessibility requirements for your workplace?',
        'languages': 'What languages do you speak fluently?',
      },
      'experience': {
        'workHistory': 'Can you tell me about your previous work experience?',
        'hardSkills': 'What specific skills do you have? For example: computer skills, customer service, cooking, equipment operation, languages?',
        'softSkills': 'What are you good at? For example: being on time, working with customers, problem-solving, teamwork?',
        'education': 'What is your educational background?',
        'certifications': 'Do you have any professional certifications or licenses?',
        'achievements': 'Do you have any accomplishments you\'re proud of from previous jobs or other activities?',
      },
      'transportation': {
        'primaryMethod': 'How do you plan to get to work?',
        'vehicle': 'Do you have a reliable vehicle?',
        'maxCommuteTime': 'How far are you willing to commute?',
        'relocationWilling': 'Are you able to travel to nearby towns for work, or are you only looking in this area?',
        'commuteFlexibility': 'If a good job is a bit farther away, can you travel further, or are you strictly limited to this area?',
        'publicTransit': 'Do you take the bus or train to get around?',
      },
      'preferences': {
        'jobTypes': 'Are you looking for full-time, part-time, or contract work?',
        'minimumPay': 'What is the minimum pay you need to make ends meet?',
        'shiftPreference': 'What shifts are you available to work?',
        'learningWillingness': 'Are you open to learning new skills on the job or doing something different than you\'ve always done?',
      },
    };

    for (const [category, questions] of Object.entries(questionTemplates)) {
      if (pluginId.includes(category) && questions[field]) {
        return questions[field];
      }
    }

    return `Can you provide more information about ${field}?`;
  }

  private mergeProfile(extractions: Record<string, ExtractionResult>): JobSeekerProfile {
    const profile: JobSeekerProfile = {
      demographics: {
        location: { city: '', state: '', zipCode: '' },
        accessibilityNeeds: [],
        scheduleConstraints: [],
        languages: [],
      },
      experience: {
        workHistory: [],
        industries: [],
        hardSkills: [],
        softSkills: [],
        certifications: [],
        education: [],
        achievements: [],
      },
      transportation: {
        primaryMethod: 'mixed',
        availableMethods: [],
        maxCommuteTime: { value: 30, unit: 'minutes' },
        commuteFlexibility: 'some',
        relocationWilling: false,
      },
      preferences: {
        jobTypes: ['full_time'],
        preferredIndustries: [],
        avoidedIndustries: [],
        minimumPay: { amount: 0, period: 'hour' },
        workEnvironment: 'no_preference',
        shiftPreference: ['day'],
        benefitsPriority: [],
        learningWillingness: true,
      },
      constraints: {},
    };

    // Merge demographics
    const demoResult = extractions['demographics-extractor'];
    if (demoResult?.success && demoResult.data) {
      const demo = demoResult.data as any;
      if (demo.location) profile.demographics.location = demo.location;
      if (demo.accessibilityNeeds) profile.demographics.accessibilityNeeds = demo.accessibilityNeeds;
      if (demo.scheduleConstraints) profile.demographics.scheduleConstraints = demo.scheduleConstraints;
      if (demo.languages) profile.demographics.languages = demo.languages;
      if (demo.household) profile.demographics.household = demo.household;
      if (demo.housingStatus) profile.demographics.housingStatus = demo.housingStatus;
    }

    // Merge experience
    const expResult = extractions['experience-extractor'];
    if (expResult?.success && expResult.data) {
      const exp = expResult.data as any;
      if (exp.workHistory) profile.experience.workHistory = exp.workHistory;
      if (exp.industries) profile.experience.industries = exp.industries;
      if (exp.hardSkills) profile.experience.hardSkills = exp.hardSkills;
      if (exp.softSkills) profile.experience.softSkills = exp.softSkills;
      if (exp.certifications) profile.experience.certifications = exp.certifications;
      if (exp.education) profile.experience.education = exp.education;
      if (exp.achievements) profile.experience.achievements = exp.achievements;
      if (exp.totalYearsExperience) profile.experience.totalYearsExperience = exp.totalYearsExperience;
      if (exp.summary) profile.experience.summary = exp.summary;
    }

    // Merge transportation
    const transResult = extractions['transportation-extractor'];
    if (transResult?.success && transResult.data) {
      const trans = transResult.data as any;
      if (trans.primaryMethod) profile.transportation.primaryMethod = trans.primaryMethod;
      if (trans.availableMethods) profile.transportation.availableMethods = trans.availableMethods;
      if (trans.vehicle) profile.transportation.vehicle = trans.vehicle;
      if (trans.publicTransit) profile.transportation.publicTransit = trans.publicTransit;
      if (trans.maxCommuteTime) profile.transportation.maxCommuteTime = trans.maxCommuteTime;
      if (trans.preferredCommuteTime) profile.transportation.preferredCommuteTime = trans.preferredCommuteTime;
      if (trans.commuteFlexibility) profile.transportation.commuteFlexibility = trans.commuteFlexibility;
      if (typeof trans.relocationWilling === 'boolean') profile.transportation.relocationWilling = trans.relocationWilling;
      if (trans.relocationConstraints) profile.transportation.relocationConstraints = trans.relocationConstraints;
    }

    // Merge preferences
    const prefResult = extractions['preferences-extractor'];
    if (prefResult?.success && prefResult.data) {
      const pref = prefResult.data as any;
      if (pref.jobTypes) profile.preferences.jobTypes = pref.jobTypes;
      if (pref.preferredIndustries) profile.preferences.preferredIndustries = pref.preferredIndustries;
      if (pref.avoidedIndustries) profile.preferences.avoidedIndustries = pref.avoidedIndustries;
      if (pref.minimumPay) profile.preferences.minimumPay = pref.minimumPay;
      if (pref.targetPay) profile.preferences.targetPay = pref.targetPay;
      if (pref.workEnvironment) profile.preferences.workEnvironment = pref.workEnvironment;
      if (pref.shiftPreference) profile.preferences.shiftPreference = pref.shiftPreference;
      if (pref.companySize) profile.preferences.companySize = pref.companySize;
      if (pref.benefitsPriority) profile.preferences.benefitsPriority = pref.benefitsPriority;
      if (pref.careerGoals) profile.preferences.careerGoals = pref.careerGoals;
      if (typeof pref.learningWillingness === 'boolean') profile.preferences.learningWillingness = pref.learningWillingness;
    }

    // Merge constraints (can come from any plugin)
    for (const [pluginId, result] of Object.entries(extractions)) {
      if (result?.success && result.data) {
        const data = result.data as any;
        if (data.constraints) {
          profile.constraints = { ...profile.constraints, ...data.constraints };
        }
      }
    }

    return profile;
  }

  private generateRecommendations(gaps: ProfileGap[], profile: JobSeekerProfile): any[] {
    const recommendations = [];

    // Critical gap recommendations
    const criticalGaps = gaps.filter(g => g.importance === 'critical');
    if (criticalGaps.length > 0) {
      recommendations.push({
        action: `Address ${criticalGaps.length} critical data gaps before job search`,
        priority: 'high',
        rationale: 'Missing critical information will severely limit job matching',
        agentType: 'intake-coordinator',
        estimatedEffort: '15-30 minutes',
      });
    }

    // Resume builder recommendation
    if (profile.experience.workHistory.length > 0) {
      recommendations.push({
        action: 'Generate optimized resume based on extracted experience',
        priority: 'high',
        rationale: 'Ready-to-use resume will accelerate applications',
        agentType: 'resume-builder',
        estimatedEffort: '5 minutes',
      });
    }

    // Job board search recommendation
    if (profile.demographics.location.city && profile.preferences.jobTypes?.length > 0) {
      recommendations.push({
        action: `Search job boards for ${profile.preferences.jobTypes.join(', ')} positions in ${profile.demographics.location.city}`,
        priority: 'high',
        rationale: 'Location and job type are sufficient for initial job search',
        agentType: 'job-searcher',
        estimatedEffort: '10 minutes',
      });
    }

    // Transportation filter recommendation
    if (profile.transportation.maxCommuteTime.value > 0) {
      recommendations.push({
        action: `Filter jobs within ${profile.transportation.maxCommuteTime.value} ${profile.transportation.maxCommuteTime.unit} commute`,
        priority: 'medium',
        rationale: 'Transportation constraints limit viable job pool',
        agentType: 'job-searcher',
        estimatedEffort: '2 minutes',
      });
    }

    // Skills gap recommendation
    if (profile.experience.hardSkills.length < 3) {
      recommendations.push({
        action: 'Identify transferable skills from non-work experiences',
        priority: 'medium',
        rationale: 'Low skill visibility may miss matching opportunities',
        agentType: 'skills-assessor',
        estimatedEffort: '10 minutes',
      });
    }

    return recommendations;
  }

  async generateIntelligentFollowUps(
    transcript: string,
    extractions: Record<string, ExtractionResult>,
    config: ExtractionConfig
  ): Promise<string[]> {
    if (!this.llmClient) {
      // Fallback to basic template-based questions if no LLM available
      const gaps = this.identifyGaps(extractions);
      return this.generateFollowUps(gaps);
    }

    const lang = config.language || 'en';
    const languageName: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'zh': 'Chinese',
      'ar': 'Arabic',
    };
    const languageInstruction = lang === 'en' ? '' : `Ask the questions in ${languageName[lang] || lang}.`;

    // Build a summary of what was extracted
    const extractedSummary: Record<string, any> = {};
    for (const [pluginId, result] of Object.entries(extractions)) {
      if (result.success && result.data) {
        extractedSummary[pluginId] = result.data;
      } else {
        extractedSummary[pluginId] = { success: false, errors: result.errors.map(e => e.message) };
      }
    }

    const systemPrompt = `You are a job placement intake assistant having a friendly conversation with a job seeker. Generate 1-3 simple, natural follow-up questions to fill in missing information. Questions should be conversational, clear, and easy to answer. Avoid awkward phrasing or combining multiple questions into one. Return ONLY a JSON array of question strings.`;

    const userPrompt = (() => {
      if (lang === 'es') {
        return `Entrevista en español:
${transcript}

Información extraída:
${JSON.stringify(extractedSummary, null, 2)}

IMPORTANTE: Piensa y escribe DIRECTAMENTE en español desde el principio. NO generes preguntas en inglés y luego las traduzcas. Escribe como si fueras un hablante nativo de español.

Genera 1-3 preguntas de seguimiento simples, CORTAS y naturales para llenar información faltante. Las preguntas deben sonar como una conversación casual, no como un formulario oficial.

Buenas preguntas (naturales en español):
- "¿Dónde has trabajado antes?"
- "¿Qué tipo de trabajo buscas?"
- "¿Tienes experiencia con clientes?"
- "¿Cuántos años de experiencia tienes?"
- "¿Sabes usar algún programa de computadora?"
- "¿Hasta dónde puedes viajar en bus o tren para llegar al trabajo?"
- "¿Cuántos minutos de viaje te parecen bien?"

Malas preguntas (NO hagas esto - suenan como traducciones del inglés):
- "¿Cuántos años dependes y qué tipo de cliente eres?" (no tiene sentido en español)
- "¿Puedes proporcionar más información sobre tu experiencia laboral?" (demasiado formal/amplio)
- "¿Cuál es tu método de transporte primario?" (suena robótico)
- "¿Cuánto tiempo estarías dispuesta a viajar en transporte público para llegar al trabajo?" (demasiado largo/formal - usa frases cortas)
- "¿Estarías dispuesta a reubicarte por el trabajo adecuado?" (suena como traducción literal)

REGLA: Si la pregunta tiene más de 10 palabras, probablemente es demasiado larga. Hazla más corta y directa.

Ejemplo de cómo simplificar:
- MAL: "¿Cuánto tiempo estarías dispuesta a viajar en transporte público para llegar al trabajo?" (15 palabras)
- BIEN: "¿Hasta dónde puedes viajar en bus o tren?" (8 palabras)
- MEJOR: "¿Cuántos minutos de viaje te parecen bien?" (7 palabras)

Devuelve SOLO un array JSON de strings en español:`;
      }
      if (lang === 'fr') {
        return `Entretien en français:
${transcript}

Informations extraites:
${JSON.stringify(extractedSummary, null, 2)}

IMPORTANT: Pensez et écrivez DIRECTEMENT en français dès le début. NE générez PAS de questions en anglais puis ne les traduisez pas. Écrivez comme si vous étiez un locuteur natif du français.

Génère 1-3 questions de suivi simples et naturelles pour combler les informations manquantes.

Bonnes questions (naturelles en français):
- "Où avez-vous travaillé auparavant?"
- "Quel type de travail recherchez-vous?"
- "Avez-vous de l'expérience avec les clients?"
- "Combien d'années d'expérience avez-vous?"
- "Savez-vous utiliser des logiciels informatiques?"

Mauvaises questions (NE faites PAS cela - elles sonnent comme des traductions de l'anglais):
- "Combien d'années dépendez-vous et quel type de client êtes-vous?" (n'a pas de sens en français)
- "Pouvez-vous fournir plus d'informations sur votre expérience professionnelle?" (trop formel/large)
- "Quel est votre mode de transport principal?" (sonne robotique)
- "Combien de temps seriez-vous disposée à voyager en transport public pour arriver au travail?" (trop long/formel)

RÈGLE: Si la question a plus de 10 mots, elle est probablement trop longue. Rendez-la plus courte et directe.

Exemple de simplification:
- MAUVAIS: "Combien de temps seriez-vous disposée à voyager en transport public pour arriver au travail?" (15 mots)
- BON: "Jusqu'où pouvez-vous voyager en bus ou train?" (8 mots)
- MIEUX: "Combien de minutes de trajet vous semblent bien?" (8 mots)

Retourne UNIQUEMENT un array JSON de strings en français:`;
      }
      if (lang === 'de') {
        return `Interview auf Deutsch:
${transcript}

Extrahierte Informationen:
${JSON.stringify(extractedSummary, null, 2)}

WICHTIG: Denken und schreiben Sie DIREKT auf Deutsch von Anfang an. Generieren Sie KEINE Fragen auf Englisch und übersetzen Sie sie dann nicht. Schreiben Sie, als wären Sie ein deutscher Muttersprachler.

Generiere 1-3 einfache und natürliche Folgefragen, um fehlende Informationen zu ergänzen.

Gute Fragen (natürlich auf Deutsch):
- "Wo haben Sie vorher gearbeitet?"
- "Welche Art von Arbeit suchen Sie?"
- "Haben Sie Erfahrung mit Kunden?"
- "Wie viele Jahre Erfahrung haben Sie?"
- "Können Sie mit Computerprogrammen umgehen?"

Schlechte Fragen (NICHT so machen - sie klingen wie Übersetzungen aus dem Englischen):
- "Wie viele Jahre hängen Sie ab und welche Art von Kunde sind Sie?" (macht keinen Sinn auf Deutsch)
- "Können Sie mehr Informationen über Ihre Berufserfahrung bereitstellen?" (zu formell/breit)
- "Was ist Ihre primäre Transportmethode?" (klingt robotisch)
- "Wie lange wären Sie bereit, mit öffentlichen Verkehrsmitteln zur Arbeit zu fahren?" (zu lang/formell)

REGEL: Wenn die Frage mehr als 10 Wörter hat, ist sie wahrscheinlich zu lang. Machen Sie sie kürzer und direkter.

Beispiel zur Vereinfachung:
- SCHLECHT: "Wie lange wären Sie bereit, mit öffentlichen Verkehrsmitteln zur Arbeit zu fahren?" (13 Wörter)
- GUT: "Wie weit können Sie mit Bus oder Bahn fahren?" (9 Wörter)
- BESSER: "Wie viele Minuten Fahrt sind für Sie okay?" (8 Wörter)

Gib NUR ein JSON-Array von Strings auf Deutsch zurück:`;
      }
      return `Interview transcript:
${transcript}

Extracted information:
${JSON.stringify(extractedSummary, null, 2)}

Generate 1-3 simple, natural follow-up questions in English to fill missing information.

Good questions:
- "Where have you worked before?"
- "What type of job are you looking for?"
- "Do you have experience working with customers?"
- "How many years of experience do you have?"
- "Can you use any computer programs?"

Bad questions (DON'T do this):
- "How many years do you depend on and what kind of customer you are?" (confusing)
- "Can you provide more information about your work experience and skills?" (too broad)
- "What is your primary transportation method?" (sounds robotic)
- "How long would you be willing to travel on public transportation to get to work?" (too long/formal)

RULE: If the question has more than 10 words, it's probably too long. Make it shorter and more direct.

Example of simplification:
- BAD: "How long would you be willing to travel on public transportation to get to work?" (15 words)
- GOOD: "How far can you travel by bus or train?" (9 words)
- BETTER: "How many minutes of commute is okay for you?" (9 words)

Return ONLY a JSON array of English question strings:`;
    })();

    try {
      const result = await this.llmClient.complete({
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        maxTokens: 512,
        timeoutMs: config.timeoutMs,
      });

      const parsed = extractJSONFromLLMResponse(result.text);
      if (Array.isArray(parsed)) {
        return parsed.filter(q => typeof q === 'string');
      }

      // Fallback if we can't parse JSON array
      return [];
    } catch (error) {
      console.error('[Note: Using template-based questions due to API issue]');
      const gaps = this.identifyGaps(extractions);
      return this.generateFollowUps(gaps);
    }
  }
}

export function createDefaultRegistry(): PluginRegistry {
  return new PluginRegistryImpl();
}

export function createOrchestrator(registry: PluginRegistry, llmClient?: LLMClient): Orchestrator {
  return new OrchestratorImpl(registry, llmClient);
}
