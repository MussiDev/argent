// Bundles the API entry points for production, so they run on plain `node` without tsx.
// Usage: node scripts/build.mjs [--outdir <dir>] [entry.ts ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ENTRY_POINTS = ['src/server.ts', 'src/worker.ts', 'src/shared/db/migrate.ts'];

// `@argent/shared` exports TypeScript source, so it is bundled; every other package stays external
// and resolves to the installed, lockfile-pinned version at runtime.
const BUNDLED_PACKAGE = /^@argent\/shared(\/|$)/;

const externalPackages = {
  name: 'external-packages',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (BUNDLED_PACKAGE.test(args.path) || path.isAbsolute(args.path)) return undefined;
      return { path: args.path, external: true };
    });
  },
};

function parseArgs(argv) {
  const entryPoints = [];
  let outdir = 'dist';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--outdir') {
      outdir = argv[i + 1];
      i += 1;
    } else {
      entryPoints.push(argv[i]);
    }
  }
  return { entryPoints: entryPoints.length > 0 ? entryPoints : DEFAULT_ENTRY_POINTS, outdir };
}

const { entryPoints, outdir } = parseArgs(process.argv.slice(2));

try {
  await build({
    absWorkingDir: apiRoot,
    entryPoints,
    // Keeps `src/shared/db/migrate.ts` at the same depth, so its `../../../drizzle` lookup still
    // lands in `apps/api/drizzle`.
    outbase: 'src',
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
    logLevel: 'warning',
    plugins: [externalPackages],
  });
} catch {
  // esbuild has already printed the errors.
  process.exit(1);
}
