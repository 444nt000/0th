import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { getZKHonkCallData, init as initGaraga } from "garaga";
import { generateInputs } from "noir-jwt";

// Same bound as MAX_DATA_LENGTH in circuits/src/main.nr. A Google letter is about 658 bytes
const MAX_DATA_LENGTH = 768;

// Index of identity_hash among the circuit's public inputs
const IDENTITY_INPUT = 20;

export type ProofStep = "witness" | "proof" | "calldata";

// The compiled circuit and the verification key the on-chain verifier was generated from
export type Circuit = {
  program: CompiledCircuit;
  verificationKey: Uint8Array;
};

// Circuit inputs that are not derived from the letter
type Session = {
  publicKey: bigint;
  expiry: bigint;
  secret: bigint;
  salt: bigint;
};

// Garaga's calldata is span_len, count, (low, high) * count, so each input spans two felts
function publicInput(calldata: bigint[], i: number) {
  const count = calldata[1] ?? 0n;
  if (i >= count)
    throw new Error(`the proof has ${count} public inputs, not ${i + 1}`);
  return (calldata[3 + 2 * i]! << 128n) | calldata[2 + 2 * i]!;
}

// bb.js gives each public input as "0x" followed by 32 bytes of hex
const publicInputBytes = (inputs: string[]) =>
  Uint8Array.fromHex(inputs.map((input) => input.slice(2)).join(""));

// initGaraga is not idempotent, hence the kept promise: callers start it early and await it here
let garagaReady: Promise<unknown> | undefined;
export const loadGaraga = () => (garagaReady ??= initGaraga());

// bb.js proves on several threads only in a cross-origin isolated page, and falls back to one
// thread elsewhere
export async function proveLogin(
  circuit: Circuit,
  letter: { jwt: string; providerKey: JsonWebKey },
  session: Session,
  onStep?: (step: ProofStep, ms: number) => void,
) {
  const garaga = loadGaraga();
  let backend: UltraHonkBackend | undefined;
  try {
    let since = performance.now();
    const lap = (step: ProofStep) => {
      onStep?.(step, performance.now() - since);
      since = performance.now();
    };

    backend = new UltraHonkBackend(circuit.program.bytecode, {
      threads: crossOriginIsolated ? navigator.hardwareConcurrency : 1,
    });
    const letterInputs = await generateInputs({
      jwt: letter.jwt,
      pubkey: letter.providerKey,
      maxSignedDataLength: MAX_DATA_LENGTH,
    });

    const { witness } = await new Noir(circuit.program).execute({
      ...letterInputs,
      session_pubkey: String(session.publicKey),
      expiry: String(session.expiry),
      secret: String(session.secret),
      salt: String(session.salt),
    });
    lap("witness");

    // Matches the system the deployed verifier was generated for
    const proof = await backend.generateProof(witness, { keccakZK: true });
    lap("proof");

    // The proof is copied out of the worker pool, so the pool goes before the calldata step rather
    // than holding its memory through it
    await backend.destroy();
    backend = undefined;

    await garaga;
    const calldata = getZKHonkCallData(
      proof.proof,
      publicInputBytes(proof.publicInputs),
      circuit.verificationKey,
    );
    lap("calldata");

    return { calldata, identity: publicInput(calldata, IDENTITY_INPUT) };
  } finally {
    await backend?.destroy();
  }
}
