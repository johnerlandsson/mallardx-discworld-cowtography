// scripts/build-svg/paths.mjs
// Path constants shared across the build-svg modules.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '..', '..')

export const DEFAULT_DB    = path.join(REPO_ROOT, 'claude_resources', 'quow_cowbar', 'maps', '_quowmap_database.db')
export const OUT_DIR       = path.join(REPO_ROOT, 'ui', 'maps')
export const TYPES_CONFIG   = path.join(REPO_ROOT, 'ui', 'data', 'room-types.json')
export const COMPACT_CONFIG      = path.join(REPO_ROOT, 'ui', 'data', 'room-compact.json')
export const LARGE_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-large.json')
export const EXTRA_CLASS_CONFIG  = path.join(REPO_ROOT, 'ui', 'data', 'room-extra-classes.json')
export const WATER_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-water.json')
export const GREEN_CONFIG        = path.join(REPO_ROOT, 'ui', 'data', 'room-green.json')
export const DANGER_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-danger.json')
export const BRIDGE_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-bridge.json')
export const EXIT_EXCLUDE_CONFIG = path.join(REPO_ROOT, 'ui', 'data', 'exit-exclude.json')
export const EXIT_CLIMB_CONFIG   = path.join(REPO_ROOT, 'ui', 'data', 'exit-climb.json')
export const GROUND_CONFIG       = path.join(REPO_ROOT, 'ui', 'data', 'room-ground.json')
export const STACKS_OUT          = path.join(REPO_ROOT, 'ui', 'data', 'room-stacks.js')
