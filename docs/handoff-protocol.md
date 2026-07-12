# Handoff Protocol

The handoff protocol defines how extracted job seeker data is packaged and transferred to downstream job hunting agents.

## Handoff Package Structure

```json
{
  "schemaVersion": "1.0.0",
  "handoffId": "handoff_1234567890",
  "timestamp": "2026-07-10T12:00:00Z",
  "subject": {
    "id": "subject_1234567890",
    "displayName": "Jamal",
    "createdAt": "2026-07-10T12:00:00Z",
    "updatedAt": "2026-07-10T12:00:00Z"
  },
  "extractions": {
    "demographics-extractor": { ... },
    "experience-extractor": { ... },
    "transportation-extractor": { ... },
    "preferences-extractor": { ... }
  },
  "mergedProfile": {
    "demographics": { ... },
    "experience": { ... },
    "transportation": { ... },
    "preferences": { ... },
    "constraints": { ... }
  },
  "gaps": [
    {
      "category": "experience",
      "field": "workHistory",
      "importance": "critical",
      "reason": "Could not extract workHistory from experience-extractor",
      "suggestedQuestion": "Can you tell me about your most recent job? Where did you work and what did you do?"
    }
  ],
  "recommendations": [
    {
      "action": "Search job boards for full_time positions in Columbus",
      "priority": "high",
      "rationale": "Location and job type are sufficient for initial job search",
      "agentType": "job-searcher",
      "estimatedEffort": "10 minutes"
    }
  ],
  "metadata": {
    "pluginsUsed": ["demographics-extractor", "experience-extractor", "transportation-extractor", "preferences-extractor"],
    "extractionTimes": { ... },
    "overallConfidence": 0.75,
    "interactionCount": 1,
    "helperNotes": "Jamal seems very motivated and has good references"
  }
}
```

## Agent Types

The handoff package includes recommendations tagged with agent types:

| Agent Type | Purpose | Triggers |
|------------|---------|----------|
| `intake-coordinator` | Follow-up with job seeker | Critical gaps exist |
| `resume-builder` | Generate resume | Work history extracted |
| `job-searcher` | Search job boards | Location + job type known |
| `skills-assessor` | Identify transferable skills | Low skill visibility |
| `interview-prep` | Prepare for interviews | Applications submitted |
| `transportation-planner` | Solve commute issues | Transportation gaps |

## Integration Patterns

### Pattern 1: Direct API Call

```typescript
import { JobHuntingCompanion } from 'job-hunting-companion';

const companion = new JobHuntingCompanion();
const handoff = await companion.extractFromConversation(text);

// Send to job hunting agent
await fetch('https://your-job-agent.com/api/intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(handoff),
});
```

### Pattern 2: File-Based Handoff

```bash
# Extract and save
job-companion extract conversation.txt -o handoff.json

# Job agent reads the file
node job-agent.js --intake handoff.json
```

### Pattern 3: Message Queue

```typescript
// Publish to queue
await messageQueue.publish('job-seeker-intake', handoff);

// Job agent subscribes
messageQueue.subscribe('job-seeker-intake', async (handoff) => {
  await processJobSeeker(handoff);
});
```

### Pattern 4: MCP Server (Claude Desktop)

The MCP server enables Claude to call extraction tools and pass results to other agents within the same conversation.

## Schema Evolution

The `schemaVersion` field allows backward-compatible evolution:

- `1.0.0` - Initial release
- Future versions will add fields but not remove existing ones
- Agents should ignore unknown fields (Postel's Law)

## Validation

Job hunting agents receiving handoff packages should:

1. Validate the schema version is supported
2. Check that critical fields are present
3. Review gaps before proceeding
4. Log confidence scores for quality tracking

```typescript
function validateHandoff(handoff: HandoffPackage): boolean {
  const supportedVersions = ['1.0.0'];
  if (!supportedVersions.includes(handoff.schemaVersion)) {
    throw new Error(`Unsupported schema version: ${handoff.schemaVersion}`);
  }
  
  const criticalGaps = handoff.gaps.filter(g => g.importance === 'critical');
  if (criticalGaps.length > 5) {
    console.warn('High number of critical gaps - may need more intake');
  }
  
  return true;
}
```
