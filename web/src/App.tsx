/* @refresh reload */
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import { getZKHonkCallData, init as initGaraga } from "garaga";

import { RpcProvider } from "starknet";
// noir-jwt builds the circuit's RSA and base64 inputs from a letter, as in circuits/scripts/fixture.ts
import { generateInputs } from "noir-jwt";

import { relay } from "./devnet-service";
import { googleKey, readGoogleAnswer, redirectToGoogle } from "./google";
import {
  IDENTITY_INPUT,
  MAX_SUB_LENGTH,
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

// This demo's Google client id. Public by design: it ships in page JS, and `response_type=id_token`
// uses no client secret. One per dapp, so a dapp's users get their own accounts (`CLAUDE.md`, trust model)
const CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  "16619420523-e9c66plhahqsbj7u4090p1d66iapd4p4.apps.googleusercontent.com";
// Where Google sends the letter back. Must be registered on the client id byte for byte: Google
// treats a missing or extra trailing slash as a different URI (error 400, redirect_uri_mismatch).
// The origin and a bare "/", not location.pathname, so a deep link or /index.html still sends the
// one value that is registered
const REDIRECT_URI = `${location.origin}/`;

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

// What `prove` needs: Google's answer, plus the key that sealed it. Derived from readGoogleAnswer, so
// the two cannot drift
type Login = NonNullable<ReturnType<typeof readGoogleAnswer>> & {
  pubkey: JsonWebKey;
};

function App() {
  const [log, setLog] = createSignal("");
  const [proof, setProof] = createSignal<ProofData>();
  const say = (line: string) => setLog((l) => l + line + "\n");

  // Leaves the page: a session key, how long it may live, the secret that hides it from Google, and a
  // nonce committing to all three. Google brings it back and `continueLogin` picks it up
  function loginWithGoogle() {
    const session = newSessionKey();
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + SESSION_LENGTH;
    const secret = randomSecret();
    // Printed before leaving: on a redirect_uri_mismatch, Google's error page does not say which value
    // we sent, and this is the string that has to be registered on the client id
    setLog("");
    say(`redirect_uri: ${REDIRECT_URI}`);
    redirectToGoogle(
      CLIENT_ID,
      REDIRECT_URI,
      loginNonce(session.publicKey, expiry, secret),
      session,
      expiry,
      secret,
    );
  }

  async function prove(login: Login) {
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

      // Already started by continueLogin, and awaited after the proof: it loads during it
      const garaga = loadGaraga();

      const { jwt, pubkey, session, expiry, secret } = login;
      // The letter is untrusted until the proof: these checks only stop us proving a letter the
      // circuit would refuse, or building an address from a letter that is not about this login.
      // The nonce is recomputed, not carried: it must be the one this session key commits to
      const { aud, sub } = claims(
        jwt,
        CLIENT_ID,
        loginNonce(session.publicKey, expiry, secret),
      );
      const letter = await generateInputs({
        jwt,
        pubkey,
        maxSignedDataLength: MAX_DATA_LENGTH,
      });
      say(`session key: 0x${session.publicKey.toString(16).slice(0, 16)}…`);
      // The signed part only (header.payload), which is what MAX_DATA_LENGTH bounds: the signature
      // is the third part and the circuit takes it as separate limbs
      const signed = jwt.lastIndexOf(".");
      say(
        `letter: ${signed} of ${MAX_DATA_LENGTH} bytes signed, sub ${sub.length} of ${MAX_SUB_LENGTH} chars`,
      );

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

  // Coming back from Google. Runs at mount, before any click: the letter is already in the fragment,
  // so the login continues on its own
  async function continueLogin() {
    try {
      // Undefined on a normal page load, and it throws on a letter we cannot trust
      const answer = readGoogleAnswer();
      if (!answer) return;
      setLog("");
      say("back from Google");
      // Garaga's WASM takes ~1.9 MB to compile and depends on nothing in the login, so start it before
      // the round trip to Google's JWKS rather than behind it. Not awaited here: prove() awaits the same
      // memoized promise, so a failure is reported there rather than lost
      void loadGaraga();
      // The letter names which key sealed it; the circuit takes that key as an input
      await prove({ ...answer, pubkey: await googleKey(answer.jwt) });
    } catch (e) {
      say(`error: ${e}`);
      console.error(e);
    }
  }
  void continueLogin();

  return (
    <main>
      <h1>0th</h1>
      <button onClick={loginWithGoogle}>Sign in with Google</button>
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
