/**
 * Preferred Employers Management
 * Stores and manages employers that frequently hire immigrants
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface PreferredEmployer {
  id: string;
  name: string;
  jobsUrl: string;
  jobTypes: string[];
  notes?: string;
  addedAt: string;
}

const DATA_FILE = join(process.cwd(), 'data', 'preferred-employers.json');

/**
 * Load preferred employers from file
 */
export function loadEmployers(): PreferredEmployer[] {
  if (!existsSync(DATA_FILE)) {
    return [];
  }
  
  try {
    const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    return data.employers || [];
  } catch (error) {
    console.error('Error loading employers:', error);
    return [];
  }
}

/**
 * Save preferred employers to file
 */
export function saveEmployers(employers: PreferredEmployer[]): void {
  const data = { employers };
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Add a new preferred employer
 */
export function addEmployer(
  name: string,
  jobsUrl: string,
  jobTypes: string[],
  notes?: string
): PreferredEmployer {
  const employers = loadEmployers();
  
  const employer: PreferredEmployer = {
    id: `emp_${Date.now()}`,
    name,
    jobsUrl,
    jobTypes,
    notes,
    addedAt: new Date().toISOString()
  };
  
  employers.push(employer);
  saveEmployers(employers);
  
  return employer;
}

/**
 * Remove a preferred employer
 */
export function removeEmployer(id: string): boolean {
  const employers = loadEmployers();
  const filtered = employers.filter(e => e.id !== id);
  
  if (filtered.length === employers.length) {
    return false; // Not found
  }
  
  saveEmployers(filtered);
  return true;
}

/**
 * Get employer by ID
 */
export function getEmployer(id: string): PreferredEmployer | undefined {
  const employers = loadEmployers();
  return employers.find(e => e.id === id);
}
