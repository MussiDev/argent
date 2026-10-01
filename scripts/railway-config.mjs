import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SUBCOMMANDS = ['plan', 'apply'];
const USAGE = 'Usage: node scripts/railway-config.mjs <plan|apply> [railway config arguments]';
const NOT_FOUND = 'Railway CLI not found: install it with npm i -g @railway/cli';

export function findRailwayCandidates({ platform, run }) {
  const result =
    platform === 'win32' ? run('where', ['railway']) : run('sh', ['-c', 'command -v railway']);
  if (result.status !== 0 || typeof result.stdout !== 'string') return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function resolveRailwayExecutable({ platform, candidates, exists }) {
  if (platform !== 'win32') return candidates[0] ?? null;

  for (const candidate of candidates) {
    const ext = path.win32.extname(candidate).toLowerCase();
    if (ext === '.exe') return candidate;
    // npm's shims cannot be run by the SDK's shell-less version check; the real binary sits beside them.
    if (ext === '.cmd' || ext === '') {
      const binary = path.win32.join(
        path.win32.dirname(candidate),
        'node_modules',
        '@railway',
        'cli',
        'bin',
        'railway.exe',
      );
      if (exists(binary)) return binary;
    }
  }
  return null;
}

export function buildRailwayArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || !SUBCOMMANDS.includes(subcommand)) return null;
  return ['config', subcommand, ...rest];
}

export function runRailway({ executable, args, spawn }) {
  // The railway SDK checks the CLI version with execFileSync(process.env._ || 'railway').
  const result = spawn(executable, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, _: executable },
  });
  return result.status ?? 1;
}

function main() {
  const args = buildRailwayArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    return 2;
  }

  const candidates = findRailwayCandidates({
    platform: process.platform,
    run: (command, commandArgs) =>
      spawnSync(command, commandArgs, { encoding: 'utf8', shell: false }),
  });
  const executable = resolveRailwayExecutable({
    platform: process.platform,
    candidates,
    exists: existsSync,
  });
  if (executable === null) {
    console.error(NOT_FOUND);
    return 1;
  }

  return runRailway({ executable, args, spawn: spawnSync });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
