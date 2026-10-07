import { describe, expect, it } from 'vitest'
import { desktopRuntimeSupportDir } from '../src/cli.ts'

describe('desktop runtime support directory', () => {
  it('finds the runtime beside an ASAR payload', () => {
    expect(desktopRuntimeSupportDir('/opt/deepseek/resources/app.asar/dsh')).toBe('/opt/deepseek/resources/runtime')
  })

  it('finds the runtime beside an archive-free Linux payload', () => {
    expect(desktopRuntimeSupportDir('/opt/deepseek/resources/app/dsh')).toBe('/opt/deepseek/resources/runtime')
  })
})
