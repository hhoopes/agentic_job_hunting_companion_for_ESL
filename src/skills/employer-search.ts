/**
 * Preferred Employer Job Search
 * Scrapes job listings from preferred employer websites
 */

import { readFileSync } from 'fs';
import { loadEmployers, PreferredEmployer } from './preferred-employers.js';
import { chromium } from 'playwright';
import { scoreJob } from './craigslist-search.js';

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
  source?: string;
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
 * Search preferred employers for jobs
 */
export async function searchPreferredEmployers(handoffPath: string): Promise<JobListing[]> {
  const employers = loadEmployers();
  
  if (employers.length === 0) {
    console.error('No preferred employers configured. Use "add-employer" to add some.');
    return [];
  }
  
  console.error(`\n=== Searching ${employers.length} Preferred Employers ===\n`);
  
  const handoffData = JSON.parse(readFileSync(handoffPath, 'utf-8')) as HandoffProfile;
  const allJobs: JobListing[] = [];
  
  for (const employer of employers) {
    console.error(`Searching: ${employer.name}`);
    try {
      const jobs = await scrapeEmployer(employer, handoffData);
      console.error(`  Found ${jobs.length} jobs`);
      allJobs.push(...jobs);
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Score all employer jobs
  console.error(`\nScoring ${allJobs.length} employer jobs...`);
  for (const job of allJobs) {
    job.score = scoreJob(job, handoffData);
  }
  
  // Sort by score (descending)
  allJobs.sort((a, b) => (b.score || 0) - (a.score || 0));
  
  return allJobs;
}

/**
 * Scrape a specific employer's job listings
 */
async function scrapeEmployer(employer: PreferredEmployer, profile: HandoffProfile): Promise<JobListing[]> {
  const url = employer.jobsUrl;
  
  // Detect which employer this is and use appropriate scraper
  if (url.includes('kroger.com') || employer.name.toLowerCase().includes('king soopers')) {
    return scrapeKroger(url, employer, profile);
  } else if (url.includes('flydenver.com') || employer.name.toLowerCase().includes('airport')) {
    return scrapeDIA(url, employer, profile);
  } else if (url.includes('walmart.com') || employer.name.toLowerCase().includes('walmart')) {
    return scrapeWalmart(url, employer, profile);
  } else {
    // Generic scraper for other employers
    return scrapeGeneric(url, employer, profile);
  }
}

/**
 * Scrape Kroger/King Soopers job listings using Playwright
 */
async function scrapeKroger(url: string, employer: PreferredEmployer, profile: HandoffProfile): Promise<JobListing[]> {
  console.error(`  Fetching Kroger jobs from ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for job listings to load
    await page.waitForSelector('[class*="job"], [class*="position"], [class*="opening"]', { timeout: 10000 }).catch(() => {
      console.error('  No job listings found on page');
    });
    
    // Extract job listings
    const jobs: JobListing[] = await page.evaluate((employerName) => {
      const jobElements = document.querySelectorAll('[class*="job"], [class*="position"], [class*="opening"]');
      const results: Array<{ title: string; url: string; location?: string; source?: string }> = [];
      
      jobElements.forEach((element) => {
        const link = element.querySelector('a[href*="/careers/"], a[href*="/jobs/"]');
        const titleElement = element.querySelector('[class*="title"], [class*="name"], h2, h3');
        
        if (link && titleElement) {
          const href = link.getAttribute('href');
          const title = titleElement.textContent?.trim();
          
          if (href && title) {
            results.push({
              title: `${employerName} - ${title}`,
              url: href.startsWith('http') ? href : `https://www.kroger.com${href}`,
              location: 'Denver Metro Area',
              source: employerName
            });
          }
        }
      });
      
      return results;
    }, employer.name);
    
    return jobs;
  } catch (error) {
    console.error(`  Failed to scrape Kroger: ${error instanceof Error ? error.message : error}`);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Scrape Walmart job listings using their GraphQL API
 */
async function scrapeWalmart(url: string, employer: PreferredEmployer, profile: HandoffProfile): Promise<JobListing[]> {
  console.error(`  Fetching Walmart jobs from API`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  let jobs: JobListing[] = [];
  
  try {
    // Capture the GraphQL response with job data
    page.on('response', async (response) => {
      const responseUrl = response.url();
      if (responseUrl.includes('api/graphql')) {
        try {
          const body = await response.text();
          if (body.includes('jobSearchAssistant') && body.includes('total_jobs')) {
            const data = JSON.parse(body);
            const toolMessages = data.data?.jobSearchAssistant?.tool_messages || [];
            
            for (const msg of toolMessages) {
              if (msg.name === 'combined_hybrid_search_tool' && msg.artifact?.jobs) {
                const jobResults = msg.artifact.jobs;
                for (const job of jobResults) {
                  const title = job.jobPostingTitle || job.title || '';
                  const location = [job.city, job.state].filter(Boolean).join(', ') || 'Various locations';
                  const payInfo = job.minPay && job.maxPay 
                    ? `$${job.minPay}-${job.maxPay}/${job.payFrequency || 'hour'}`
                    : '';
                  
                  jobs.push({
                    title: `${employer.name} - ${title}`,
                    url: `https://careers.walmart.com/us/en/job/${job.job_id}`,
                    location: location,
                    source: employer.name,
                    description: `${payInfo ? payInfo + '. ' : ''}${(job.categories || []).join(', ')}. ${(job.shifts || []).join(', ')}`
                  });
                }
              }
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    });
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    console.error(`  Extracted ${jobs.length} job listings from Walmart`);
    return jobs;
  } catch (error) {
    console.error(`  Failed to scrape Walmart: ${error instanceof Error ? error.message : error}`);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Scrape Denver International Airport job listings using Playwright
 */
async function scrapeDIA(url: string, employer: PreferredEmployer, profile: HandoffProfile): Promise<JobListing[]> {
  console.error(`  Fetching DIA jobs from ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Extract job listings from jobCard elements
    const jobs: JobListing[] = await page.evaluate((employerName) => {
      const jobCards = document.querySelectorAll('.jobCard');
      const results: Array<{ title: string; url: string; location?: string; source?: string; description?: string }> = [];
      
      jobCards.forEach((card) => {
        const link = card.querySelector('a')?.href;
        const titleElement = card.querySelector('h3, h4, [class*="title"]');
        const descriptionElement = card.querySelector('p, [class*="description"]');
        
        if (link && titleElement) {
          const title = titleElement.textContent?.trim() || '';
          const description = descriptionElement?.textContent?.trim() || '';
          
          if (title) {
            results.push({
              title: `${employerName} - ${title}`,
              url: link,
              location: 'Denver International Airport',
              source: employerName,
              description: description.substring(0, 500)
            });
          }
        }
      });
      
      return results;
    }, employer.name);
    
    console.error(`  Extracted ${jobs.length} job listings from DIA`);
    return jobs;
  } catch (error) {
    console.error(`  Failed to scrape DIA: ${error instanceof Error ? error.message : error}`);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Generic employer scraper using Playwright
 */
async function scrapeGeneric(url: string, employer: PreferredEmployer, profile: HandoffProfile): Promise<JobListing[]> {
  console.error(`  Generic scraper for ${employer.name} - using Playwright`);
  console.error(`  URL: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Try to find job listings with common selectors
    await page.waitForSelector('[class*="job"], [class*="position"], [class*="opening"], [class*="career"]', { timeout: 10000 }).catch(() => {
      console.error('  No job listings found on page');
    });
    
    // Extract job listings
    const jobs: JobListing[] = await page.evaluate((employerName) => {
      const jobElements = document.querySelectorAll('[class*="job"], [class*="position"], [class*="opening"], [class*="career"]');
      const results: Array<{ title: string; url: string; location?: string; source?: string }> = [];
      
      jobElements.forEach((element) => {
        const link = element.querySelector('a[href]');
        const titleElement = element.querySelector('[class*="title"], [class*="name"], h2, h3, h4');
        
        if (link && titleElement) {
          const href = link.getAttribute('href');
          const title = titleElement.textContent?.trim();
          
          if (href && title) {
            results.push({
              title: `${employerName} - ${title}`,
              url: href.startsWith('http') ? href : '',
              location: 'Denver Metro Area',
              source: employerName
            });
          }
        }
      });
      
      return results;
    }, employer.name);
    
    return jobs;
  } catch (error) {
    console.error(`  Failed to scrape ${employer.name}: ${error instanceof Error ? error.message : error}`);
    return [];
  } finally {
    await browser.close();
  }
}
