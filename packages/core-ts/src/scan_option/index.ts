/**
 * Public exports — `scan_option` module.
 *
 * Step 6 (`scan_option_select`) data model + schema validation.
 * Keep this file as a pure re-export barrel — coverage config excludes
 * `src/{star}{star}/index.ts` (vitest glob) so behavioural code lives in
 * sibling modules.
 */
export {
  MAIN_SCAN_ID,
  SCAN_OPTION_COUNT,
  SCAN_OPTION_IDS,
  SCAN_OPTION_ROLES,
  SCAN_OPTION_SLOTS,
  SCAN_OPTION_STATUSES,
  type ScanOption,
  type ScanOptionId,
  type ScanOptionRole,
  type ScanOptionSlot,
  type ScanOptionStatus,
} from './types.js';
export {
  SCAN_OPTION_CATALOGUE,
  SCAN_OPTION_CATALOGUE_SIZE,
  getMainScanOption,
  getScanOptions,
  getSecondaryScanOptions,
} from './catalogue.js';
export {
  ScanOptionValidationError,
  parseScanOption,
  parseScanOptionCatalogue,
  validateScanOption,
  validateScanOptionCatalogue,
  type ValidationFailure,
  type ValidationIssue,
  type ValidationIssueCode,
  type ValidationResult,
  type ValidationSuccess,
} from './schema.js';
export {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_DURATION_MS,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_TOTAL_STAGES,
  createScanAnimation,
  getScanAnimationStage,
  isScanAnimationComplete,
  startScanAnimation,
  tickScanAnimation,
  useScanAnimation,
  type ScanAnimationController,
  type ScanAnimationListener,
  type ScanAnimationPhase,
  type ScanAnimationScheduler,
  type ScanAnimationStage,
  type ScanAnimationStageIndex,
  type ScanAnimationState,
  type ScanAnimationUnsubscribe,
  type UseScanAnimationOptions,
} from './scan-animation.js';
export {
  SCAN_ANIMATION_AUTO_ADVANCE_MS,
  SCAN_ANIMATION_COMPONENT_TEST_ID,
  renderScanAnimationComponent,
  scanAnimationAutoAdvanceSignal,
  type ScanAnimationComponentViewModel,
  type ScanAnimationStageItemViewModel,
  type ScanAnimationStageStatus,
} from './scan-animation-component.js';
