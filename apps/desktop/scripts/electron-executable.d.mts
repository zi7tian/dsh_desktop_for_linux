/**
 * Return the Electron executable of one prepared distribution.
 * @param directory - Extracted Electron distribution root.
 * @param platform - Platform that distribution was prepared for.
 * @returns Absolute path of the Electron binary.
 */
export function electronExecutablePath(directory: string, platform: NodeJS.Platform): string
