import { JobHuntingCompanion } from 'job-hunting-companion';

async function main() {
  // Create companion instance
  const companion = new JobHuntingCompanion();

  // Example 1: Extract from a simple conversation
  const handoff = await companion.extractFromConversation(`
    Hi, I'm Maria from Austin, Texas. I've been working as a cashier 
    at Walmart for 2 years. I take the bus to work. I need at least 
    $15/hour. I'm looking for full-time work. I speak English and Spanish.
  `);

  console.log('=== EXTRACTED PROFILE ===');
  console.log(JSON.stringify(handoff.mergedProfile, null, 2));

  console.log('\n=== GAPS ===');
  for (const gap of handoff.gaps) {
    console.log(`[${gap.importance}] ${gap.category}: ${gap.suggestedQuestion}`);
  }

  console.log('\n=== RECOMMENDATIONS ===');
  for (const rec of handoff.recommendations) {
    console.log(`[${rec.priority}] ${rec.action} (${rec.agentType})`);
  }

  // Example 2: Run specific plugins only
  const transportOnly = await companion.extractWithPlugins(
    'I have a car but it needs repairs. I can commute 30 minutes.',
    ['transportation-extractor']
  );

  console.log('\n=== TRANSPORTATION ONLY ===');
  console.log(transportOnly.mergedProfile.transportation);

  // Example 3: Generate follow-up questions for gaps
  const gaps = companion.identifyGaps(handoff.extractions);
  const questions = companion.generateFollowUps(gaps);
  
  console.log('\n=== FOLLOW-UP QUESTIONS ===');
  for (const q of questions) {
    console.log(`- ${q}`);
  }

  // Example 4: Get plugins and their schemas
  const plugins = companion.getPlugins();
  for (const plugin of plugins) {
    console.log(`\nPlugin: ${plugin.name} (${plugin.id})`);
    console.log(`Categories: ${plugin.categories.join(', ')}`);
    console.log(`Description: ${plugin.description}`);
  }
}

main().catch(console.error);
