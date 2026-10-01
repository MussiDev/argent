import { describe, expect, it, vi } from 'vitest';
import {
  buildRailwayArgs,
  findRailwayCandidates,
  resolveRailwayExecutable,
  runRailway,
} from '../../../../scripts/railway-config.mjs';

const NPM_DIR = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
const NPM_EXE = `${NPM_DIR}\\node_modules\\@railway\\cli\\bin\\railway.exe`;

const existsOnly =
  (...paths: string[]) =>
  (file: string) =>
    paths.includes(file);

describe('resolveRailwayExecutable (AC-08, AC-09)', () => {
  it('on Windows, resolves an npm railway.cmd shim to the railway.exe installed beside it', () => {
    expect(
      resolveRailwayExecutable({
        platform: 'win32',
        candidates: [`${NPM_DIR}\\railway.cmd`],
        exists: existsOnly(NPM_EXE),
      }),
    ).toBe(NPM_EXE);
  });

  it('on Windows, resolves the extensionless npm shim that `where` lists first', () => {
    expect(
      resolveRailwayExecutable({
        platform: 'win32',
        candidates: [`${NPM_DIR}\\railway`, `${NPM_DIR}\\railway.cmd`],
        exists: existsOnly(NPM_EXE),
      }),
    ).toBe(NPM_EXE);
  });

  it('on Windows, uses a railway.exe found on the PATH as is', () => {
    const exe = 'C:\\Tools\\railway.exe';
    expect(
      resolveRailwayExecutable({ platform: 'win32', candidates: [exe], exists: existsOnly() }),
    ).toBe(exe);
  });

  it.each(['linux', 'darwin'] as const)('on %s, uses the first candidate', (platform) => {
    expect(
      resolveRailwayExecutable({
        platform,
        candidates: ['/usr/local/bin/railway', '/opt/railway'],
        exists: existsOnly(),
      }),
    ).toBe('/usr/local/bin/railway');
  });

  it('not found error: reports not found when there is no candidate', () => {
    expect(
      resolveRailwayExecutable({ platform: 'win32', candidates: [], exists: existsOnly() }),
    ).toBeNull();
    expect(
      resolveRailwayExecutable({ platform: 'linux', candidates: [], exists: existsOnly() }),
    ).toBeNull();
  });

  it('not found error: reports not found when the shim has no railway.exe beside it', () => {
    expect(
      resolveRailwayExecutable({
        platform: 'win32',
        candidates: [`${NPM_DIR}\\railway`, `${NPM_DIR}\\railway.cmd`],
        exists: existsOnly(),
      }),
    ).toBeNull();
  });
});

describe('findRailwayCandidates', () => {
  it('on Windows, lists the paths `where railway` prints', () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: `${NPM_DIR}\\railway\r\n${NPM_DIR}\\railway.cmd\r\n`,
    }));
    expect(findRailwayCandidates({ platform: 'win32', run })).toEqual([
      `${NPM_DIR}\\railway`,
      `${NPM_DIR}\\railway.cmd`,
    ]);
    expect(run).toHaveBeenCalledWith('where', ['railway']);
  });

  it('elsewhere, asks the shell with `command -v railway`', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '/usr/local/bin/railway\n' }));
    expect(findRailwayCandidates({ platform: 'linux', run })).toEqual(['/usr/local/bin/railway']);
    expect(run).toHaveBeenCalledWith('sh', ['-c', 'command -v railway']);
  });

  it('lookup error: a failed lookup yields no candidates', () => {
    expect(
      findRailwayCandidates({ platform: 'win32', run: () => ({ status: 1, stdout: '' }) }),
    ).toEqual([]);
    expect(
      findRailwayCandidates({ platform: 'linux', run: () => ({ status: null, stdout: null }) }),
    ).toEqual([]);
  });
});

describe('buildRailwayArgs (AC-08)', () => {
  it.each(['plan', 'apply'])('builds `config %s` and passes extra arguments through', (sub) => {
    expect(buildRailwayArgs([sub, '--json', 'a b'])).toEqual(['config', sub, '--json', 'a b']);
    expect(buildRailwayArgs([sub])).toEqual(['config', sub]);
  });

  it('subcommand error: refuses a missing subcommand', () => {
    expect(buildRailwayArgs([])).toBeNull();
  });

  it.each(['destroy', 'PLAN', '', '--help'])(
    'subcommand error: refuses the subcommand %j',
    (sub) => {
      expect(buildRailwayArgs([sub])).toBeNull();
    },
  );
});

describe('runRailway (AC-08)', () => {
  it('runs the resolved executable without a shell, with `_` set to it', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(runRailway({ executable: NPM_EXE, args: ['config', 'plan'], spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(NPM_EXE, ['config', 'plan'], {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, _: NPM_EXE },
    });
  });

  it('CLI error: returns the CLI own exit code when it fails, and runs nothing more', () => {
    const spawn = vi.fn(() => ({ status: 3 }));
    expect(runRailway({ executable: NPM_EXE, args: ['config', 'apply'], spawn })).toBe(3);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('CLI error: fails with 1 when the CLI could not start or was killed', () => {
    expect(
      runRailway({
        executable: NPM_EXE,
        args: ['config', 'plan'],
        spawn: () => ({ status: null }),
      }),
    ).toBe(1);
  });
});
