/* @refresh reload */
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import { getZKHonkCallData, init as initGaraga } from "garaga";

import { RpcProvider } from "starknet";
// noir-jwt builds the circuit's RSA and base64 inputs from a letter, as in circuits/scripts/fixture.ts
import { generateInputs } from "noir-jwt";

import { getLetter, relay } from "./devnet-service";
import {
  IDENTITY_INPUT,
  accountAddress,
  claims,
  identityHash,
  loginNonce,
  newSessionKey,
  publicInput,
  randomSecret,
  sessionAccount,
  transferCall,
} from "./login";

import circuit from "../../circuits/target/login.json";
import deployment from "../../contracts/deployments/devnet.json";
// Written by `bb write_vk` (make verifier), the same file Garaga generated the verifier from.
// `?inline` makes it a data URL in the bundle: 1,888 bytes, and no extra request
import vkUrl from "../../circuits/target/vk?inline";

// Same bytes as `bb prove` writes. bb.js gives each public input as "0x" + 32 bytes in hex
const publicInputBytes = (xs: string[]) =>
  Uint8Array.fromHex(xs.map((x) => x.slice(2)).join(""));

const MAX_DATA_LENGTH = 1024; // same as in circuits/src/main.nr
const SESSION_LENGTH = 24n * 3600n; // a day, well under the account's MAX_SESSION of 30
const SALT = 12345n; // the real one comes from the dev's salt endpoint (E2E.md, step 5)
const RPC_URL = "http://127.0.0.1:5050/rpc"; // devnet
const TRANSFER = 1000n; // what the account sends, to show the session key works

const url = (bytes: Uint8Array) =>
  URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));

// Garaga's WASM (~1.9 MB to compile) and the verification key. The calldata step needs both and
// neither depends on the login, so a login starts this first and awaits it after proving.
// `init` is not promise-memoized, so keep the one promise instead of calling it again
let garagaReady: Promise<Uint8Array> | undefined;
const loadGaraga = () =>
  (garagaReady ??= initGaraga()
    .then(() => fetch(vkUrl))
    .then((res) => res.arrayBuffer())
    .then((vk) => new Uint8Array(vk)));

function App() {
  const [log, setLog] = createSignal("");
  const [proof, setProof] = createSignal<ProofData>();
  const say = (line: string) => setLog((l) => l + line + "\n");

  async function prove() {
    setLog("");
    setProof();
    // bb.js falls back to 1 thread when the page is not cross-origin isolated
    const threads = crossOriginIsolated ? navigator.hardwareConcurrency : 1;
    say(
      `threads: ${threads} (cores: ${navigator.hardwareConcurrency}), cross-origin isolated: ${crossOriginIsolated}`,
    );
    let backend: UltraHonkBackend | undefined;
    try {
      let t = performance.now();
      const lap = () => {
        const s = ((performance.now() - t) / 1000).toFixed(1);
        t = performance.now();
        return `${s}s`;
      };

      // Started now, awaited after the proof, so it runs during it
      const garaga = loadGaraga();

      // A session key for this login, and a letter naming it. The nonce is what ties them: Google
      // copies it into the letter, under its seal (devnet: the service plays Google)
      const session = newSessionKey();
      const expiry = BigInt(Math.floor(Date.now() / 1000)) + SESSION_LENGTH;
      const secret = randomSecret();
      const { jwt, pubkey } = await getLetter(
        loginNonce(session.publicKey, expiry, secret),
      );
      const { aud, sub } = claims(jwt);
      const letter = await generateInputs({
        jwt,
        pubkey,
        maxSignedDataLength: MAX_DATA_LENGTH,
      });
      say(`session key: 0x${session.publicKey.toString(16).slice(0, 16)}…`);

      const { witness } = await new Noir(circuit as CompiledCircuit).execute({
        ...letter,
        session_pubkey: String(session.publicKey),
        expiry: String(expiry),
        secret: String(secret),
        salt: String(SALT),
      });
      say(`witness: ${lap()}`);

      backend = new UltraHonkBackend(circuit.bytecode, {
        threads,
        logger: console.log,
      });
      // same proof system as `bb prove -s ultra_honk --oracle_hash keccak` (ZK on) and Garaga's ultra_keccak_zk_honk
      const result = await backend.generateProof(witness, { keccakZK: true });
      say(`proof: ${lap()}`);
      setProof(result);

      const ok = await backend.verifyProof(result, { keccakZK: true });
      say(`verified in the browser: ${ok}`);

      // Calldata of register_session(proof), as deploy/e2e-devnet.ts builds it in Node
      const calldata = getZKHonkCallData(
        result.proof,
        publicInputBytes(result.publicInputs),
        await garaga,
      );
      say(`calldata: ${lap()}, ${calldata.length} felts`);

      // The identity we computed must be the one the circuit proved, or the address is wrong
      const identity = identityHash(aud, sub, SALT);
      const proven = publicInput(calldata, IDENTITY_INPUT);
      if (identity !== proven)
        throw new Error(
          `identity_hash differs: ours 0x${identity.toString(16)}, proof 0x${proven.toString(16)}`,
        );
      say(`identity_hash: 0x${identity.toString(16)} (matches the proof)`);

      // admin = the deployer until the role goes away (TRACKING.md, Later)
      const { address, constructorCalldata } = accountAddress(
        deployment.accountClassHash,
        deployment.admin,
        deployment.registry,
        deployment.verifier,
        identity,
      );
      say(`address: ${address}`);

      // The relayer deploys the account and registers the session in one transaction
      const relayed = await relay(constructorCalldata, calldata.map(String));
      if (BigInt(relayed.address) !== BigInt(address))
        throw new Error(`relayer deployed ${relayed.address}, not ${address}`);
      say(`deployed + session registered: ${lap()}`);

      // From here the session key signs, and the account pays its own fees
      const user = sessionAccount(
        new RpcProvider({ nodeUrl: RPC_URL }),
        address,
        session.privateKey,
      );
      const { transaction_hash } = await user.execute([
        transferCall(deployment.admin, TRANSFER),
      ]);
      say(`transfer signed by the session key: ${transaction_hash}`);
      say(`done: ${lap()}`);
    } catch (e) {
      say(`error: ${e}`);
      console.error(e);
    } finally {
      await backend?.destroy();
    }
  }

  return (
    <main>
      <h1>browser proving</h1>
      <button onClick={prove}>Prove</button>
      {/* Same files as `bb prove -o target/`, to check with `bb verify` and Garaga */}
      <Show when={proof()}>
        {(p) => (
          <p>
            <a download="proof" href={url(p().proof)}>
              proof
            </a>{" "}
            <a
              download="public_inputs"
              href={url(publicInputBytes(p().publicInputs))}
            >
              public_inputs
            </a>
          </p>
        )}
      </Show>
      <pre>{log()}</pre>
    </main>
  );
}

render(() => <App />, document.getElementById("root")!);
