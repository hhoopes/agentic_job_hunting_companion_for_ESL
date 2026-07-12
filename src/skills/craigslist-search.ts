/**
 * Craigslist Job Search Skill
 * Searches Craigslist for jobs matching a handoff profile
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { geocode, calculateDistance, estimateTransitTime, scoreCommute } from './transit.js';

interface JobListing {
  title: string;
  url: string;
  location?: string;
  price?: string;
  description?: string;
  postedDate?: string;
  score?: number;
  commuteMinutes?: number;
  commuteDistance?: number;
  commuteFeasible?: boolean;
}

interface HandoffProfile {
  mergedProfile: {
    demographics: {
      location: {
        streetAddress?: string;
        city: string;
        state: string;
        zipCode: string;
      };
      languages: string[];
    };
    experience: {
      hardSkills: string[];
      softSkills: string[];
      industries: string[];
      workHistory: Array<{
        title: string;
        employer: string;
      }>;
    };
    transportation: {
      maxCommuteTime: {
        value: number;
        unit: string;
      };
    };
    preferences: {
      jobTypes: string[];
      minimumPay: {
        amount: number;
        period: string;
      };
      shiftPreference: string[];
      avoidedIndustries: string[];
      preferredIndustries?: string[];
    };
  };
}

/**
 * Generate search queries from handoff profile
 */
function generateSearchQueries(profile: HandoffProfile): string[] {
  const queries: string[] = [];
  
  // Extract job titles from work history
  const jobTitles = profile.mergedProfile.experience.workHistory.map(j => j.title.toLowerCase());
  
  // Extract hard skills that are job-relevant
  const skills = profile.mergedProfile.experience.hardSkills
    .filter(s => !s.includes('bilingual')) // Skip bilingual, we'll add it separately
    .map(s => s.toLowerCase());
  
  // Build queries based on experience
  if (jobTitles.includes('cashier')) queries.push('cashier');
  if (jobTitles.includes('waitress') || jobTitles.includes('server')) queries.push('server');
  if (skills.some(s => s.includes('customer service'))) queries.push('customer service');
  if (skills.some(s => s.includes('pos') || s.includes('cash register'))) queries.push('retail');
  if (skills.some(s => s.includes('food service'))) queries.push('food service');
  
  // Add bilingual query if applicable
  if (profile.mergedProfile.demographics.languages.includes('Spanish')) {
    queries.push('bilingual spanish');
  }
  
  // Add entry-level search based on preferred industries
  const preferredIndustries = profile.mergedProfile.preferences.preferredIndustries || [];
  if (preferredIndustries.length > 0) {
    // Add first 2 preferred industries as entry-level searches
    preferredIndustries.slice(0, 2).forEach(industry => {
      queries.push(`entry level ${industry}`);
    });
  }
  
  // Always add general entry-level search
  queries.push('entry level');
  
  // Deduplicate
  return [...new Set(queries)];
}

/**
 * Fetch Craigslist job listings
 */
async function fetchCraigslistJobs(query: string, zipCode: string, radius: number): Promise<JobListing[]> {
  const url = `https://denver.craigslist.org/search/jjj?query=${encodeURIComponent(query)}&search_distance=${radius}&postal=${zipCode}`;
  
  console.error(`Fetching: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }
  
  const html = await response.text();
  
  // Parse job listings from HTML
  const jobs: JobListing[] = [];
  
  // Match cl-static-search-result elements
  const jobRegex = /<li class="cl-static-search-result"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<a href="([^"]*)"[\s\S]*?<div class="title">([^<]*)<\/div>([\s\S]*?)<\/li>/g;
  
  let match;
  while ((match = jobRegex.exec(html)) !== null) {
    const title = match[3].trim();
    const url = match[2];
    const details = match[4];
    
    // Extract location if present
    const locationMatch = details.match(/<div class="location">\s*([^<]*)\s*<\/div>/);
    const location = locationMatch ? locationMatch[1].trim() : undefined;
    
    // Extract price if present
    const priceMatch = details.match(/<div class="price">([^<]*)<\/div>/);
    const price = priceMatch ? priceMatch[1].trim() : undefined;
    
    jobs.push({
      title,
      url,
      location,
      price
    });
  }
  
  return jobs;
}

/**
 * Fetch job detail page
 */
async function fetchJobDetail(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Extract description from postingbody
    const descMatch = html.match(/<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/);
    if (descMatch) {
      // Strip HTML tags
      return descMatch[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to fetch job detail: ${url}`);
    return null;
  }
}

/**
 * Score a job against profile constraints
 */
export function scoreJob(job: JobListing, profile: HandoffProfile): number {
  let score = 0;
  const title = job.title.toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const text = title + ' ' + desc;
  
  // Avoided industries (negative score)
  const avoided = profile.mergedProfile.preferences.avoidedIndustries;
  for (const industry of avoided) {
    if (text.includes(industry.toLowerCase())) {
      score -= 50;
    }
  }
  
  // Check if job matches person's actual experience
  const theirJobTitles = profile.mergedProfile.experience.workHistory.map(j => j.title.toLowerCase());
  const theirIndustries = profile.mergedProfile.experience.industries.map(i => i.toLowerCase());
  const preferredIndustries = (profile.mergedProfile.preferences.preferredIndustries || []).map(i => i.toLowerCase());
  
  // Check if this is an entry-level job
  const isEntryLevel = title.includes('entry level') || title.includes('entry-level') || 
                       title.includes('no experience') || title.includes('hiring immediately') ||
                       title.includes('will train') || title.includes('training provided');
  
  // Does the job title match any of their previous jobs?
  const titleMatchesExperience = theirJobTitles.some(theirTitle => {
    // Check if job title contains their job title (e.g., "cashier" in "Senior Cashier")
    return title.includes(theirTitle);
  });
  
  // Does the job match their industries?
  const titleMatchesIndustry = theirIndustries.some(industry => {
    // Check for industry keywords in title
    return title.includes(industry);
  });
  
  // Does the job match their preferred industries?
  const titleMatchesPreferred = preferredIndustries.some(industry => {
    return title.includes(industry) || text.includes(industry);
  });
  
  // Check for common entry-level/service job keywords that match their background
  const relevantJobTypes = [
    'cashier', 'server', 'waitress', 'waiter', 'host', 'hostess',
    'retail', 'sales associate', 'store', 'clerk',
    'customer service', 'front desk', 'receptionist',
    'food service', 'restaurant', 'cafe', 'barista',
    'housekeeper', 'housekeeping', 'cleaner',
    'warehouse', 'stocker', 'inventory',
    'cook', 'line cook', 'dishwasher', 'kitchen',
    'assembly', 'production', 'manufacturing',
    'general labor', 'laborer', 'helper'
  ];
  
  const titleMatchesRelevantType = relevantJobTypes.some(type => title.includes(type));
  
  // Scoring logic
  if (isEntryLevel) {
    // Entry-level jobs: more lenient scoring
    if (titleMatchesPreferred) {
      score += 25; // Bonus for matching preferred industry
    } else if (titleMatchesRelevantType) {
      score += 15; // Smaller bonus for relevant job type
    }
    // No heavy penalty for entry-level jobs
  } else {
    // Regular jobs: require experience match
    if (!titleMatchesExperience && !titleMatchesIndustry && !titleMatchesRelevantType) {
      score -= 100;
    } else {
      // Bonus for matching their experience
      if (titleMatchesExperience) score += 30;
      if (titleMatchesIndustry) score += 20;
      if (titleMatchesRelevantType) score += 15;
    }
  }
  
  // Preferred job types (positive score)
  const jobTypes = profile.mergedProfile.preferences.jobTypes;
  if (jobTypes.includes('full_time') && (text.includes('full time') || text.includes('full-time') || text.includes('ft'))) {
    score += 20;
  }
  if (jobTypes.includes('part_time') && (text.includes('part time') || text.includes('part-time') || text.includes('pt'))) {
    score += 10;
  }
  
  // Shift preference
  const shifts = profile.mergedProfile.preferences.shiftPreference;
  if (shifts.includes('day') && (text.includes('day shift') || text.includes('daytime') || text.includes('morning'))) {
    score += 15;
  }
  
  // Minimum pay check
  const minPay = profile.mergedProfile.preferences.minimumPay.amount;
  const payMatch = text.match(/\$(\d+)/);
  if (payMatch) {
    const pay = parseInt(payMatch[1]);
    if (pay >= minPay) {
      score += 25;
    } else {
      score -= 10;
    }
  }
  
  // Skills match
  const skills = [...profile.mergedProfile.experience.hardSkills, ...profile.mergedProfile.experience.softSkills];
  for (const skill of skills) {
    if (text.includes(skill.toLowerCase())) {
      score += 5;
    }
  }
  
  // Bilingual bonus
  if (profile.mergedProfile.demographics.languages.includes('Spanish')) {
    if (text.includes('bilingual') || text.includes('spanish')) {
      score += 30;
    }
  }
  
  return score;
}

/**
 * Main search function
 */
export async function searchCraigslist(handoffPath: string): Promise<JobListing[]> {
  // Read handoff file
  const handoffData = JSON.parse(readFileSync(handoffPath, 'utf-8')) as HandoffProfile;
  
  console.error('=== Craigslist Job Search ===');
  console.error(`Profile: ${handoffData.mergedProfile.demographics.location.city}, ${handoffData.mergedProfile.demographics.location.state}`);
  console.error(`Max commute: ${handoffData.mergedProfile.transportation.maxCommuteTime.value} ${handoffData.mergedProfile.transportation.maxCommuteTime.unit}`);
  console.error('');
  
  // Generate search queries
  const queries = generateSearchQueries(handoffData);
  console.error(`Search queries: ${queries.join(', ')}`);
  console.error('');
  
  // Fetch jobs for each query
  const allJobs: JobListing[] = [];
  const zipCode = handoffData.mergedProfile.demographics.location.zipCode;
  // Search wider than max commute - let scoring filter out unreachable jobs
  // Use 2x the theoretical max distance to ensure we don't miss good opportunities
  const maxCommuteMinutes = handoffData.mergedProfile.transportation.maxCommuteTime.value;
  const maxDistanceMiles = Math.round((maxCommuteMinutes / 60) * 18); // Max distance at bus speed
  const radius = Math.min(maxDistanceMiles * 2, 25); // 2x max distance, capped at 25 miles
  console.error(`Search radius: ${radius} miles (max commute: ${maxCommuteMinutes} min)`);
  
  for (const query of queries) {
    console.error(`Searching for: "${query}"`);
    try {
      const jobs = await fetchCraigslistJobs(query, zipCode, radius);
      console.error(`  Found ${jobs.length} jobs`);
      allJobs.push(...jobs);
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    }
    
    // Rate limiting - wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Deduplicate by URL
  const uniqueJobs = allJobs.filter((job, index, self) => 
    index === self.findIndex(j => j.url === job.url)
  );
  
  console.error(`\nTotal unique jobs: ${uniqueJobs.length}`);
  
  // Fetch details for top jobs (limit to avoid rate limiting)
  const jobsToFetch = uniqueJobs.slice(0, 10);
  console.error(`\nFetching details for ${jobsToFetch.length} jobs...`);
  
  for (const job of jobsToFetch) {
    const description = await fetchJobDetail(job.url);
    if (description) {
      job.description = description;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Score and rank jobs
  console.error('\nScoring jobs...');
  const scoredJobs = uniqueJobs.map(job => ({
    ...job,
    score: scoreJob(job, handoffData)
  }));
  
  // Sort by score (descending) for initial ranking
  scoredJobs.sort((a, b) => b.score - a.score);
  
  // Add commute scoring for top candidates
  const topCandidates = scoredJobs.slice(0, 50);
  console.error(`\nCalculating commute times for top ${topCandidates.length} candidates...`);
  
  // Build origin address
  const loc = handoffData.mergedProfile.demographics.location;
  const originAddress = loc.streetAddress 
    ? `${loc.streetAddress}, ${loc.city}, ${loc.state} ${loc.zipCode}`
    : `${loc.city}, ${loc.state} ${loc.zipCode}`;
  
  console.error(`Origin: ${originAddress}`);
  
  // Geocode origin once
  const origin = await geocode(originAddress);
  if (!origin) {
    console.error('Warning: Could not geocode origin address. Skipping commute scoring.');
  } else {
    const maxCommuteMinutes = handoffData.mergedProfile.transportation.maxCommuteTime.value;
    
    for (const job of topCandidates) {
      if (!job.location) continue;
      
      // Geocode job location
      const jobAddress = `${job.location}, ${loc.state}`;
      const destination = await geocode(jobAddress);
      
      if (!destination) {
        console.error(`  Could not geocode: ${job.location}`);
        continue;
      }
      
      // Calculate distance and transit time
      const distanceMiles = calculateDistance(origin.coordinates, destination.coordinates);
      const estimatedMinutes = estimateTransitTime(distanceMiles);
      const commuteScore = scoreCommute(estimatedMinutes, maxCommuteMinutes);
      
      // Add commute info to job
      job.commuteMinutes = estimatedMinutes;
      job.commuteDistance = Math.round(distanceMiles * 10) / 10;
      job.commuteFeasible = estimatedMinutes <= maxCommuteMinutes;
      job.score = (job.score || 0) + commuteScore;
      
      const status = job.commuteFeasible ? '✓' : '✗';
      console.error(`  ${status} ${job.location}: ${estimatedMinutes} min, ${job.commuteDistance} mi (${commuteScore > 0 ? '+' : ''}${commuteScore})`);
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Re-sort with commute scores
    scoredJobs.sort((a, b) => b.score - a.score);
  }
  
  return scoredJobs;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const handoffPath = process.argv[2];
  
  if (!handoffPath) {
    console.error('Usage: node craigslist-search.js <handoff.json>');
    process.exit(1);
  }
  
  searchCraigslist(handoffPath)
    .then(jobs => {
      console.log(JSON.stringify(jobs, null, 2));
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}
