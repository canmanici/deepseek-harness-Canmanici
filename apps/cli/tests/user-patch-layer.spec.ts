/** The launcher-provided `userPatchLayer` service shape for the composition's host services. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROFILE_PATCH_FILENAME, USER_PATCH_LAYER_KEY } from '@deepseek-ai/dsh-app-boot'
import { userPatchLayerService } from '../src/profile-boot.ts'

const homes: string[] = []
const previousHome = process.env.DSH_HOME

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('userPatchLayerService', () => {
  it('resolves the home-level patch layer and carries the live flag', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-user-patch-layer-'))
    homes.push(home)
    process.env.DSH_HOME = home

    const live = userPatchLayerService(true)
    expect(live).toEqual({ filename: join(home, PROFILE_PATCH_FILENAME), live: true })
    expect(USER_PATCH_LAYER_KEY).toBe('userPatchLayer')

    const frozen = userPatchLayerService(false)
    expect(frozen).toEqual({ filename: join(home, PROFILE_PATCH_FILENAME), live: false })
  })
})
