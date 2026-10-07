/** Locate the Electron binary inside a prepared Electron distribution. */

import { join } from 'node:path'

/**
 * Return the Electron executable of one prepared distribution.
 * The macOS download is an application bundle, Windows ships an `electron.exe`, and the
 * Linux archive carries a plain `electron` binary at its root.
 * @param {string} directory - Extracted Electron distribution root.
 * @param {NodeJS.Platform} platform - Platform that distribution was prepared for.
 * @returns {string} Absolute path of the Electron binary.
 */
export function electronExecutablePath(directory, platform) {
  if (platform === 'win32') return join(directory, 'electron.exe')
  if (platform === 'darwin') return join(directory, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return join(directory, 'electron')
}
