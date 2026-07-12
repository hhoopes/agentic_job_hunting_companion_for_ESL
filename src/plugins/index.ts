/**
 * Plugin Index - Registers and exports all extraction plugins
 */

import { DemographicsExtractor } from './demographics.js';
import { ExperienceExtractor } from './experience.js';
import { TransportationExtractor } from './transportation.js';
import { PreferencesExtractor } from './preferences.js';
import { PluginRegistry } from '../types/index.js';
import { createDefaultRegistry } from '../core/index.js';

export function registerAllPlugins(registry?: PluginRegistry): PluginRegistry {
  const reg = registry || createDefaultRegistry();
  
  reg.register(new DemographicsExtractor());
  reg.register(new ExperienceExtractor());
  reg.register(new TransportationExtractor());
  reg.register(new PreferencesExtractor());
  
  return reg;
}

export {
  DemographicsExtractor,
  ExperienceExtractor,
  TransportationExtractor,
  PreferencesExtractor,
};
