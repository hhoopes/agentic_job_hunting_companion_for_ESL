/**
 * Transit and commute scoring module
 * Estimates commute feasibility using public transit
 */

interface Coordinates {
  lat: number;
  lon: number;
}

interface GeocodingResult {
  coordinates: Coordinates;
  displayName: string;
}

/**
 * Geocode an address using OpenStreetMap Nominatim API
 * Free, no API key required, but rate limited (1 req/sec)
 */
export async function geocode(address: string): Promise<GeocodingResult | null> {
  const encoded = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'JobHuntingCompanion/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`Geocoding failed for "${address}": ${response.status}`);
      return null;
    }
    
    const data = await response.json() as any[];
    
    if (!data || data.length === 0) {
      console.error(`No geocoding result for "${address}"`);
      return null;
    }
    
    return {
      coordinates: {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      },
      displayName: data[0].display_name
    };
  } catch (error) {
    console.error(`Geocoding error for "${address}":`, error);
    return null;
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in miles
 */
export function calculateDistance(from: Coordinates, to: Coordinates): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lon - from.lon) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Estimate transit time based on distance
 * RTD buses average ~15-20 mph including stops
 * Light rail is faster (~25-30 mph)
 * Add 10 minutes for transfers/waiting
 */
export function estimateTransitTime(distanceMiles: number, hasRail: boolean = false): number {
  const speed = hasRail ? 25 : 18; // mph
  const baseTime = (distanceMiles / speed) * 60; // minutes
  const transferTime = 10; // minutes for waiting/transfers
  return Math.round(baseTime + transferTime);
}

/**
 * Score a job based on commute feasibility
 * Returns:
 * - 0 points if commute is impossible (exceeds max time)
 * - Bonus points if commute is easy
 * - Penalty if commute is borderline
 */
export function scoreCommute(
  estimatedMinutes: number,
  maxCommuteMinutes: number
): number {
  if (estimatedMinutes > maxCommuteMinutes) {
    // Impossible commute
    return -100;
  }
  
  const ratio = estimatedMinutes / maxCommuteMinutes;
  
  if (ratio <= 0.5) {
    // Easy commute (under 50% of max)
    return 20;
  } else if (ratio <= 0.75) {
    // Reasonable commute
    return 10;
  } else if (ratio <= 0.9) {
    // Borderline commute
    return 0;
  } else {
    // Tight commute (90-100% of max)
    return -10;
  }
}

/**
 * Full commute scoring pipeline
 * Geocodes both locations and calculates transit feasibility
 */
export async function calculateCommuteScore(
  originAddress: string,
  destinationAddress: string,
  maxCommuteMinutes: number
): Promise<{
  score: number;
  estimatedMinutes: number;
  distanceMiles: number;
  feasible: boolean;
}> {
  // Geocode origin
  const origin = await geocode(originAddress);
  if (!origin) {
    return { score: 0, estimatedMinutes: 0, distanceMiles: 0, feasible: false };
  }
  
  // Rate limit: wait 1 second between geocoding requests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Geocode destination
  const destination = await geocode(destinationAddress);
  if (!destination) {
    return { score: 0, estimatedMinutes: 0, distanceMiles: 0, feasible: false };
  }
  
  // Calculate distance
  const distanceMiles = calculateDistance(origin.coordinates, destination.coordinates);
  
  // Estimate transit time
  const estimatedMinutes = estimateTransitTime(distanceMiles);
  
  // Score the commute
  const score = scoreCommute(estimatedMinutes, maxCommuteMinutes);
  
  return {
    score,
    estimatedMinutes,
    distanceMiles,
    feasible: estimatedMinutes <= maxCommuteMinutes
  };
}
