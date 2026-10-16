// Stands in for Node's `crypto` when a bundler resolves garaga's import of it (web/vite.config.ts).
// Nothing imports this file: the bundler points at it by path.
//
// garaga imports `createHash` at the top of its bundle, but only its risc0 / sp1 helpers call it, and
// the Honk calldata never does. Its own browser mapping pulls in crypto-browserify, and with it
// readable-stream, which needs `process`. Throwing keeps that chain out of the page and makes any
// real use loud instead of silent
export function createHash(algorithm: string): never {
  throw new Error(
    `createHash("${algorithm}") is not available in the browser build`,
  );
}
