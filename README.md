# Job Hunting Companion

A plugin-based extraction system for structured job seeker information, designed to be **LLM-agnostic** so you can use it with Claude, ChatGPT, Gemini, or any other language model.

This is the companion/intake side of the Geo Job Aide project. It extracts structured data from conversations with job seekers and produces standardized handoff packages for downstream job hunting agents.

## What It Does

- **Extracts** demographics, work experience, transportation, and job preferences from natural conversation
- **Validates** all extracted data against strict Zod schemas
- **Identifies gaps** in the profile that need follow-up
- **Generates** follow-up questions to fill missing information
- **Produces** a standardized handoff package for job hunting agents
- **Works** with any LLM via prompt templates or MCP server

## Architecture

```
Input (conversation text)
    ↓
Orchestrator
    ↓
Extractor Plugins (parallel/sequential)
    ↓
Schema Validation
    ↓
Gap Analysis
    ↓
Handoff Package (JSON/Markdown)
    ↓
Job Hunting Agents
```

### Plugins

| Plugin | Extracts | Categories |
|--------|----------|------------|
| `demographics-extractor` | Location, household, schedule constraints, languages, accessibility | demographics, constraints |
| `experience-extractor` | Work history, skills, education, certifications | experience, skills, education |
| `transportation-extractor` | Commute methods, vehicle status, transit access | transportation, constraints |
| `preferences-extractor` | Job type, pay, environment, shift, benefits | preferences |

## Quick Start

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd job-hunting-skills

# Install dependencies
npm install

# Install Playwright browsers (for job scraping)
npx playwright install chromium

# Build the project
npm run build

# Set up your LLM API key (choose one)
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
# or
export LLM_API_KEY=your-key-here
```

### Basic Usage

```bash
# 1. Run interactive intake (conversational extraction)
npm run cli -- intake -l es --provider anthropic --api-key $ANTHROPIC_API_KEY --model claude-3-5-sonnet-20241022

# 2. Search for jobs matching the profile
npm run cli -- search samples/heidi-hoopes-handoff.json -n 20

# 3. Search Craigslist + preferred employers
npm run cli -- search samples/heidi-hoopes-handoff.json --preferred-employers -n 50

# 4. Manage preferred employers
npm run cli -- add-employer "King Soopers" "https://www.kroger.com/careers" retail
npm run cli -- list-employers
```

### As a Library

```typescript
import { JobHuntingCompanion } from 'job-hunting-companion';

const companion = new JobHuntingCompanion();

const handoff = await companion.extractFromConversation(`
  Hi, I'm Maria. I live in Austin, Texas. I've been working as a 
  cashier at Walmart for 2 years. I speak English and Spanish. 
  I take the bus to work. I need at least $15/hour. I'm looking 
  for full-time work. I have a high school diploma.
`);

console.log(handoff.mergedProfile);
console.log(handoff.gaps); // What info is missing
```

### CLI

```bash
# Extract from a transcript file (requires LLM API key for quality output)
npm run cli -- extract conversation.txt -o handoff.json --api-key $OPENAI_API_KEY

# Extract from stdin
npm run cli -- extract - --format markdown --provider anthropic --api-key $ANTHROPIC_API_KEY --model claude-3-5-sonnet-20241022

# Interactive intake mode (type or dictate in real-time)
npm run cli -- intake --api-key $OPENAI_API_KEY

# Intake with voice/dictation optimization and save to file
npm run cli -- intake -o handoff.json --voice-mode --api-key $OPENAI_API_KEY

# Use Groq for fast, cheap extraction
npm run cli -- intake --provider openai --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY --model llama-3.1-70b-versatile

# Use local Ollama model
npm run cli -- extract conversation.txt --provider openai --base-url http://localhost:11434/v1 --api-key ollama --model llama3.1

# Use OpenCode Zen (auto-routes to the right endpoint)
npm run cli -- probe -l es --provider opencode --api-key $ZEN_API_KEY --model kimi-k2.5
npm run cli -- intake --provider opencode --api-key $ZEN_API_KEY --model claude-sonnet-5

# Probe if your default model (gpt-4o-mini) supports Spanish
npm run cli -- probe -l es --api-key $OPENAI_API_KEY

# Probe a specific model for Spanish support
npm run cli -- probe -l es --api-key $OPENAI_API_KEY --model gpt-4o

# Auto-probe Spanish support before intake (uses default model unless --model is set)
npm run cli -- intake -l es --probe --api-key $OPENAI_API_KEY --model gpt-4o

# Get prompt templates for manual LLM use
npm run cli -- prompts --plugin demographics-extractor

# Generate JSON schema for a plugin
npm run cli -- schema demographics-extractor
```

### MCP Server (Claude Desktop)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "job-companion": {
      "command": "node",
      "args": ["/path/to/job-hunting-companion/dist/mcp-server/server.js"]
    }
  }
}
```

Available tools:
- `extract_job_seeker_profile` - Full extraction pipeline
- `identify_profile_gaps` - Analyze missing information
- `generate_follow_up_questions` - Create follow-up questions
- `get_prompt_template` - Get prompts for use in other LLMs
- `merge_to_handoff` - Package extractions for agents

## Job Search Features

The companion includes a job search system that finds relevant positions based on the extracted profile.

### Searching for Jobs

```bash
# Search Craigslist for jobs matching a profile
npm run cli -- search samples/heidi-hoopes-handoff.json -n 20

# Search Craigslist + preferred employers
npm run cli -- search samples/heidi-hoopes-handoff.json --preferred-employers -n 50

# Save results to file
npm run cli -- search samples/heidi-hoopes-handoff.json --preferred-employers -o results.json
```

### How It Works

1. **Reads the handoff profile** - Extracts location, skills, experience, transportation constraints
2. **Generates search queries** - Based on job titles, skills, and industries from the profile
3. **Searches Craigslist** - Finds jobs within the commute radius
4. **Searches preferred employers** - Scrapes job listings from configured employer sites
5. **Scores and ranks jobs** - Based on:
   - Experience match (job title, skills, industries)
   - Commute feasibility (transit time from home address)
   - Pay requirements
   - Shift preferences
6. **Returns ranked results** - Top matches with commute times and scores

### Transit Scoring

The system uses geocoding and distance calculations to estimate commute times:
- Geocodes home address and job locations using OpenStreetMap Nominatim
- Calculates straight-line distance
- Estimates transit time (assuming ~18 mph for bus transit)
- Penalizes or excludes jobs outside the max commute time

**Note:** This is a heuristic based on distance. For production use, you'd want to integrate with a real transit API like Google Maps or RTD's GTFS data.

### Preferred Employers

You can configure a list of employers that frequently hire immigrants or have good entry-level positions.

```bash
# Add a preferred employer
npm run cli -- add-employer "King Soopers" "https://www.kroger.com/careers" retail warehouse customer-service

# List all preferred employers
npm run cli -- list-employers

# Remove an employer
npm run cli -- remove-employer emp_1234567890
```

**Currently working scrapers:**
- ✅ **Craigslist** - 286 jobs found, scored, and ranked
- ✅ **Denver International Airport** - 21 jobs extracted from `.jobCard` elements
- ✅ **Walmart** - 10 jobs extracted from GraphQL API

**Blocked:**
- ⚠️ **King Soopers** - HTTP2 errors (anti-bot protection)

### Example Output

```
=== Top 10 Job Matches ===

1. [+95] Seeking Cashier / Front of House Team Members (Denver Metro Area)
   📍 Multiple locations
   🚌 25 min transit, 7.2 mi
   🔗 https://denver.craigslist.org/...

2. [+50] HIRING DISHWASHERS/FOOD PREP! $18/HR + TIPS
   📍 Westminster
   🚌 21 min transit, 3.4 mi
   🔗 https://denver.craigslist.org/...

3. [+40] $20~21 Line cook need - Immediate hire PM
   🔗 https://denver.craigslist.org/...
```

## LLM Setup

The CLI and library are **LLM-powered** — without an LLM, extraction falls back to simple regex heuristics which produce low-quality results.

### Environment Variables

```bash
export LLM_PROVIDER=openai        # openai, anthropic, groq, ollama
export LLM_API_KEY=sk-...
export LLM_MODEL=gpt-4o-mini      # or claude-3-5-sonnet-20241022, llama-3.1-70b-versatile
export LLM_BASE_URL=              # optional, for proxies or local models
```

### Supported Providers

| Provider | `--provider` | Notes |
|----------|-------------|-------|
| OpenAI | `openai` | Default. GPT-4o, GPT-4o-mini |
| Anthropic | `anthropic` | Claude 3.5 Sonnet, Claude 3 Opus |
| **OpenCode** | **`opencode`** | **Auto-routes to Zen API. Supports Kimi, Claude, GPT, etc.** |
| Groq | `openai` + `--base-url` | Very fast, cheap. Set base-url to `https://api.groq.com/openai/v1` |
| Ollama | `openai` + `--base-url` | Local models. Set base-url to `http://localhost:11434/v1` |
| Together | `openai` + `--base-url` | Set base-url to `https://api.together.xyz/v1` |

### Programmatic Usage with LLM

```typescript
import { JobHuntingCompanion, OpenAICompatibleClient } from 'job-hunting-companion';

const llm = new OpenAICompatibleClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
});

const companion = new JobHuntingCompanion(undefined, llm);
const handoff = await companion.extractFromConversation(conversationText, {
  language: 'en',
  timeoutMs: 30000,
});
```

## LLM Agnostic Usage

The core philosophy is that these are **prompt-based extractors**, not tied to any specific LLM API.

### Using with ChatGPT, Gemini, or any LLM

1. Get the prompt template:
```bash
npm run cli -- prompts --plugin demographics-extractor --json-schema
```

2. Copy the system prompt and user prompt into your LLM of choice

3. The prompt includes the JSON schema, so the LLM will return structured data matching our validation schema

4. Validate the output with our schema, then merge into a handoff package

### Example: ChatGPT Function Calling

```typescript
import { toJSONSchema } from 'job-hunting-companion/schemas';
import { DemographicsSchema } from 'job-hunting-companion/schemas';

const jsonSchema = toJSONSchema(DemographicsSchema, 'Demographics');

// Use with OpenAI function calling
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: conversationText }],
  functions: [{
    name: 'extract_demographics',
    description: 'Extract demographic information',
    parameters: jsonSchema,
  }],
});
```

### Example: Gemini with JSON Mode

```typescript
import { toJSONSchema } from 'job-hunting-companion/schemas';
import { ExperienceSchema } from 'job-hunting-companion/schemas';

const schema = toJSONSchema(ExperienceSchema, 'Experience');

const result = await gemini.generateContent({
  contents: [{ role: 'user', parts: [{ text: conversationText }] }],
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: schema,
  },
});
```

## Data Model

### Handoff Package

```typescript
interface HandoffPackage {
  schemaVersion: string;
  handoffId: string;
  timestamp: Date;
  subject: SubjectProfile;
  extractions: Record<string, ExtractionResult>;
  mergedProfile: JobSeekerProfile;
  gaps: ProfileGap[];
  recommendations: Recommendation[];
  metadata: HandoffMetadata;
}
```

### Job Seeker Profile

```typescript
interface JobSeekerProfile {
  demographics: DemographicsData;
  experience: ExperienceData;
  transportation: TransportationData;
  preferences: PreferencesData;
  constraints: ConstraintsData;
}
```

See `src/types/index.ts` for full type definitions and `src/schemas/index.ts` for Zod schemas.

## Privacy & Ethics

- **No sensitive PII storage** by default (no SSN, exact birth dates, financial account numbers, etc.)
- **Address collection** — street address and zip code are collected when provided because they are required for transit accessibility and job proximity calculations
- **Anonymized IDs** for subjects
- **Consent-aware** extraction flags
- All schemas designed with job-placement practicality in mind

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run CLI
npm run cli -- extract examples/sample-conversation.txt
```

## Project Structure

```
job-hunting-skills/
├── src/
│   ├── types/           # TypeScript interfaces
│   ├── schemas/         # Zod schemas + JSON schema generation
│   ├── core/            # Plugin registry + orchestrator + LLM extractor base class
│   ├── plugins/         # Extraction plugins (prompt templates + schemas)
│   ├── llm/             # LLM client implementations (OpenAI, Anthropic)
│   └── index.ts         # Main exports + convenience class
├── cli/                 # Command-line interface
├── mcp-server/          # Model Context Protocol server
├── examples/            # Sample conversations
└── docs/                # Documentation
```

## Roadmap

- [x] **LLM-powered extraction** (OpenAI, Anthropic, Groq, Ollama)
- [x] **Multi-language support** (Spanish, French, German, Chinese, Arabic — via LLM prompt instructions)
- [ ] Resume builder integration
- [ ] Job board search agent integration
- [ ] Interview prep agent
- [ ] Conversation history tracking
- [ ] Confidence scoring improvements
- [ ] Plugin marketplace/extensibility

## License

MIT
