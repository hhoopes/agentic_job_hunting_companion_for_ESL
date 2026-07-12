# Using with ChatGPT / OpenAI

This example shows how to use the Job Hunting Companion schemas and prompts with OpenAI's API.

## Setup

```bash
npm install openai zod
```

## Extract Demographics with Function Calling

```typescript
import OpenAI from 'openai';
import { DemographicsSchema } from 'job-hunting-companion/schemas';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const conversation = `
  Hi, I'm looking for work. My name is Jamal and I live in Columbus, Ohio. 
  I have a 5-year-old son and I need to be home by 6pm to pick him up. 
  I speak English. I don't have any accessibility needs.
`;

// Convert Zod schema to JSON Schema for OpenAI
const jsonSchema = DemographicsSchema.toJSONSchema();

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'system',
      content: `You are an intake assistant for a job placement service. Extract structured demographic and personal information from a conversation with a job seeker. Return valid JSON matching the requested schema.`,
    },
    {
      role: 'user',
      content: conversation,
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'demographics_extraction',
      schema: jsonSchema,
      strict: true,
    },
  },
});

const extracted = JSON.parse(response.choices[0].message.content);
console.log('Extracted demographics:', extracted);
```

## Extract Experience with Structured Outputs

```typescript
import { ExperienceSchema } from 'job-hunting-companion/schemas';

const experienceConversation = `
  I've worked at Amazon warehouse for 3 years as a fulfillment associate. 
  I operate forklifts and do inventory management. Before that I worked at 
  McDonald's for a year as a crew member. I have a high school diploma 
  and a forklift certification from OSHA.
`;

const expSchema = ExperienceSchema.toJSONSchema();

const expResponse = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'Extract work experience, skills, and education.' },
    { role: 'user', content: experienceConversation },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'experience_extraction',
      schema: expSchema,
      strict: true,
    },
  },
});

const experience = JSON.parse(expResponse.choices[0].message.content);
console.log('Extracted experience:', experience);
```

## Validate and Merge

```typescript
import { JobHuntingCompanion } from 'job-hunting-companion';

const companion = new JobHuntingCompanion();

// Validate each extraction
const demoValidation = companion.getPlugin('demographics-extractor')?.validate(extracted);
const expValidation = companion.getPlugin('experience-extractor')?.validate(experience);

console.log('Demographics valid:', demoValidation?.valid);
console.log('Experience valid:', expValidation?.valid);

// Build handoff package from multiple LLM calls
const handoff = await companion.extractWithPlugins(
  experienceConversation, // In practice you'd pass the conversation to each plugin
  ['demographics-extractor', 'experience-extractor']
);

console.log('Handoff package:', JSON.stringify(handoff, null, 2));
```

## Tips for ChatGPT Usage

1. **Use JSON Schema mode** (gpt-4o and later) for guaranteed valid output
2. **Set temperature to 0.1** for deterministic extraction
3. **Break into multiple calls** if the conversation is long (one per plugin)
4. **Validate output** with our Zod schemas before using
5. **Handle missing fields** gracefully - not all conversations will have complete info

## Using with GPT-3.5

For older models without JSON schema mode, use the prompt templates with explicit JSON format instructions:

```typescript
const prompt = `
Extract structured information from this conversation.
Return ONLY valid JSON. Do not include any other text.

${conversation}

JSON Schema:
${JSON.stringify(DemographicsSchema.toJSONSchema(), null, 2)}
`;

const response = await openai.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [
    { role: 'system', content: 'You are a data extraction assistant. Return only JSON.' },
    { role: 'user', content: prompt },
  ],
  temperature: 0.1,
});

// Parse and validate
const raw = response.choices[0].message.content;
const json = JSON.parse(raw);
const validation = companion.getPlugin('demographics-extractor')?.validate(json);
```
