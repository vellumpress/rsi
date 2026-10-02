import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["supabase/functions/rsi-onboard/entry.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: "supabase/functions/rsi-onboard/index.ts",
  external: ["npm:@supabase/supabase-js@2.49.8"],
  banner: {
    js: "// Generated from supabase/functions/rsi-onboard/entry.ts by scripts/bundle-functions.mjs. Deploy this file.",
  },
});
