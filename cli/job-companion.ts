#!/usr/bin/env node
/**
 * Job Hunting Companion CLI
 * Extract structured job seeker information from transcripts, conversations, or direct input
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import {
  registerAllPlugins,
} from '../src/plugins/index.js';
import {
  createOrchestrator,
} from '../src/core/index.js';
import {
  ExtractionConfig,
} from '../src/types/index.js';
import {
  LLMClient,
  OpenAICompatibleClient,
  AnthropicClient,
  probeLanguageSupport,
} from '../src/llm/index.js';

function createLLMClient(options: any): LLMClient | undefined {
  const provider = options.provider || process.env.LLM_PROVIDER || 'openai';
  const apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const model = options.model || process.env.LLM_MODEL || 'gpt-4o-mini';
  const baseUrl = options.baseUrl || process.env.LLM_BASE_URL;

  if (!apiKey && provider !== 'mock') {
    console.error('Warning: No LLM API key provided. Falling back to heuristic extraction (low quality).');
    console.error('Set --provider, --api-key, --model or use env vars: LLM_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY');
    return undefined;
  }

  switch (provider.toLowerCase()) {
    case 'openai':
    case 'groq':
    case 'together':
    case 'ollama':
      return new OpenAICompatibleClient({
        apiKey,
        model,
        baseUrl,
      });
    case 'anthropic':
    case 'claude':
      return new AnthropicClient({
        apiKey,
        model,
        baseUrl,
      });
    case 'opencode':
    case 'zen': {
      const zenBaseUrl = baseUrl || 'https://opencode.ai/zen/v1';
      // Claude models on OpenCode use the Anthropic /messages endpoint
      if (model.toLowerCase().startsWith('claude')) {
        return new AnthropicClient({
          apiKey,
          model,
          baseUrl: zenBaseUrl,
        });
      }
      // Kimi, GPT, and other OpenAI-compatible models use /chat/completions
      return new OpenAICompatibleClient({
        apiKey,
        model,
        baseUrl: zenBaseUrl,
      });
    }
    default:
      console.error(`Unknown provider: ${provider}. Using OpenAI-compatible.`);
      return new OpenAICompatibleClient({ apiKey, model, baseUrl });
  }
}

const program = new Command();

program
  .name('job-companion')
  .description('Extract structured job seeker data for placement assistance')
  .version('1.0.0');

program
  .command('extract')
  .description('Extract structured data from a conversation transcript or text file')
  .argument('<input>', 'Input file path or "-" for stdin')
  .option('-p, --plugins <plugins...>', 'Specific plugins to run', ['demographics-extractor', 'experience-extractor', 'transportation-extractor', 'preferences-extractor'])
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <format>', 'Output format (json, yaml, markdown)', 'json')
  .option('--pretty', 'Pretty print JSON output', true)
  .option('-l, --language <lang>', 'Language for extraction', 'en')
  .option('--confidence', 'Include confidence scores', true)
  .option('--flag-ambiguity', 'Flag ambiguous information', true)
  .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
  .option('--follow-ups', 'Generate follow-up questions for gaps', true)
  .option('--provider <provider>', 'LLM provider (openai, anthropic, groq, ollama, opencode)', process.env.LLM_PROVIDER || 'openai')
  .option('--api-key <key>', 'LLM API key', process.env.LLM_API_KEY)
  .option('--model <model>', 'LLM model name', process.env.LLM_MODEL || 'gpt-4o-mini')
  .option('--base-url <url>', 'LLM API base URL (for proxies/local models)', process.env.LLM_BASE_URL)
  .option('--probe', 'Probe LLM language support before extraction (for non-English)', false)
  .action(async (input: string, options: any) => {
    try {
      // Setup LLM client once
      const llmClient = createLLMClient(options);

      // Optional language probe
      if (options.probe && options.language !== 'en' && llmClient) {
        console.error(`Probing ${options.model} for ${options.language} support...`);
        const probeResult = await probeLanguageSupport(llmClient, options.language);
        console.error(`Probe matched ${probeResult.foundValues.length}/${probeResult.totalValues} facts (${(probeResult.hitRate * 100).toFixed(0)}%).`);
        if (!probeResult.supported) {
          console.error(`Warning: ${options.model} may not reliably support ${options.language}.`);
          console.error('Consider using a different model (claude-sonnet, gpt-4o, kimi-k2.5).');
        } else {
          console.error(`Language probe passed: ${options.model} supports ${options.language}.`);
        }
      }

      // Read input
      let text: string;
      if (input === '-') {
        const chunks: Buffer[] = [];
        process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
        await new Promise(resolve => process.stdin.on('end', resolve));
        text = Buffer.concat(chunks).toString('utf-8');
      } else {
        text = await fs.readFile(path.resolve(input), 'utf-8');
      }

      // Configure extraction
      const config: ExtractionConfig = {
        language: options.language,
        includeConfidence: options.confidence,
        flagAmbiguity: options.flagAmbiguity,
        maxDepth: 3,
        timeoutMs: parseInt(options.timeout),
      };

      const registry = registerAllPlugins();
      const orchestrator = createOrchestrator(registry, llmClient);

      console.error(`Running extraction pipeline: ${options.plugins.join(', ')}...`);
      
      const handoff = await orchestrator.runPipeline(
        options.plugins,
        text,
        config
      );

      // Format output
      let output: string;
      switch (options.format) {
        case 'yaml':
          output = JSON.stringify(handoff, null, 2); // TODO: Add yaml library
          break;
        case 'markdown':
          output = formatAsMarkdown(handoff);
          break;
        default:
          output = options.pretty 
            ? JSON.stringify(handoff, null, 2) 
            : JSON.stringify(handoff);
      }

      // Write or print output
      if (options.output) {
        await fs.writeFile(path.resolve(options.output), output, 'utf-8');
        console.error(`Output written to ${options.output}`);
      } else {
        console.log(output);
      }

      // Print summary to stderr
      printSummary(handoff, options.language);

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('prompts')
  .description('Print LLM prompt templates for manual use in ChatGPT, Gemini, etc.')
  .option('-p, --plugin <plugin>', 'Specific plugin prompt to print')
  .option('--json-schema', 'Include JSON schema in output', false)
  .action(async (options: any) => {
    const registry = registerAllPlugins();
    const plugins = options.plugin 
      ? [registry.get(options.plugin)].filter(Boolean)
      : registry.list();

    for (const plugin of plugins) {
      if (!plugin) continue;
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`PLUGIN: ${plugin.name} (${plugin.id})`);
      console.log(`${'='.repeat(60)}\n`);
      
      console.log('SYSTEM PROMPT:');
      console.log(plugin.promptTemplate.systemPrompt);
      console.log('\n---\n');
      
      console.log('USER PROMPT TEMPLATE:');
      console.log(plugin.promptTemplate.userPrompt);
      console.log('\n---\n');
      
      console.log('OUTPUT FORMAT:', plugin.promptTemplate.outputFormat);
      console.log('TEMPERATURE:', plugin.promptTemplate.temperature);
      
      if (options.jsonSchema) {
        console.log('\nJSON SCHEMA:');
        console.log(JSON.stringify(plugin.outputSchema, null, 2));
      }
      
      if (plugin.promptTemplate.examples && plugin.promptTemplate.examples.length > 0) {
        console.log('\nEXAMPLES:');
        for (const example of plugin.promptTemplate.examples) {
          console.log('INPUT:', example.input);
          console.log('OUTPUT:', example.output);
          if (example.explanation) console.log('EXPLANATION:', example.explanation);
          console.log('---');
        }
      }
    }
  });

program
  .command('schema')
  .description('Print JSON schema for a plugin output')
  .argument('<plugin>', 'Plugin ID')
  .action(async (pluginId: string) => {
    const registry = registerAllPlugins();
    const plugin = registry.get(pluginId);
    
    if (!plugin) {
      console.error(`Plugin ${pluginId} not found. Available plugins:`);
      for (const p of registry.list()) {
        console.error(`  - ${p.id}: ${p.name}`);
      }
      process.exit(1);
    }
    
    console.log(JSON.stringify(plugin.outputSchema, null, 2));
  });

program
  .command('handoff')
  .description('Generate a handoff package from existing extractions')
  .argument('<extractions-file>', 'JSON file with extraction results')
  .option('-o, --output <file>', 'Output file')
  .action(async (file: string, options: any) => {
    const content = await fs.readFile(path.resolve(file), 'utf-8');
    const extractions = JSON.parse(content);
    
    const registry = registerAllPlugins();
    const orchestrator = createOrchestrator(registry);
    
    const gaps = orchestrator.identifyGaps(extractions);
    const followUps = orchestrator.generateFollowUps(gaps);
    
    const handoff = {
      schemaVersion: '1.0.0',
      handoffId: `handoff_${Date.now()}`,
      timestamp: new Date().toISOString(),
      gaps,
      followUpQuestions: followUps,
      extractions,
    };
    
    const output = JSON.stringify(handoff, null, 2);
    
    if (options.output) {
      await fs.writeFile(path.resolve(options.output), output);
      console.error(`Handoff written to ${options.output}`);
    } else {
      console.log(output);
    }
  });

program
  .command('probe')
  .description('Test if the configured LLM supports a target language for extraction')
  .option('-l, --language <lang>', 'Language code to test (es, fr, de, zh, ar, etc.)', 'es')
  .option('--provider <provider>', 'LLM provider (openai, anthropic, groq, ollama, opencode)', process.env.LLM_PROVIDER || 'openai')
  .option('--api-key <key>', 'LLM API key', process.env.LLM_API_KEY)
  .option('--model <model>', 'LLM model name', process.env.LLM_MODEL || 'gpt-4o-mini')
  .option('--base-url <url>', 'LLM API base URL', process.env.LLM_BASE_URL)
  .option('-v, --verbose', 'Show raw LLM response and match details', false)
  .action(async (options: any) => {
    const client = createLLMClient(options);
    if (!client) {
      console.error('Error: No LLM client configured. Set --api-key or LLM_API_KEY.');
      process.exit(1);
    }

    console.error(`Probing ${client.providerName}/${options.model} for ${options.language} support...`);

    try {
      const result = await probeLanguageSupport(client, options.language, options.verbose);

      // Always print the match rate so users can see what happened
      console.error(`Matched ${result.foundValues.length}/${result.totalValues} expected facts (${(result.hitRate * 100).toFixed(0)}%).`);

      if (options.verbose) {
        if (result.parseError) {
          console.error(`Parse error: ${result.parseError}`);
        }
        console.error(`Raw response:\n${result.rawResponse}`);
      }

      if (result.supported) {
        console.log(`YES — ${options.model} supports ${options.language} for structured extraction.`);
        process.exit(0);
      } else {
        console.log(`NO — ${options.model} does not reliably support ${options.language}.`);
        console.error('Suggestion: Try a different model (claude-sonnet, gpt-4o, kimi-k2.5) or provider.');
        if (!options.verbose) {
          console.error('Tip: Run with --verbose to see the raw LLM response.');
        }
        process.exit(1);
      }
    } catch (error) {
      console.error('Probe failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function printHelp(lang: string = 'en'): void {
  const helps: Record<string, string> = {
    'en': `
--- Intake Commands ---
/help     - Show this help message
/status   - Show current extracted profile (run /extract first)
/extract  - Run extraction on what you've said so far and show status
/done     - Run extraction, show follow-up questions, and finish
/clear    - Clear the current transcript and start over

How it works:
1. Type or dictate everything you want to share (paragraphs, multiple topics)
2. Type /done when you're ready
3. The system extracts all information and shows what's missing
4. Answer the follow-up questions (in your language) to fill gaps
5. Type /done again when finished
-----------------------\n`,
    'es': `
--- Comandos de Entrevista ---
/help     - Mostrar este mensaje de ayuda
/status   - Mostrar perfil extraído (ejecuta /extract primero)
/extract  - Ejecutar extracción y mostrar estado
/done     - Ejecutar extracción, mostrar preguntas, y finalizar
/clear    - Borrar la transcripción y empezar de nuevo

Cómo funciona:
1. Escribe o dicta todo lo que quieras compartir
2. Escribe /done cuando estés listo
3. El sistema extrae la información y muestra lo que falta
4. Responde las preguntas de seguimiento (en tu idioma)
5. Escribe /done de nuevo cuando termines
-----------------------\n`,
  };
  console.error(helps[lang] || helps['en']);
}

function printLiveStatus(handoff: any, lang: string = 'en'): void {
  const p = handoff.mergedProfile;
  const liveProfileLabel = lang === 'es' ? '--- Perfil en Vivo ---' : '--- Live Profile ---';
  console.error(`\n${liveProfileLabel}`);
  if (p.demographics?.location?.city) {
    const locationLabel = lang === 'es' ? 'Ubicación' : 'Location';
    console.error(`${locationLabel}: ${p.demographics.location.city}, ${p.demographics.location.state}`);
  }
  if (p.demographics?.languages?.length) {
    const languagesLabel = lang === 'es' ? 'Idiomas' : 'Languages';
    console.error(`${languagesLabel}: ${p.demographics.languages.join(', ')}`);
  }
  if (p.experience?.workHistory?.length > 0) {
    const workHistoryLabel = lang === 'es' ? 'Historial Laboral:' : 'Work History:';
    console.error(workHistoryLabel);
    for (const job of p.experience.workHistory) {
      const unknownLabel = lang === 'es' ? 'Desconocido' : 'Unknown';
      console.error(`  - ${job.title || unknownLabel} at ${job.employer || unknownLabel}`);
    }
  }
  if (p.experience?.hardSkills?.length) {
    const skillsLabel = lang === 'es' ? 'Habilidades' : 'Skills';
    console.error(`${skillsLabel}: ${p.experience.hardSkills.join(', ')}`);
  }
  if (p.transportation?.primaryMethod) {
    const transportLabel = lang === 'es' ? 'Transporte' : 'Transport';
    console.error(`${transportLabel}: ${p.transportation.primaryMethod}`);
  }
  if (p.preferences?.minimumPay?.amount > 0) {
    const minPayLabel = lang === 'es' ? 'Pago Mínimo' : 'Min Pay';
    console.error(`${minPayLabel}: $${p.preferences.minimumPay.amount}/${p.preferences.minimumPay.period}`);
  }
  const gaps = handoff.gaps || [];
  const critical = gaps.filter((g: any) => g.importance === 'critical').length;
  const gapsLabel = lang === 'es' ? 'Vacíos' : 'Gaps';
  const criticalLabel = lang === 'es' ? 'críticos' : 'critical';
  console.error(`${gapsLabel}: ${gaps.length} total (${critical} ${criticalLabel})`);
  if (gaps.length > 0 && gaps.length <= 5) {
    for (const gap of gaps) {
      if (gap.importance === 'critical') {
        console.error(`  [CRITICAL] ${gap.suggestedQuestion}`);
      }
    }
  }
  console.error('--------------------\n');
}

function formatAsMarkdown(handoff: any): string {
  const p = handoff.mergedProfile;
  let md = `# Job Seeker Profile: ${handoff.subject?.displayName || 'Anonymous'}\n\n`;
  md += `**Handoff ID:** ${handoff.handoffId}  \n`;
  md += `**Generated:** ${new Date(handoff.timestamp).toLocaleString()}  \n`;
  md += `**Confidence:** ${(handoff.metadata?.overallConfidence * 100).toFixed(0)}%  \n\n`;
  
  md += `## Demographics\n\n`;
  md += `- **Location:** ${p.demographics?.location?.city}, ${p.demographics?.location?.state}\n`;
  md += `- **Languages:** ${p.demographics?.languages?.join(', ') || 'Not specified'}\n`;
  md += `- **Accessibility Needs:** ${p.demographics?.accessibilityNeeds?.join(', ') || 'None noted'}\n`;
  if (p.demographics?.household) {
    md += `- **Household:** ${p.demographics.household.adults} adult(s)`;
    if (p.demographics.household.children) md += `, ${p.demographics.household.children} child(ren)`;
    md += `\n`;
  }
  
  md += `\n## Work Experience\n\n`;
  if (p.experience?.workHistory?.length > 0) {
    for (const job of p.experience.workHistory) {
      md += `### ${job.title} at ${job.employer}\n`;
      md += `- **Period:** ${job.startDate} - ${job.endDate || 'Present'}\n`;
      md += `- **Responsibilities:** ${job.responsibilities?.join(', ') || 'Not detailed'}\n`;
      md += `- **Skills Used:** ${job.skillsUsed?.join(', ') || 'Not detailed'}\n\n`;
    }
  } else {
    md += `*No work history extracted*\n\n`;
  }
  
  md += `**Skills:** ${p.experience?.hardSkills?.join(', ') || 'None extracted'}  \n`;
  md += `**Industries:** ${p.experience?.industries?.join(', ') || 'None extracted'}\n\n`;
  
  md += `## Transportation\n\n`;
  md += `- **Primary Method:** ${p.transportation?.primaryMethod || 'Unknown'}\n`;
  md += `- **Max Commute:** ${p.transportation?.maxCommuteTime?.value} ${p.transportation?.maxCommuteTime?.unit}\n`;
  md += `- **Commute Flexibility:** ${p.transportation?.commuteFlexibility || 'Unknown'}\n`;
  md += `- **Willing to Relocate:** ${p.transportation?.relocationWilling ? 'Yes' : 'No'}\n`;
  if (p.transportation?.vehicle) {
    md += `- **Vehicle:** ${p.transportation.vehicle.hasVehicle ? 'Yes' : 'No'}`;
    if (p.transportation.vehicle.reliability) md += ` (${p.transportation.vehicle.reliability})`;
    md += `\n`;
  }
  
  md += `\n## Job Preferences\n\n`;
  md += `- **Job Types:** ${p.preferences?.jobTypes?.join(', ') || 'Not specified'}\n`;
  md += `- **Work Environment:** ${p.preferences?.workEnvironment || 'Not specified'}\n`;
  md += `- **Shift Preference:** ${p.preferences?.shiftPreference?.join(', ') || 'Not specified'}\n`;
  md += `- **Minimum Pay:** $${p.preferences?.minimumPay?.amount}/${p.preferences?.minimumPay?.period || 'hour'}\n`;
  if (p.preferences?.targetPay) {
    md += `- **Target Pay:** $${p.preferences.targetPay.min}-${p.preferences.targetPay.max}/${p.preferences.targetPay.period}\n`;
  }
  md += `- **Benefits Priority:** ${p.preferences?.benefitsPriority?.join(', ') || 'Not specified'}\n`;
  md += `- **Willing to Learn New Skills:** ${p.preferences?.learningWillingness ? 'Yes' : 'No'}\n`;
  
  md += `\n## Gaps & Follow-Up Questions\n\n`;
  if (handoff.gaps?.length > 0) {
    for (const gap of handoff.gaps) {
      md += `- **${gap.importance.toUpperCase()}** [${gap.category}]: ${gap.suggestedQuestion}\n`;
    }
  } else {
    md += `*No critical gaps identified*\n`;
  }
  
  md += `\n## Recommendations\n\n`;
  if (handoff.recommendations?.length > 0) {
    for (const rec of handoff.recommendations) {
      md += `- **${rec.priority.toUpperCase()}:** ${rec.action} (${rec.agentType})\n`;
    }
  }
  
  return md;
}

function printSummary(handoff: any, lang: string = 'en'): void {
  const extractions = handoff.extractions || {};
  const totalPlugins = Object.keys(extractions).length;
  const successful = Object.values(extractions).filter((e: any) => e.success).length;
  const gaps = handoff.gaps || [];
  const criticalGaps = gaps.filter((g: any) => g.importance === 'critical').length;
  
  if (lang === 'es') {
    console.error(`\n--- Resumen de Extracción ---`);
    console.error(`Plugins ejecutados: ${totalPlugins}`);
    console.error(`Exitosos: ${successful}/${totalPlugins}`);
    console.error(`Confianza general: ${(handoff.metadata?.overallConfidence * 100).toFixed(0)}%`);
    console.error(`Vacíos identificados: ${gaps.length} (${criticalGaps} críticos)`);
    console.error(`------------------------\n`);
  } else {
    console.error(`\n--- Extraction Summary ---`);
    console.error(`Plugins run: ${totalPlugins}`);
    console.error(`Successful: ${successful}/${totalPlugins}`);
    console.error(`Overall confidence: ${(handoff.metadata?.overallConfidence * 100).toFixed(0)}%`);
    console.error(`Gaps identified: ${gaps.length} (${criticalGaps} critical)`);
    console.error(`------------------------\n`);
  }
}

program
  .command('intake')
  .description('Interactive intake mode - type or dictate in real-time with live extraction')
  .option('-p, --plugins <plugins...>', 'Specific plugins to run', ['demographics-extractor', 'experience-extractor', 'transportation-extractor', 'preferences-extractor'])
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <format>', 'Output format (json, yaml, markdown)', 'json')
  .option('--pretty', 'Pretty print JSON output', true)
  .option('-l, --language <lang>', 'Language for extraction', 'en')
  .option('--confidence', 'Include confidence scores', true)
  .option('--flag-ambiguity', 'Flag ambiguous information', true)
  .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
  .option('--follow-ups', 'Generate follow-up questions for gaps', true)
  .option('--voice-mode', 'Optimize prompts for voice/dictation input', false)
  .option('--provider <provider>', 'LLM provider (openai, anthropic, groq, ollama, opencode)', process.env.LLM_PROVIDER || 'openai')
  .option('--api-key <key>', 'LLM API key', process.env.LLM_API_KEY)
  .option('--model <model>', 'LLM model name', process.env.LLM_MODEL || 'gpt-4o-mini')
  .option('--base-url <url>', 'LLM API base URL (for proxies/local models)', process.env.LLM_BASE_URL)
  .option('--probe', 'Probe LLM language support before extraction (for non-English)', false)
  .action(async (options: any) => {
    // Setup LLM client once
    const llmClient = createLLMClient(options);

    // Optional language probe
    if (options.probe && options.language !== 'en' && llmClient) {
      console.error(`Probing ${options.model} for ${options.language} support...`);
      const probeResult = await probeLanguageSupport(llmClient, options.language);
      console.error(`Probe matched ${probeResult.foundValues.length}/${probeResult.totalValues} facts (${(probeResult.hitRate * 100).toFixed(0)}%).`);
      if (!probeResult.supported) {
        console.error(`Warning: ${options.model} may not reliably support ${options.language}.`);
        console.error('Consider using a different model (claude-sonnet, gpt-4o, kimi-k2.5).');
      } else {
        console.error(`Language probe passed: ${options.model} supports ${options.language}.`);
      }
    }

    const config: ExtractionConfig = {
      language: options.language,
      includeConfidence: options.confidence,
      flagAmbiguity: options.flagAmbiguity,
      maxDepth: 3,
      timeoutMs: parseInt(options.timeout),
    };

    const registry = registerAllPlugins();
    const orchestrator = createOrchestrator(registry, llmClient);

    const lang = config.language || 'en';
    const welcomeTexts: Record<string, string[]> = {
      'en': [
        '=== Job Companion Intake Mode ===',
        'Type or dictate your information. The system will process everything at the end.',
        'Commands: /done - finish and process, /extract - show what we have so far, /clear - reset, /help - help',
        'Press Enter twice (blank line) to start a new paragraph.\n',
        'To begin: Tell me about yourself — where you live, your work experience, and what kind of job you are looking for.\n',
      ],
      'es': [
        '=== Modo de Entrevista - Búsqueda de Empleo ===',
        'Escribe o dicta tu información. El sistema procesará todo al final.',
        'Comandos: /done - finalizar y procesar, /extract - ver lo que tenemos, /clear - borrar, /help - ayuda',
        'Presiona Enter dos veces (línea en blanco) para un nuevo párrafo.\n',
        'Para empezar: Cuéntame sobre ti — dónde vives, tu experiencia laboral, y qué tipo de trabajo buscas.\n',
      ],
    };
    const welcome = welcomeTexts[lang] || welcomeTexts['en'];
    for (const line of welcome) {
      console.error(line);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !!process.stdin.isTTY,
      prompt: '> ',
    });

    let fullTranscript = '';
    let paragraphBuffer: string[] = [];
    let handoff: any = null;
    let isExtracting = false;
    let isClosed = false;
    let inFollowUpLoop = false;
    let lastExtractedTranscript = '';
    let pendingQuestions: string[] = [];
    let currentQuestionIndex = 0;

    const safePrompt = () => {
      if (!isClosed) {
        try {
          rl.prompt();
        } catch {
          // Ignore prompt errors after close
        }
      }
    };

    const showNextQuestion = () => {
      if (currentQuestionIndex < pendingQuestions.length) {
        const qNum = currentQuestionIndex + 1;
        const total = pendingQuestions.length;
        const prefix = lang === 'es' ? 'Pregunta' : 'Question';
        console.error(`\n${prefix} ${qNum} of ${total}: ${pendingQuestions[currentQuestionIndex]}\n`);
      } else {
        const msg = lang === 'es'
          ? '\n✅ ¡Todas las preguntas respondidas! Escribe /done para finalizar.\n'
          : '\n✅ All questions answered! Type /done to finish.\n';
        console.error(msg);
      }
    };

    const runFullExtraction = async (text: string) => {
      if (isExtracting) return;
      isExtracting = true;
      const analyzingMsg = lang === 'es' ? '\n[analizando...]' : '\n[analyzing...]';
      console.error(analyzingMsg);

      try {
        const result = await orchestrator.runPipeline(options.plugins, text, config);
        handoff = result;
        lastExtractedTranscript = text;

        printLiveStatus(result, lang);

        const genMsg = lang === 'es' ? '[generando preguntas de seguimiento...]' : '[generating follow-up questions...]';
        console.error(genMsg);
        const questions = await orchestrator.generateIntelligentFollowUps(text, result.extractions, config);

        if (questions.length === 0) {
          const completeMsg = lang === 'es' ? '\n¡Tu perfil parece completo! Escribe /done para finalizar.\n' : '\nYour profile looks complete! Type /done to finish.\n';
          console.error(completeMsg);
          return;
        }

        // Enter conversational follow-up mode
        inFollowUpLoop = true;
        pendingQuestions = questions;
        currentQuestionIndex = 0;
        showNextQuestion();

      } catch (error) {
        console.error('Extraction error:', error instanceof Error ? error.message : error);
      } finally {
        isExtracting = false;
      }
    };

    const processFollowUpAnswer = async (answer: string) => {
      if (isExtracting) return;
      isExtracting = true;

      fullTranscript += '\n' + answer;
      currentQuestionIndex++;

      const processingMsg = lang === 'es' ? '\n[procesando respuesta...]' : '\n[processing answer...]';
      console.error(processingMsg);

      try {
        // Re-extract with the new answer
        const result = await orchestrator.runPipeline(options.plugins, fullTranscript, config);
        handoff = result;
        lastExtractedTranscript = fullTranscript;

        // Generate new questions based on updated info
        const questions = await orchestrator.generateIntelligentFollowUps(fullTranscript, result.extractions, config);

        if (questions.length === 0) {
          const completeMsg = lang === 'es'
            ? '\n✅ ¡Excelente! Tu perfil está completo. Escribe /done para finalizar.\n'
            : '\n✅ Great! Your profile is complete. Type /done to finish.\n';
          console.error(completeMsg);
          inFollowUpLoop = false;
          pendingQuestions = [];
          return;
        }

        // Update pending questions with new ones
        pendingQuestions = questions;
        if (currentQuestionIndex >= pendingQuestions.length) {
          currentQuestionIndex = 0;
        }
        showNextQuestion();

      } catch (error) {
        console.error('Extraction error:', error instanceof Error ? error.message : error);
      } finally {
        isExtracting = false;
      }
    };

    rl.prompt();

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();

      if (trimmed === '/done') {
        if (inFollowUpLoop) {
          // User is done with follow-ups, close and output
          isClosed = true;
          rl.close();
          return;
        }

        // Flush buffer and run extraction
        if (paragraphBuffer.length > 0) {
          const chunk = paragraphBuffer.join('\n');
          fullTranscript += (fullTranscript ? '\n' : '') + chunk;
          paragraphBuffer = [];
        }

        if (fullTranscript.trim().length === 0) {
          const msg = lang === 'es' ? 'No se capturó transcripción. Nada para extraer.\n' : 'No transcript captured. Nothing to extract.\n';
          console.error(msg);
          safePrompt();
          return;
        }

        // Wait for any ongoing extraction to complete
        if (isExtracting) {
          const waitingMsg = lang === 'es' ? '[esperando extracción anterior...]' : '[waiting for previous extraction...]';
          console.error(waitingMsg);
          while (isExtracting) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        await runFullExtraction(fullTranscript);
        safePrompt();
        return;
      }

      if (trimmed === '/help') {
        printHelp(lang);
        safePrompt();
        return;
      }

      if (trimmed === '/status') {
        if (handoff) {
          printLiveStatus(handoff, lang);
        } else {
          const msg = lang === 'es' ? 'No hay datos extraídos todavía. Escribe texto y luego /done para procesar.\n' : 'No data extracted yet. Add some text and then type /done to process.\n';
          console.error(msg);
        }
        safePrompt();
        return;
      }

      if (trimmed === '/extract') {
        // Flush buffer and run extraction without follow-up loop
        if (paragraphBuffer.length > 0) {
          const chunk = paragraphBuffer.join('\n');
          fullTranscript += (fullTranscript ? '\n' : '') + chunk;
          paragraphBuffer = [];
        }
        if (fullTranscript.trim().length > 0) {
          console.error('\n[running extraction...]');
          try {
            isExtracting = true;
            handoff = await orchestrator.runPipeline(options.plugins, fullTranscript, config);
            lastExtractedTranscript = fullTranscript;
            printLiveStatus(handoff, lang);
          } catch (error) {
            console.error('Extraction failed:', error instanceof Error ? error.message : error);
          } finally {
            isExtracting = false;
          }
        } else {
          const msg = lang === 'es' ? 'No hay texto para extraer todavía.\n' : 'No transcript to extract yet.\n';
          console.error(msg);
        }
        safePrompt();
        return;
      }

      if (trimmed === '/clear') {
        fullTranscript = '';
        paragraphBuffer = [];
        handoff = null;
        inFollowUpLoop = false;
        lastExtractedTranscript = '';
        const msg = lang === 'es' ? 'Transcripción borrada.\n' : 'Transcript cleared.\n';
        console.error(msg);
        safePrompt();
        return;
      }

      if (trimmed.length === 0) {
        // Blank line: flush buffer to create a paragraph break
        const hadPendingText = paragraphBuffer.length > 0;
        if (hadPendingText) {
          const chunk = paragraphBuffer.join('\n');
          fullTranscript += (fullTranscript ? '\n' : '') + chunk;
          paragraphBuffer = [];
        }

        // If we just flushed a paragraph, run quick extraction
        const transcriptChanged = fullTranscript.trim() !== lastExtractedTranscript.trim();
        if (hadPendingText &&
            transcriptChanged &&
            !isExtracting &&
            !inFollowUpLoop) {
          const quickExtractionMsg = lang === 'es' ? '\n[extracción rápida...]' : '\n[running quick extraction...]';
          console.error(quickExtractionMsg);
          try {
            isExtracting = true;
            handoff = await orchestrator.runPipeline(options.plugins, fullTranscript, config);
            lastExtractedTranscript = fullTranscript;
            printLiveStatus(handoff, lang);

            // Generate follow-up questions
            const genMsg = lang === 'es' ? '[generando preguntas de seguimiento...]' : '[generating follow-up questions...]';
            console.error(genMsg);
            const questions = await orchestrator.generateIntelligentFollowUps(fullTranscript, handoff.extractions, config);

            if (questions.length > 0) {
              // Enter conversational follow-up mode
              inFollowUpLoop = true;
              pendingQuestions = questions;
              currentQuestionIndex = 0;
              showNextQuestion();
            } else {
              const continueMsg = lang === 'es'
                ? '\n[Continúa escribiendo o escribe /done para finalizar]'
                : '\n[Continue typing, or type /done to finish]';
              console.error(continueMsg);
            }
          } catch (error) {
            console.error('Extraction failed:', error instanceof Error ? error.message : error);
          } finally {
            isExtracting = false;
          }
        }
        safePrompt();
        return;
      }

      if (inFollowUpLoop) {
        // This is a follow-up answer — process it and show next question
        await processFollowUpAnswer(trimmed);
        safePrompt();
        return;
      }

      paragraphBuffer.push(trimmed);
      safePrompt();
    });

    rl.on('close', async () => {
      isClosed = true;
      const intakeCompleteMsg = lang === 'es' ? '\n--- Entrevista Completada ---' : '\n--- Intake Complete ---';
      console.error(intakeCompleteMsg);
      // Flush any remaining buffer
      if (paragraphBuffer.length > 0) {
        fullTranscript += (fullTranscript ? '\n' : '') + paragraphBuffer.join('\n');
      }

      if (!handoff && fullTranscript.trim().length > 0) {
        const finalExtractionMsg = lang === 'es' ? '[ejecutando extracción final...]' : '[running final extraction...]';
        console.error(finalExtractionMsg);
        try {
          isExtracting = true;
          handoff = await orchestrator.runPipeline(options.plugins, fullTranscript, config);
          lastExtractedTranscript = fullTranscript;
        } catch (error) {
          console.error('Final extraction failed:', error instanceof Error ? error.message : error);
        } finally {
          isExtracting = false;
        }
      }

      if (handoff) {
        printSummary(handoff, lang);

        let output: string;
        switch (options.format) {
          case 'yaml':
            output = JSON.stringify(handoff, null, 2);
            break;
          case 'markdown':
            output = formatAsMarkdown(handoff);
            break;
          default:
            output = options.pretty
              ? JSON.stringify(handoff, null, 2)
              : JSON.stringify(handoff);
        }

        if (options.output) {
          await fs.writeFile(path.resolve(options.output), output, 'utf-8');
          const outputWrittenMsg = lang === 'es' ? `Salida guardada en ${options.output}` : `Output written to ${options.output}`;
          console.error(outputWrittenMsg);
        } else {
          console.log(output);
        }
      } else {
        const noTranscriptMsg = lang === 'es' ? 'No se capturó transcripción. Nada para extraer.' : 'No transcript captured. Nothing to extract.';
        console.error(noTranscriptMsg);
      }

      process.exit(0);
    });
  });

program
  .command('search <handoff>')
  .description('Search Craigslist for jobs matching a handoff profile')
  .option('-n, --limit <number>', 'Max number of results to show', '10')
  .option('-o, --output <file>', 'Save results to file')
  .option('--json', 'Output raw JSON instead of formatted table')
  .option('--preferred-employers', 'Also search preferred employers job sites')
  .action(async (handoffPath: string, options: any) => {
    try {
      const { searchCraigslist } = await import('../src/skills/craigslist-search.js');
      const jobs: any[] = await searchCraigslist(handoffPath);

      // Search preferred employers if flag is set
      if (options.preferredEmployers) {
        const { searchPreferredEmployers } = await import('../src/skills/employer-search.js');
        const employerJobs = await searchPreferredEmployers(handoffPath);
        jobs.push(...employerJobs);
        // Re-sort combined list by score
        jobs.sort((a, b) => (b.score || 0) - (a.score || 0));
      }

      const limit = parseInt(options.limit);
      const topJobs = jobs.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify(topJobs, null, 2));
      } else {
        console.error(`\n=== Top ${topJobs.length} Job Matches ===\n`);
        for (let i = 0; i < topJobs.length; i++) {
          const job = topJobs[i];
          const score = job.score > 0 ? `+${job.score}` : `${job.score}`;
          console.error(`${i + 1}. [${score}] ${job.title}`);
          if (job.location) console.error(`   📍 ${job.location}`);
          if (job.commuteMinutes !== undefined) {
            const commuteStatus = job.commuteFeasible ? '🚌' : '🚫';
            console.error(`   ${commuteStatus} ${job.commuteMinutes} min transit, ${job.commuteDistance} mi`);
          }
          if (job.description) {
            const snippet = job.description.substring(0, 120).replace(/\s+/g, ' ');
            console.error(`   ${snippet}...`);
          }
          console.error(`   🔗 ${job.url}`);
          console.error('');
        }
      }

      if (options.output) {
        await fs.writeFile(path.resolve(options.output), JSON.stringify(jobs, null, 2), 'utf-8');
        console.error(`\nFull results saved to ${options.output}`);
      }
    } catch (error) {
      console.error('Search failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('add-employer')
  .description('Add a preferred employer that frequently hires immigrants')
  .requiredOption('--name <name>', 'Employer name (e.g., "King Soopers")')
  .requiredOption('--url <url>', 'URL to their job listings page')
  .requiredOption('--types <types...>', 'Job types they offer (e.g., "retail" "warehouse" "customer-service")')
  .option('--notes <notes>', 'Additional notes about the employer')
  .action(async (options: any) => {
    try {
      const { addEmployer } = await import('../src/skills/preferred-employers.js');
      const employer = addEmployer(
        options.name,
        options.url,
        options.types,
        options.notes
      );
      console.error(`✓ Added employer: ${employer.name}`);
      console.error(`  ID: ${employer.id}`);
      console.error(`  URL: ${employer.jobsUrl}`);
      console.error(`  Job types: ${employer.jobTypes.join(', ')}`);
      if (employer.notes) {
        console.error(`  Notes: ${employer.notes}`);
      }
    } catch (error) {
      console.error('Failed to add employer:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('list-employers')
  .description('List all preferred employers')
  .action(async () => {
    try {
      const { loadEmployers } = await import('../src/skills/preferred-employers.js');
      const employers = loadEmployers();
      
      if (employers.length === 0) {
        console.error('No preferred employers configured.');
        console.error('Use "add-employer" to add employers that frequently hire immigrants.');
        return;
      }
      
      console.error(`\n=== Preferred Employers (${employers.length}) ===\n`);
      for (const emp of employers) {
        console.error(`${emp.name}`);
        console.error(`  ID: ${emp.id}`);
        console.error(`  URL: ${emp.jobsUrl}`);
        console.error(`  Job types: ${emp.jobTypes.join(', ')}`);
        if (emp.notes) {
          console.error(`  Notes: ${emp.notes}`);
        }
        console.error('');
      }
    } catch (error) {
      console.error('Failed to list employers:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('remove-employer <id>')
  .description('Remove a preferred employer by ID')
  .action(async (id: string) => {
    try {
      const { removeEmployer } = await import('../src/skills/preferred-employers.js');
      const removed = removeEmployer(id);
      
      if (removed) {
        console.error(`✓ Removed employer: ${id}`);
      } else {
        console.error(`✗ Employer not found: ${id}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Failed to remove employer:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
