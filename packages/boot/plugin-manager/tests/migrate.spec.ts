/** Profile migration planning: what crosses from one profile to another, and what stays. */

import { expect, it } from 'vitest'
import type { ProfilePluginInventory } from '@deepseek-ai/dsh-app-boot'
import { planProfilePluginMigration } from '../src/migrate.ts'

/** One inventory literal carrying the manifest shape the planner reads directly. */
function inventory(
  dependencies: Record<string, string>, bundles: readonly string[], resolved: Record<string, { version: string; bundle: boolean }> = {},
): ProfilePluginInventory {
  return {
    manifest: { dependencies, dsh: { profile: { bundles: [...bundles] } } },
    dependencies: Object.entries(dependencies).map(([name, version]) => ({
      name, version: resolved[name]?.version ?? version, bundle: resolved[name]?.bundle ?? true, enabled: bundles.includes(name),
    })),
  }
}

it('installs the source version and carries registered bundles', () => {
  const plan = planProfilePluginMigration({
    source: inventory({ alpha: '^1.2.0', beta: '2.0.0' }, ['alpha', 'beta'], { alpha: { version: '1.4.3', bundle: true }, beta: { version: '2.0.0', bundle: true } }),
    target: inventory({}, []),
    installationBundles: [],
  })
  expect(plan).toEqual({
    installs: [{ name: 'alpha', spec: 'alpha@1.4.3' }, { name: 'beta', spec: 'beta@2.0.0' }],
    enable: ['alpha', 'beta'],
    skipped: [],
  })
})

it('keeps recorded specs the registry does not own and skips what the source disables', () => {
  const plan = planProfilePluginMigration({
    source: inventory(
      { local: 'file:../local', typed: 'npm:other@^3.0.0', off: '^1.0.0' },
      ['local', 'typed'],
      { local: { version: '0.1.0', bundle: true }, typed: { version: '3.2.0', bundle: true }, off: { version: '1.0.0', bundle: true } },
    ),
    target: inventory({}, []),
    installationBundles: [],
  })
  expect(plan.installs).toEqual([{ name: 'local', spec: 'file:../local' }, { name: 'typed', spec: 'npm:other@^3.0.0' }])
  expect(plan.enable).toEqual(['local', 'typed'])
  expect(plan.skipped).toEqual([{ name: 'off', reason: 'the source profile keeps it disabled' }])
})

it('never reinstalls a target dependency and reports the packages it leaves behind', () => {
  const plan = planProfilePluginMigration({
    source: inventory({ alpha: '^1.0.0', plain: '^2.0.0' }, ['alpha', 'provided'], { alpha: { version: '1.0.0', bundle: true }, plain: { version: '2.0.0', bundle: false } }),
    target: inventory({ alpha: '^1.0.0' }, ['alpha']),
    installationBundles: ['provided'],
  })
  expect(plan.installs).toEqual([])
  expect(plan.enable).toEqual(['provided'])
  expect(plan.skipped).toEqual([
    { name: 'alpha', reason: 'already installed in the target profile' },
    { name: 'plain', reason: 'the package declares no bundle patch' },
  ])
})

it('refuses to activate a bundle this installation does not provide', () => {
  const plan = planProfilePluginMigration({
    source: inventory({}, ['ghost']),
    target: inventory({}, []),
    installationBundles: [],
  })
  expect(plan).toEqual({
    installs: [],
    enable: [],
    skipped: [{ name: 'ghost', reason: 'the package is not installed in this dsh installation' }],
  })
})
