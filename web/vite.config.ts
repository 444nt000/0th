import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// garaga's bundle imports crypto at the top, which the browser cannot resolve
// Scoped to garaga so that bb.js, which imports crypto for its CSPRNG, keeps the real one
const stubGaragaCrypto = {
  name: "stub-garaga-crypto",
  enforce: "pre" as const,
  resolveId: (id: string, importer?: string) =>
    id === "crypto" && importer?.includes("/garaga/")
      ? file("../sdk/src/crypto-shim.ts")
      : undefined,
};

export default defineConfig({
  plugins: [solid(), stubGaragaCrypto],
  // bb write_vk writes an extensionless file, which Vite reads as JS and fails to parse
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
      // the pre-bundler resolves imports before any plugin, so excluding garaga is what lets the
      // plugin above see its crypto import
      "garaga",
    ],
    // bb.js is excluded above, so its own CommonJS deps need pre-bundling named one by one
    include: ["sdk > @aztec/bb.js > pino", "sdk > @aztec/bb.js > buffer"],
  },
});
