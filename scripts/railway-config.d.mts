export interface LookupResult {
  status: number | null;
  stdout: string | null;
}

export function findRailwayCandidates(options: {
  platform: NodeJS.Platform;
  run: (command: string, args: string[]) => LookupResult;
}): string[];

export function resolveRailwayExecutable(options: {
  platform: NodeJS.Platform;
  candidates: readonly string[];
  exists: (file: string) => boolean;
}): string | null;

/** `['config', 'plan' | 'apply', ...rest]`, or `null` when the subcommand is missing or unknown. */
export function buildRailwayArgs(argv: readonly string[]): string[] | null;

export function runRailway(options: {
  executable: string;
  args: string[];
  spawn: (
    command: string,
    args: string[],
    options: { stdio: 'inherit'; shell: false; env: NodeJS.ProcessEnv },
  ) => { status: number | null };
}): number;
