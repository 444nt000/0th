/* @refresh reload */

import { createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import { CallData, RpcProvider, cairo, type Call } from "starknet";
import {
  finishLogin,
  pendingLogin,
  sessionAccount,
  startLogin,
  type Circuit,
  type CompiledCircuit,
} from "sdk";

import program from "../../circuits/target/login.json";
import deployment from "../../contracts/addresses/devnet.json";
// A base64 data URL in the bundle, so the key costs no extra request
import vkUrl from "../../circuits/target/vk?inline";

// TODO: drop the fallback and require VITE_GOOGLE_CLIENT_ID once web is a real demo dapp
const CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  "16619420523-e9c66plhahqsbj7u4090p1d66iapd4p4.apps.googleusercontent.com";
// Registered on the client id byte for byte: Google treats a missing or extra trailing slash as a
// different URI and answers 400 redirect_uri_mismatch. The origin and a bare "/", not
// location.pathname, so a deep link still sends the one value that is registered
const REDIRECT_URI = `${location.origin}/`;

const RPC_URL = "http://127.0.0.1:5050/rpc";
const RELAY_URL = "http://127.0.0.1:8787/relay";
// TODO: read it from the dev's salt endpoint, which derives it per user
const SALT = 12345n;

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

  // Runs at mount, since the letter is already in the URL when Google sends the user back
  async function resume() {
    try {
      const answer = pendingLogin();
      if (!answer) return;
      setLog("");
      say("back from Google");
      // The prover only uses several threads in a cross-origin isolated page
      say(
        `threads: ${crossOriginIsolated ? navigator.hardwareConcurrency : 1}` +
          ` (cross-origin isolated: ${crossOriginIsolated})`,
      );

      const { address, session, expiry } = await finishLogin(answer, {
        clientId: CLIENT_ID,
        deployment,
        relayUrl: RELAY_URL,
        circuit,
        salt: SALT,
        onStep: (step, ms) => say(`${step}: ${(ms / 1000).toFixed(1)}s`),
      });
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
      <pre>{log()}</pre>
    </main>
  );
}

render(() => <App />, document.getElementById("root")!);
