// The Vite settings the sdk's own dependencies need in a dapp's build

import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const CRYPTO_SHIM = fileURLToPath(new URL("./crypto-shim.ts", import.meta.url));

// Excluded from pre-bundling, so Vite serves them as the ESM and WASM they already ship
const UNBUNDLED = [
  "@aztec/bb.js",
  "@noir-lang/noir_js",
  "@noir-lang/acvm_js",
  "@noir-lang/noirc_abi",
  // the pre-bundler resolves imports before any plugin, so excluding garaga is what lets
  // resolveId below see its crypto import
  "garaga",
];

// bb.js is unbundled above, so its own CommonJS deps are pre-bundled named one by one, by the
// path Vite resolves them through. Without this pino provides no named export and the page
// does not mount
const COMMONJS_DEPS = ["@aztec/bb.js > pino", "@aztec/bb.js > buffer"];

export type ZkLoginOptions = {
  // How the dapp's package.json names this package, which heads the dependency paths Vite
  // resolves bb.js's CommonJS deps through
  sdk?: string;
  // The verification key, which bb write_vk writes without an extension, so Vite reads it as
  // JS and fails to parse it
  vk?: string;
};

export function zkLogin({ sdk = "sdk", vk }: ZkLoginOptions = {}): Plugin {
  return {
    name: "zk-login",
    enforce: "pre",

    config: () => ({
      ...(vk && { assetsInclude: [vk] }),
      server: {
        // cross-origin isolation: bb.js proves on several threads only with these, and this
        // also covers vite preview
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
      },
      optimizeDeps: {
        exclude: UNBUNDLED,
        include: COMMONJS_DEPS.map((dep) => `${sdk} > ${dep}`),
      },
    }),

    // garaga's bundle imports crypto at the top, which the browser cannot resolve. Scoped to
    // garaga so that bb.js, which imports crypto for its CSPRNG, keeps the real one
    resolveId: (id, importer) =>
      id === "crypto" && importer?.includes("/garaga/")
        ? CRYPTO_SHIM
        : undefined,
  };
}
