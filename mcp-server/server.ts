/**
 * MCP Server for Job Hunting Companion
 * Provides Model Context Protocol integration for Claude Desktop and other MCP clients
 * 
 * Usage with Claude Desktop:
 * 1. Build: npx tsc mcp-server/server.ts
 * 2. Add to claude_desktop_config.json:
 *    {
 *      "mcpServers": {
 *        "job-companion": {
 *          "command": "node",
 *          "args": ["/path/to/dist/mcp-server/server.js"]
 *        }
 *      }
 *    }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  registerAllPlugins,
} from '../src/plugins/index.js';
import {
  createOrchestrator,
} from '../src/core/index.js';
import {
  ExtractionConfig,
} from '../src/types/index.js';

const registry = registerAllPlugins();
const orchestrator = createOrchestrator(registry);

const server = new Server(
  {
    name: 'job-hunting-companion',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'extract_job_seeker_profile',
        description: 'Extract structured job seeker information from conversation text. Returns demographics, experience, transportation, and preferences.',
        inputSchema: {
          type: 'object',
          properties: {
            conversation: {
              type: 'string',
              description: 'Conversation transcript or text from job seeker',
            },
            plugins: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific extractors to run. Default runs all: demographics-extractor, experience-extractor, transportation-extractor, preferences-extractor',
            },
            language: {
              type: 'string',
              description: 'Language code (default: en)',
            },
          },
          required: ['conversation'],
        },
      },
      {
        name: 'identify_profile_gaps',
        description: 'Analyze extracted profile data and identify missing information that would help job hunting agents.',
        inputSchema: {
          type: 'object',
          properties: {
            extractions: {
              type: 'object',
              description: 'Previous extraction results from extract_job_seeker_profile',
            },
          },
          required: ['extractions'],
        },
      },
      {
        name: 'generate_follow_up_questions',
        description: 'Generate natural follow-up questions to fill gaps in a job seeker profile.',
        inputSchema: {
          type: 'object',
          properties: {
            gaps: {
              type: 'array',
              items: { type: 'object' },
              description: 'Gaps array from identify_profile_gaps',
            },
            maxQuestions: {
              type: 'number',
              description: 'Maximum number of questions to generate (default: 5)',
            },
          },
          required: ['gaps'],
        },
      },
      {
        name: 'get_prompt_template',
        description: 'Get an LLM prompt template for manual use in other systems (ChatGPT, Gemini, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            plugin: {
              type: 'string',
              description: 'Plugin ID (demographics-extractor, experience-extractor, transportation-extractor, preferences-extractor)',
            },
            includeSchema: {
              type: 'boolean',
              description: 'Include JSON schema in output',
            },
          },
          required: ['plugin'],
        },
      },
      {
        name: 'merge_to_handoff',
        description: 'Merge multiple extraction results into a standardized handoff package for job hunting agents.',
        inputSchema: {
          type: 'object',
          properties: {
            extractions: {
              type: 'object',
              description: 'Object with plugin IDs as keys and extraction results as values',
            },
            subjectName: {
              type: 'string',
              description: 'Optional display name for the job seeker',
            },
            helperNotes: {
              type: 'string',
              description: 'Optional notes from the person conducting the intake',
            },
          },
          required: ['extractions'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'extract_job_seeker_profile': {
      const conversation = args?.conversation as string;
      const plugins = (args?.plugins as string[]) || [
        'demographics-extractor',
        'experience-extractor', 
        'transportation-extractor',
        'preferences-extractor',
      ];
      const language = (args?.language as string) || 'en';

      const config: ExtractionConfig = {
        language,
        includeConfidence: true,
        flagAmbiguity: true,
        maxDepth: 3,
        timeoutMs: 30000,
      };

      const handoff = await orchestrator.runPipeline(plugins, conversation, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              extractions: handoff.extractions,
              mergedProfile: handoff.mergedProfile,
              gaps: handoff.gaps,
              recommendations: handoff.recommendations,
              confidence: handoff.metadata.overallConfidence,
            }, null, 2),
          },
        ],
      };
    }

    case 'identify_profile_gaps': {
      const extractions = args?.extractions as Record<string, any>;
      const gaps = orchestrator.identifyGaps(extractions);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ gaps }, null, 2),
          },
        ],
      };
    }

    case 'generate_follow_up_questions': {
      const gaps = args?.gaps as any[];
      const maxQuestions = (args?.maxQuestions as number) || 5;
      
      const allQuestions = orchestrator.generateFollowUps(gaps);
      const questions = allQuestions.slice(0, maxQuestions);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ questions, totalAvailable: allQuestions.length }, null, 2),
          },
        ],
      };
    }

    case 'get_prompt_template': {
      const pluginId = args?.plugin as string;
      const includeSchema = args?.includeSchema as boolean;
      
      const plugin = registry.get(pluginId);
      if (!plugin) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Plugin ${pluginId} not found. Available: ${registry.list().map(p => p.id).join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      const output: any = {
        plugin: plugin.id,
        name: plugin.name,
        systemPrompt: plugin.promptTemplate.systemPrompt,
        userPrompt: plugin.promptTemplate.userPrompt,
        outputFormat: plugin.promptTemplate.outputFormat,
        temperature: plugin.promptTemplate.temperature,
      };

      if (includeSchema) {
        output.jsonSchema = plugin.outputSchema;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    }

    case 'merge_to_handoff': {
      const extractions = args?.extractions as Record<string, any>;
      const subjectName = args?.subjectName as string;
      const helperNotes = args?.helperNotes as string;

      const gaps = orchestrator.identifyGaps(extractions);
      const followUps = orchestrator.generateFollowUps(gaps);
      
      // Build a merged profile from the extractions
      const handoff = await orchestrator.runPipeline(
        Object.keys(extractions),
        '', // We already have extractions
        {
          language: 'en',
          includeConfidence: true,
          flagAmbiguity: true,
          maxDepth: 1,
          timeoutMs: 10000,
        }
      );

      // Override with provided extractions
      const finalHandoff = {
        ...handoff,
        extractions,
        gaps,
        recommendations: handoff.recommendations,
        metadata: {
          ...handoff.metadata,
          helperNotes: helperNotes || undefined,
        },
      };

      if (subjectName) {
        finalHandoff.subject = { ...finalHandoff.subject, displayName: subjectName };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(finalHandoff, null, 2),
          },
        ],
      };
    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
