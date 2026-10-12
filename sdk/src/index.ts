// The 0th SDK: everything a dapp cannot reasonably write itself, namely the
// redirect, the browser prover (Noir witness, bb.js proof, Garaga calldata)
// and the relay call, behind one function so a dapp never wires bb.js directly:
//
//   const { address, session } = await login({ clientId, deployment, relayUrl, onProgress });
//
// `onProgress(step, ms)` reports each step as it finishes, so the dapp owns its UI.
