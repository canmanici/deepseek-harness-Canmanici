/** Authenticated same-origin routes shared by the Host controller and panel. */
export const OPEN_DESIGN_STATUS_PATH = '/open-design/status'
/** Start route consumed by the OpenDesign browser panel. */
export const OPEN_DESIGN_START_PATH = '/open-design/start'

/** Phases visible while DSH prepares the optional runtime. */
export type OpenDesignRuntimePhase = 'idle' | 'downloading' | 'verifying' | 'extracting' | 'starting' | 'ready' | 'failed'

/** Current runtime-installation and Studio readiness facts. */
export interface OpenDesignRuntimeStatus {
  /** Runtime preparation or launch phase. */
  readonly phase: OpenDesignRuntimePhase
  /** Bytes downloaded during the current attempt; reset when the next start is accepted. */
  readonly bytesDownloaded: number
  /** Archive length from its HTTPS response, when supplied. */
  readonly totalBytes: number | null
  /** Loopback Studio URL after the headless runtime is ready. */
  readonly studioUrl: string | null
  /** Current actionable failure, or null until a failure occurs and after retry begins. */
  readonly error: string | null
}
