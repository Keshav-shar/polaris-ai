// Bundles each Lambda entry point into dist/lambda/<function>.zip (Phase 13). Run: npm run build:lambdas
//
// One ESM file per function (index.mjs, handler `index.handler`), Node 22. `@aws-sdk/*` stays external because the
// nodejs22.x runtime ships SDK v3; everything else (zod, openai, supabase-js, jose) is bundled in. The zips are
// written locally only - uploading them is the user's step (docs/setup.md); Claude never deploys.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { zip } from "./zip-writer";

const FUNCTIONS = ["expand-node", "write-article", "handle-dead-letter", "refresh-insight"] as const;
const root = join(__dirname, "..");
const out = join(root, "dist", "lambda");

// Bundled CommonJS dependencies still call require() at runtime; an ESM bundle has no require of its own.
const banner = 'import { createRequire as __polarisRequire } from "node:module"; const require = __polarisRequire(import.meta.url);';

async function main(): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of FUNCTIONS) {
    const result = await build({
      entryPoints: [join(root, "src", "interfaces", "workers", `${name}.lambda.ts`)],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      external: ["@aws-sdk/*"],
      banner: { js: banner },
      write: false,
      minify: false,
      sourcemap: false,
      legalComments: "none",
      logLevel: "warning",
    });
    const code = result.outputFiles[0];
    if (code === undefined) throw new Error(`esbuild produced nothing for ${name}`);
    const archive = zip([{ name: "index.mjs", data: Buffer.from(code.contents) }]);
    writeFileSync(join(out, `${name}.zip`), archive);
    console.log(`${name}.zip  ${(archive.length / 1024).toFixed(0)} KB (index.mjs ${(code.contents.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
