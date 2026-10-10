import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const file = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

// garaga's bundle imports Node's `crypto` at the top, and its browser mapping sends it to
// crypto-browserify, which drags in readable-stream and then needs `global` and `process`. Only garaga's
// risc0 / sp1 helpers call it, never the calldata path, so send it nowhere instead of polyfilling Node.
// Scoped to garaga, not a `resolve.alias`: that matches any importer, and bb.js imports `crypto` too
// (`dest/node/random/node/index.js`, for its randomness). It only misses the stub because bb.js maps a
// separate "browser" entry today, so an app-wide alias would be one dependency bump from silently
// stubbing the prover's CSPRNG. Any other dep importing `crypto` should fail loudly here instead
const stubGaragaCrypto = {
  name: "stub-garaga-crypto",
  enforce: "pre" as const,
  resolveId: (id: string, importer?: string) =>
    id === "crypto" && importer?.includes("/garaga/")
      ? file("src/crypto-shim.ts")
      : undefined,
};

export default defineConfig({
  plugins: [solid(), stubGaragaCrypto],
  // `bb write_vk` writes an extensionless file: without this Vite reads it as JS and fails to parse it
  assetsInclude: [file("../circuits/target/vk")],
  server: {
    // cross-origin isolation: bb.js proves on several threads only with these
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: [
      "@aztec/bb.js",
      "@noir-lang/noir_js",
      "@noir-lang/acvm_js",
      "@noir-lang/noirc_abi",
      // so its `crypto` import goes through the plugin above: the dep pre-bundler resolves imports
      // itself, before any plugin's resolveId, and would bake crypto-browserify in
      "garaga",
    ],
    include: ["@aztec/bb.js > pino", "@aztec/bb.js > buffer"],
  },
});
