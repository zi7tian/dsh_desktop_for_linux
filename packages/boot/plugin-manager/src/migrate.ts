/**
 * Planning a profile-to-profile plugin migration: the active bundles the target
 * profile does not have yet, and the ones it activates without installing.
 * @module @deepseek-ai/dsh-plugin-manager/migrate
 */

import type { ProfilePluginInventory } from '@deepseek-ai/dsh-app-boot'
import { parseInstallSpec, type ParsedInstallSpec } from './install-spec.ts'

/** One plugin package the target profile installs. */
export interface ProfileMigrationInstall {
  /** Dependency key the target profile carries. */
  readonly name: string
  /** Spec handed to the package manager: the source's exact version, or its recorded spec verbatim. */
  readonly spec: string
}

/** One source plugin the migration leaves behind. */
export interface ProfileMigrationSkip {
  /** Dependency or bundle name in the source profile. */
  readonly name: string
  /** Why the plugin is not carried over. */
  readonly reason: string
}

/** Everything one profile migration does. */
export interface ProfileMigrationPlan {
  /** Packages to install, in source manifest order. */
  readonly installs: readonly ProfileMigrationInstall[]
  /** Bundle names to activate, in source bundle order; bundles the target already activates are absent. */
  readonly enable: readonly string[]
  /** Source plugins and bundle names the target does not receive. */
  readonly skipped: readonly ProfileMigrationSkip[]
}

/** Inputs for {@link planProfilePluginMigration}. */
export interface ProfileMigrationOptions {
  /** Profile the plugins are taken from. */
  readonly source: ProfilePluginInventory
  /** Profile the plugins are added to. */
  readonly target: ProfilePluginInventory
  /** Package names the enclosing dsh installation already depends on, which the target activates without installing. */
  readonly installationBundles: readonly string[]
}

/** The spec one installed registry dependency migrates as, or why its recorded spec stands. */
function migrationSpec(name: string, recorded: string, installed: string): string {
  // A path, a git host, a tarball, or an alias records the whole spec; a manifest records a registry dependency as its bare range.
  if (/[/:]/u.test(recorded) || /[/:]/u.test(installed)) return recorded
  let parsed: ParsedInstallSpec
  try { parsed = parseInstallSpec(`${name}@${installed}`) } catch { return recorded }
  if (parsed.kind !== 'registry' || parsed.name !== name) return recorded
  // The exact version the source runs, so the target cannot drift past it.
  return `${name}@${installed}`
}

/**
 * Plan the plugins one profile carries to another. Only bundles the source
 * profile activates migrate: a dependency the source keeps disabled is not
 * part of the profile's behaviour and is never installed. Bundles this dsh
 * installation provides migrate by activation alone. A migration adds to the
 * target and never subtracts from it, and it replaces no installed package.
 * @param options - both inventories and the installation's own bundle names.
 * @returns the installs, the bundle names to activate, and what stays behind.
 */
export function planProfilePluginMigration(options: ProfileMigrationOptions): ProfileMigrationPlan {
  const sourceBundles = options.source.manifest.dsh?.profile?.bundles ?? []
  const active = new Set(sourceBundles)
  const recorded = options.source.manifest.dependencies ?? {}
  const targetDependencies = new Set(options.target.dependencies.map(dependency => dependency.name))
  const targetBundles = new Set(options.target.manifest.dsh?.profile?.bundles ?? [])
  const installation = new Set(options.installationBundles)
  const installs: ProfileMigrationInstall[] = []
  const skipped: ProfileMigrationSkip[] = []
  /** Dependency keys the target carries once every install of this plan has run. */
  const present = new Set(targetDependencies)
  for (const dependency of options.source.dependencies) {
    if (!dependency.bundle) {
      skipped.push({ name: dependency.name, reason: 'the package declares no bundle patch' })
      continue
    }
    if (!active.has(dependency.name)) {
      skipped.push({ name: dependency.name, reason: 'the source profile keeps it disabled' })
      continue
    }
    if (targetDependencies.has(dependency.name)) {
      skipped.push({ name: dependency.name, reason: 'already installed in the target profile' })
      continue
    }
    const spec = recorded[dependency.name]
    /* v8 ignore next -- a dependency is recorded in the manifest it was read from */
    if (spec === undefined) continue
    installs.push({ name: dependency.name, spec: migrationSpec(dependency.name, spec, dependency.version) })
    present.add(dependency.name)
  }
  const enable: string[] = []
  for (const name of sourceBundles) {
    if (targetBundles.has(name)) continue
    if (!present.has(name) && !installation.has(name)) {
      skipped.push({ name, reason: 'the package is not installed in this dsh installation' })
      continue
    }
    enable.push(name)
  }
  return { installs, enable, skipped }
}
