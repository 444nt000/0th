/* @refresh reload */

import { createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import { CallData, RpcProvider, cairo, type Call } from "starknet";
import {
  clearSession,
  finishLogin,
  pendingLogin,
  resumeSession,
  sessionAccount,
  startLogin,
  type Circuit,
  type CompiledCircuit,
  type Deployment,
  type StoredSession,
} from "sdk";

import program from "../../circuits/target/login.json";
// Inlined as a data URL, so the key costs no request
import vkUrl from "../../circuits/target/vk?inline";

// Vite inlines import.meta.env at build time, so an unset variable is undefined in the bundle
function need(name: string) {
  const value = import.meta.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const CLIENT_ID = need("VITE_GOOGLE_CLIENT_ID");
// Must match the client id's registered URI byte for byte, trailing slash included, or Google
// answers 400 redirect_uri_mismatch. Not location.pathname, so a deep link still sends this value
const REDIRECT_URI = `${location.origin}/`;

const RPC_URL = need("VITE_RPC_URL");
const SERVER_URL = need("VITE_SERVER_URL");

const deployment: Deployment = {
  admin: need("VITE_ADMIN"),
  registry: need("VITE_REGISTRY"),
  verifier: need("VITE_VERIFIER"),
  accountClassHash: need("VITE_ACCOUNT_CLASS_HASH"),
};

const TRANSFER = 1000n;
// Starknet's fee token, same address on every network
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const transfer = (to: string, amount: bigint): Call => ({
  contractAddress: STRK,
  entrypoint: "transfer",
  calldata: CallData.compile([to, cairo.uint256(amount)]),
});

const circuit: Circuit = {
  program: program as CompiledCircuit,
  verificationKey: Uint8Array.fromBase64(vkUrl.split(",")[1]!),
};

function App() {
  const [log, setLog] = createSignal("");
  const say = (line: string) => setLog((l) => l + line + "\n");

  function signIn() {
    setLog("");
    say(`redirect_uri: ${REDIRECT_URI}`);
    startLogin({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
  }

  async function spend({ address, session, expiry }: StoredSession) {
    say(`address: ${address}`);
    say(`session until: ${new Date(Number(expiry) * 1000).toISOString()}`);

    const account = sessionAccount(
      new RpcProvider({ nodeUrl: RPC_URL }),
      address,
      session.privateKey,
    );
    const { transaction_hash } = await account.execute([
      transfer(deployment.admin, TRANSFER),
    ]);
    say(`transfer signed by the session key: ${transaction_hash}`);
  }

  function signOut() {
    clearSession();
    setLog("");
    say("signed out");
  }

  // Runs at mount: the user is back from Google, or already has a session
  async function resume() {
    try {
      const kept = resumeSession();
      if (kept) {
        setLog("");
        await spend(kept);
        return;
      }

      const answer = pendingLogin();
      if (!answer) return;
      setLog("");
      say("back from Google");
      say(
        `threads: ${crossOriginIsolated ? navigator.hardwareConcurrency : 1}`,
      );

      await spend(
        await finishLogin(answer, {
          clientId: CLIENT_ID,
          deployment,
          serverUrl: SERVER_URL,
          circuit,
          onStep: (step, ms) => say(`${step}: ${(ms / 1000).toFixed(1)}s`),
        }),
      );
    } catch (e) {
      say(`error: ${e}`);
      console.error(e);
    }
  }
  onMount(resume);

  return (
    <main>
      <h1>0th</h1>
      <button onClick={signIn}>Sign in with Google</button>
      <button onClick={signOut}>Sign out</button>
      <pre>{log()}</pre>
    </main>
  );
}

render(() => <App />, document.getElementById("root")!);
