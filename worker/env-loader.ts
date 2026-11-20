import fs from 'node:fs';
import path from 'node:path';

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) return null;
  const key = trimmed.slice(0, eqIdx).trim();
  const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
  return key && value ? [key, value] : null;
}

/**
 * Loads KEY=VALUE pairs from a local .env file into targetEnv without
 * overriding variables already provided by the host process environment.
 */
export function loadDotEnvFile(
  filePath: string = path.resolve(process.cwd(), '.env.local'),
  targetEnv: Record<string, string | undefined> = process.env
): number {
  if (!fs.existsSync(filePath)) return 0;
  let loaded = 0;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && !targetEnv[parsed[0]]) {
      targetEnv[parsed[0]] = parsed[1];
      loaded += 1;
    }
  }
  return loaded;
}
