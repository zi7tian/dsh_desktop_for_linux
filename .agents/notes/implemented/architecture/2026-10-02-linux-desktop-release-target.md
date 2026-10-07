# Agent Note: Package the desktop application for Linux

Status: implemented

English | [中文](2026-10-02-linux-desktop-release-target.zh.md)

## Problem

The desktop release pipeline named a closed platform set — macOS arm64/x64 and Windows x64 — in its target table, its artifact-name pattern, and its runtime-preparation and electron-builder stages, so a Linux x86_64 host could not produce a desktop artifact at all. [Package and update the Electron desktop application](2026-08-25-electron-desktop-packaging-and-updates.md) recorded that absence as a decision rather than an omission. Two facts made closing it packaging work instead of a port: the primary-runtime payload already resolves the linux-x64 platform, and Electron's own Node links a libvips build that crashes on Linux, so the payload must run under the bundled primary-runtime Node described by [Desktop bundled runtime and external plugins](2026-09-08-desktop-bundled-runtime-and-external-plugins.md).

## Decision

`linux-x64` is a package target like the others. `apps/desktop/scripts/package-target.ts` maps it to `--linux`/`--x64`, refuses to run on a host that is not Linux x86_64, and skips the release record because an AppImage has no update feed to upload to; `apps/desktop/scripts/desktop-upload-plan.ts` excludes it from the upload targets for the same reason. The fixed commands are `package:linux:x64` and `package:linux:x64:dir`, surfaced at the repository root as `package:desktop:linux:x64` and `package:desktop:linux:x64:dir`.

Linux carries no updater feed and no mandatory-update policy. `apps/desktop/scripts/electron-builder-config.mjs` computes `policy` and `update` only off Linux; embedding either would abort startup, because `apps/desktop/src/main.ts` rejects any platform outside `win32` and `darwin` with `desktop policy: unsupported platform`, and the release channel serves no Linux artifact. The Linux entry is the application itself: unsigned, `AppImage`, `executableName` `deepseek-harness`, category `Development`, replaced rather than updated in place.

The Linux package ships without ASAR: `asar: resolvedPlatform !== 'linux'` because the payload runs under the bundled Node, which cannot read ASAR archives. The payload therefore lands in `resources/app/dsh`, and the shipped launcher and private Host derive the support directory from the payload root instead of assuming an archive — `desktopRuntimeSupportDir` in `apps/desktop-host/src/cli.ts`, reached through the same `resources/runtime` tree that the macOS and Windows layouts use.

Platform preparation follows the new target. `prepare-runtime.ts`, `prepare-dsh.ts`, and `prepare-cli.ts` map Linux, mark the launcher executable for every non-Windows platform, and the toolchain preflight probes the Linux kit; Linux selects the `wasm` office engine because no linux-x64 LibreOffice kit exists. `desktop-package-environment.mjs` reads only the shared keys on Linux, from the same `.env.linux` file the new `apps/desktop/.env.linux.example` documents. Linux reports the Web client identity to the account service: `apps/desktop/src/main.ts` passes `null` for a platform outside `win32` and `darwin`, which the account layer documents as the Web identity, and shell command installation stays macOS- and Windows-only, reporting `EUNSUPPORTED` only when a person asks for it.

## Alternatives considered

**Embed the mandatory-update policy and the electron-updater feed on Linux.** `apps/desktop/src/main.ts` refuses an unsupported platform before any window exists, so a Linux build carrying the policy would abort at startup, and the vendor feed publishes no Linux channel to point at.

**Report a dedicated `desktop-linux` account client identity.** The account wire contract has no such header, and a `null` platform is already the documented Web identity, so the desktop application would claim a client the service cannot distinguish from an unknown caller.

**Keep the ASAR layout on Linux.** The packaged payload runs under the bundled Node, which cannot read ASAR archives, so the application would have to unpack or reimplement archive access before the first Host start.

**Treat Linux as a cross-compile target from macOS or Windows.** The linux-x64 runtime payload has to be prepared and smoke-tested on the host that runs it, so the packaging script refuses a non-Linux-x64 host instead of producing an artifact nobody validated.

## Consequences

- A Linux x86_64 host produces `deepseek-harness-0.2.0-rc.2-linux-x86_64.AppImage`; electron-builder expands ${arch} to `x86_64` on Linux, which the artifact-name pattern and the Desktop documentation both accept.
- The artifact is unsigned and has no updater: a new release is a new AppImage, and nothing rewrites the installed one.
- Mounting it needs the FUSE 2 runtime; a host without it starts the application with `--appimage-extract-and-run` or uses the unpacked directory.
- The application reports the Web client identity on Linux, and installing the `dsh` command into the shell stays unsupported there.
