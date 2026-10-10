// Stands in for Node's `crypto` in the browser build (web/vite.config.ts, resolve.alias).
//
// garaga imports `createHash` at the top of its bundle, but only its risc0 / sp1 helpers call it;
// the Honk calldata we use never does. Its own browser mapping pulls in crypto-browserify, and with it
// readable-stream, which needs `process`. This keeps that chain out of the page.
export function createHash(algorithm: string): never {
  throw new Error(
    `createHash("${algorithm}") is not available in the browser build`,
  );
}
