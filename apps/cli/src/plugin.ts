/** Profile package management and explicit, exact-version compatibility approvals. */
import { runPluginCommand, runProfilePnpm, setProfileVersionExemption, type PackageOperationOptions } from '@deepseek-ai/dsh-plugin-manager/operations'
import { planProfilePluginMigration } from '@deepseek-ai/dsh-plugin-manager/migrate'
import type { PackageResult } from '@deepseek-ai/dsh-plugin-manager/types'
import { INSTALL_ANCHOR } from './profile-boot.ts'
import {
  DEFAULT_PROFILE_BUNDLES, initProfile, PROFILE_TEMPLATES, readProfileCompatibility, readProfilePlugins, resolveProfileDir,
  writeProfileBundles, type ProfileContext, type ProfilePluginInventory, type ProfilePluginLocation,
} from '@deepseek-ai/dsh-app-boot'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

function requireDesktopProfile(dir: string): void {
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error('Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.')
  }
}

/** Parse only DSH-owned commands; all other arguments remain pnpm's responsibility. */
async function versionCommand(profile: string, args: readonly string[]): Promise<number | undefined> {
  const [command, ...rest] = args
  if (command !== 'allow-version' && command !== 'revoke-version' && command !== 'version-exemptions') return undefined
  try {
    let packageVersion: string | undefined
    let runtimeVersion: string | undefined
    let acceptRisk = false
    const argumentsIterator = rest.values()
    for (const argument of argumentsIterator) {
      if (argument === '--accept-risk' && command === 'allow-version' && !acceptRisk) acceptRisk = true
      else if (argument === '--dsh-version' && runtimeVersion === undefined) runtimeVersion = argumentsIterator.next().value
      else if (argument.startsWith('--dsh-version=') && runtimeVersion === undefined) runtimeVersion = argument.slice('--dsh-version='.length)
      else if (!argument.startsWith('-') && packageVersion === undefined) packageVersion = argument
      else throw new Error(`unexpected argument ${JSON.stringify(argument)}`)
    }
    if (command === 'version-exemptions' && rest.length > 0) throw new Error('usage: dsh plugin version-exemptions')
    let request: { packageVersion: string; runtimeVersion: string } | undefined
    if (command !== 'version-exemptions') {
      if (packageVersion === undefined || runtimeVersion === undefined) {
        throw new Error(`usage: dsh plugin ${command} <package@version> --dsh-version <exact>${command === 'allow-version' ? ' --accept-risk' : ''}`)
      }
      request = { packageVersion, runtimeVersion }
    }
    if (command === 'allow-version') {
      process.stderr.write('dsh: warning: allowing incompatible plugin versions can break the application or corrupt data. Approval applies only to the exact package and DSH versions.\n')
    }
    const dir = resolveProfileDir(profile)
    if (profile !== 'desktop') await mkdir(dir, { recursive: true })
    await withFileLock(join(dir, 'package.json'), async () => {
      if (profile === 'desktop') requireDesktopProfile(dir)
      else if (!existsSync(join(dir, 'package.json'))) initProfile(dir, PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
      if (request === undefined) {
        const { exemptions, warnings } = readProfileCompatibility(dir)
        for (const warning of warnings) process.stderr.write(`dsh: warning: ${warning}\n`)
        process.stdout.write(JSON.stringify(exemptions, undefined, 2) + '\n')
      } else {
        await setProfileVersionExemption(dir, request.packageVersion, request.runtimeVersion, command === 'allow-version', acceptRisk)
        process.stdout.write(`dsh: ${command === 'allow-version' ? 'allowed' : 'revoked'} ${request.packageVersion} for DSH ${request.runtimeVersion}\n`)
      }
    }, { waitMs: 120000 })
    return 0
  } catch (error) {
    process.stderr.write(`dsh: ${String(error)}\n`)
    return 1
  }
}

/** The package names this dsh installation provides, which a target profile activates without installing. */
function installationBundles(anchor: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(anchor, 'utf8')) as { dependencies?: Record<string, string> }
  return Object.keys(manifest.dependencies ?? {})
}

/** Report the diagnostics one package operation left for the person to act on. */
function reportPackageResult(profile: string, args: readonly string[], result: PackageResult): void {
  if (result.exitCode === 127) process.stderr.write('dsh: pnpm was not found; install pnpm and make it available on PATH.\n')
  for (const { name, version, runtimeVersion } of result.incompatible ?? []) {
    process.stderr.write(`dsh: to accept the risk, run: dsh plugin --profile ${profile} allow-version ${name}@${version} --dsh-version ${runtimeVersion} --accept-risk\n`)
  }
  if (result.exitCode !== 0) process.stderr.write(`dsh: plugin command failed; diagnostics: ${result.logPath}\n`)
  if (result.exitCode !== 0 && args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
    process.stderr.write(`dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under allowBuilds in ${join(resolveProfileDir(profile), 'pnpm-workspace.yaml')}, then re-run\n`)
  }
}

/** The inventory a profile reports before the run creates it: the template's bundles and no dependencies. */
function templateProfilePlugins(bundles: readonly string[]): ProfilePluginInventory {
  return { manifest: { dependencies: {}, dsh: { profile: { bundles: [...bundles] } } }, dependencies: [] }
}

/** Carry the plugins one profile activates into another; every other argument stays pnpm's. */
async function migrateCommand(
  profile: string, args: readonly string[], packageManager?: ProfileContext['packageManager'],
): Promise<number | undefined> {
  const [command, ...rest] = args
  if (command !== 'migrate') return undefined
  try {
    let from: string | undefined
    let dryRun = false
    const argumentsIterator = rest.values()
    for (const argument of argumentsIterator) {
      if (argument === '--dry-run' && !dryRun) dryRun = true
      else if (argument === '--from' && from === undefined) from = argumentsIterator.next().value
      else if (argument.startsWith('--from=') && from === undefined) from = argument.slice('--from='.length)
      else throw new Error(`unexpected argument ${JSON.stringify(argument)}`)
    }
    if (from === undefined || from === '') throw new Error('usage: dsh plugin --profile <target> migrate --from <source> [--dry-run]')
    const source = from.toLowerCase()
    if (source === profile) throw new Error('the source and target profiles are the same')
    const sourceDir = resolveProfileDir(source)
    if (!existsSync(join(sourceDir, 'package.json'))) throw new Error(`profile ${JSON.stringify(source)} has no profile at ${sourceDir}`)
    const dir = resolveProfileDir(profile)
    const templateBundles = PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES
    const initialized = existsSync(join(dir, 'package.json'))
    // A dry run reports the plan for a profile it did not create; the template stands in for one that is absent.
    if (profile !== 'desktop' && !initialized && !dryRun) {
      await mkdir(dir, { recursive: true })
      initProfile(dir, templateBundles)
    }
    const context = { profile, dir, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }
    const options: PackageOperationOptions = {
      ...packageManager,
      execution: 'cli',
      outputBytes: 16384,
      lockWaitMs: 120000,
      lookupTimeoutMs: 120000,
      // Activation is this command's own step, so pnpm must not reconcile the bundle list behind it.
      activateNewBundles: false,
      onOutput: (text, stream) => { process[stream].write(text) },
    }
    const location = (profileDir: string): ProfilePluginLocation => ({ binName: 'dsh', profileDir, installAnchor: INSTALL_ANCHOR })
    const plan = planProfilePluginMigration({
      source: readProfilePlugins(location(sourceDir)),
      target: initialized ? readProfilePlugins(location(dir)) : templateProfilePlugins(templateBundles),
      installationBundles: installationBundles(INSTALL_ANCHOR),
    })
    process.stdout.write(`dsh: migrating plugins from profile ${source} to profile ${profile}\n`)
    for (const { spec } of plan.installs) process.stdout.write(`dsh: install ${spec}\n`)
    for (const name of plan.enable) process.stdout.write(`dsh: enable ${name}\n`)
    for (const { name, reason } of plan.skipped) process.stdout.write(`dsh: skip ${name}: ${reason}\n`)
    if (dryRun) {
      process.stdout.write('dsh: dry run: no profile was changed\n')
      return 0
    }
    if (plan.installs.length === 0 && plan.enable.length === 0) {
      process.stdout.write('dsh: nothing to migrate\n')
      return 0
    }
    const apply = async (): Promise<number> => {
      if (plan.installs.length > 0) {
        const specs = plan.installs.map(install => install.spec)
        const result = await runProfilePnpm(context, ['add', ...specs], options)
        reportPackageResult(profile, specs, result)
        if (result.exitCode !== 0) return result.exitCode
      }
      if (plan.enable.length > 0) {
        const current = readProfilePlugins(location(dir))
        const bundles = current.manifest.dsh?.profile?.bundles ?? []
        writeProfileBundles(dir, current.manifest, [...bundles, ...plan.enable.filter(name => !bundles.includes(name))])
      }
      process.stdout.write(`dsh: migrated ${String(plan.installs.length)} plugin(s) from profile ${source} to profile ${profile}\n`)
      if (profile === 'desktop') process.stdout.write('dsh: reopen DeepSeek Harness Desktop to load the migrated bundles.\n')
      return 0
    }
    return await withFileLock(join(dir, 'package.json'), async () => {
      if (profile === 'desktop') requireDesktopProfile(dir)
      return await apply()
    }, { waitMs: 120000 })
  } catch (error) {
    process.stderr.write(`dsh: ${String(error)}\n`)
    return 1
  }
}

/** Run package management for a profile.
 * @param profile Profile name; Desktop's reserved profile must already be initialized by the application.
 * @param args DSH exemption command or pnpm arguments relative to the invoking directory.
 * @param packageManager Installation-owned executable and environment for pnpm operations.
 * @returns Zero on success; nonzero on invalid approval or package-manager failure.
 */
export async function runPlugin(profile: string, args: readonly string[], packageManager?: ProfileContext['packageManager']): Promise<number> {
  if (profile === 'desktop') {
    try { requireDesktopProfile(resolveProfileDir(profile)) } catch (error) {
      process.stderr.write(`dsh: ${String(error)}\n`)
      return 1
    }
  }
  const versionResult = await versionCommand(profile, args)
  if (versionResult !== undefined) return versionResult
  const migrateResult = await migrateCommand(profile, args, packageManager)
  if (migrateResult !== undefined) return migrateResult
  const dir = resolveProfileDir(profile)
  if (existsSync(join(dir, 'package.json'))) {
    for (const warning of readProfileCompatibility(dir).warnings) process.stderr.write(`dsh: warning: ${warning}\n`)
  }
  const context = { profile, dir, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }
  const options: PackageOperationOptions = {
    ...packageManager,
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    lookupTimeoutMs: 120000,
    onOutput: (text, stream) => { process[stream].write(text) },
  }
  const result = profile === 'desktop'
    ? await withFileLock(join(dir, 'package.json'), async () => {
      requireDesktopProfile(dir)
      return runProfilePnpm(context, args, options)
    }, { waitMs: 120000 })
    : await runPluginCommand(context, args, options)
  reportPackageResult(profile, args, result)
  return result.exitCode
}
