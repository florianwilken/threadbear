// runner.json's defaults.folders: a folder's own default mode, for a
// thread that names none, over defaults.permissionMode. A thread in the
// folder or under it gets it, and one in a git worktree of it too (matched
// as the same place in the main checkout); the longest folder wins.
// Only runner.json sets it, never a repo: a repo's patch must not be able to
// raise its own threads' access.
import path from 'node:path';
import { expandHome, type Config, type DefaultMode } from './config.ts';
import { folderKeyOfDir } from './patch-trust.ts';

export function defaultModeFor(defaults: Config['defaults'], cwd: string | undefined): DefaultMode | undefined {
  return folderModeFor(defaults.folders, cwd?.trim() ? path.resolve(expandHome(cwd.trim())) : defaults.cwd) ?? defaults.permissionMode;
}

function folderModeFor(folders: Config['defaults']['folders'], cwd: string): DefaultMode | undefined {
  if (!folders) return undefined;
  const here = folderKeyOfDir(cwd);
  let best: { length: number; mode: DefaultMode } | undefined;
  for (const [folder, { permissionMode }] of Object.entries(folders)) {
    const root = folderKeyOfDir(folder);
    const inside = here === root || here.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
    if (inside && (!best || root.length > best.length)) best = { length: root.length, mode: permissionMode };
  }
  return best?.mode;
}
