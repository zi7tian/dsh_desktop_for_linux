# Agent Note: Migrate plugins between the Web and Desktop profiles

Status: implemented

English | [中文](2026-10-02-profile-plugin-migration.zh.md)

## Problem

Web and Desktop keep their plugins in separate profiles under `$DSH_HOME/profiles`. The two shells share one bundle template — `apps/desktop/src/project-manager.ts` initializes the reserved Desktop profile from `PROFILE_TEMPLATES.web` — so the same plugin can serve both, but a person who installs it in one shell does not have it in the other. Copying the profile directory does not travel: `.dsh-module-fallback` holds absolute symlinks, the lockfile pins registry URLs, integrity hashes, and platform, and the Desktop profile installs for the runtime Node the application bundles rather than the system Node. [Current-profile plugin management](../architecture/2026-09-14-current-profile-plugin-management.md) gave the reserved Desktop profile install, removal, and enablement through the application, with no way to carry a set of plugins across.

## Decision

`planProfilePluginMigration` in `packages/boot/plugin-manager/src/migrate.ts`, published as `@deepseek-ai/dsh-plugin-manager/migrate`, turns a source profile inventory into an add-only plan. It walks the source's manifest dependencies in manifest order and skips a package that declares no bundle patch, one the source keeps disabled, and one the target already has; the rest become installs. `migrationSpec` pins a registry dependency to the version the source runs, so the target cannot resolve past it, and keeps a path, git, tarball, or aliased spec exactly as recorded, because rewriting it would install a different artifact. The source's active bundles that the target lacks then join the target's bundle list when the source installation or this dsh installation provides them; a bundle the installation provides is enabled without an install.

`dsh plugin --profile <target> migrate --from <source> [--dry-run]` runs that plan from `apps/cli/src/plugin.ts`. It creates a missing target profile from `PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES`, except for the reserved Desktop profile, which the application owns: the command requires the application to have initialized it and to be fully quit. Installs run first with Bundle reconciliation suspended, so a newly installed package cannot activate itself mid-run, and the gained bundles are written afterwards in source order. `--dry-run` prints the plan and changes nothing. Migration only adds: it deactivates, replaces, and removes nothing, and a second run of the same pair reports that there is nothing to migrate. As a target, the reserved profile accepts this subcommand through the Desktop application's launcher, which sets `manageDesktopProfile` and is therefore not covered by the CLI's rejection of desktop-profile boot commands; migrating out of it uses the ordinary CLI.

## Alternatives considered

**Copy the profile directory.** The copy carries absolute fallback symlinks, a lockfile pinned to the source machine's registry, integrity hashes, and platform, plus modules built for a different Node ABI, so it is not portable between the system-Node and bundled-Node shells.

**Reinstall from the ranges the source manifest records.** A range such as `^1.0.0` resolves to whatever is newest rather than the version the source actually runs, so the migrated target could fail against a plugin newer than the one the person tested.

**Replace the target's plugin set with the source's.** Migration would then deactivate, remove, and reinstall plugins the target already had, taking work away from the profile a command whose purpose is to carry plugins toward it was asked to fill.

**Expose the source profile through the Web plugin manager.** The Web surface manages one profile at a time, so the operation would have to mount a second profile in the shared client, while the migration is a one-time profile-to-profile act for which the CLI already owns the profile argument.

## Consequences

- Migration is one source-to-target run and idempotent: repeating the same pair reports nothing to migrate.
- The install is an ordinary bundled-pnpm install into the target profile; a failure restores the target's manifest, lockfile, and node_modules, as the profile runner already does.
- A plugin whose source record is a path, git, or tarball spec arrives with that spec; a registry dependency arrives pinned to the version the source runs.
- Bundles this installation provides are activated in the target without being installed there, matching how a profile lists optional bundles the installation ships.
