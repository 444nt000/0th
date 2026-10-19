// Answers garaga's top-level import of createHash from crypto, which a browser cannot resolve
// (vite.ts). Only its risc0 and sp1 helpers ever call it, so the throw is unreachable
export function createHash(algorithm: string): never {
  throw new Error(
    `createHash("${algorithm}") is not available in the browser build`,
  );
}
