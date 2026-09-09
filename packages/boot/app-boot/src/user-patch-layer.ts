/**
 * Context contract for the launcher's installation-level user patch layer
 * (`$DSH_HOME/cordis.patch.yml`). The launcher provides it before any
 * config-tree entry mounts; host services that persist per-entry overrides
 * resolve the write target through it instead of re-deriving home paths.
 * @module @deepseek-ai/dsh-app-boot/user-patch-layer
 */

/** The installation-level user patch layer every profile composes over. */
export interface UserPatchLayerService {
  /**
   * Absolute path of the patch-list file overrides are upserted into
   * (`join(resolveDshHome(), PROFILE_PATCH_FILENAME)`).
   */
  readonly filename: string
  /**
   * Whether live patch watching is active for this profile
   * (`composed.profile.patchReload === 'live'`): `true` means an edit to
   * `filename` re-applies onto the running tree without a restart; `false`
   * means the edit applies on the next boot only.
   */
  readonly live: boolean
}

/** Context slot the launcher fills with the installation patch-layer facts. */
export const USER_PATCH_LAYER_KEY = 'userPatchLayer'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-provided installation patch layer; absent in deployments not launched through a `dsh` profile. */
    userPatchLayer?: UserPatchLayerService
  }
}
