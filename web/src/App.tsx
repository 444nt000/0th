/* @refresh reload */
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";

import circuit from "../../circuits/target/login.json";
import inputs from "../../circuits/Prover.json";

// Same bytes as `bb prove` writes. bb.js gives each public input as "0x" + 32 bytes in hex
const publicInputBytes = (xs: string[]) =>
  Uint8Array.fromHex(xs.map((x) => x.slice(2)).join(""));

const url = (bytes: Uint8Array) =>
  URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));

function App() {
  const [log, setLog] = createSignal("");
  const [proof, setProof] = createSignal<ProofData>();
  const say = (line: string) => setLog((l) => l + line + "\n");

  async function prove() {
    setLog("");
    setProof();
    say(
      `threads: ${navigator.hardwareConcurrency}, cross-origin isolated: ${crossOriginIsolated}`,
    );
    let backend: UltraHonkBackend | undefined;
    try {
      let t = performance.now();
      const lap = () => {
        const s = ((performance.now() - t) / 1000).toFixed(1);
        t = performance.now();
        return `${s}s`;
      };

      const { witness } = await new Noir(circuit as CompiledCircuit).execute(
        inputs,
      );
      say(`witness: ${lap()}`);

      backend = new UltraHonkBackend(circuit.bytecode, {
        threads: navigator.hardwareConcurrency,
        logger: console.log,
      });
      // same proof system as `bb prove -s ultra_honk --oracle_hash keccak` (ZK on) and Garaga's ultra_keccak_zk_honk
      const result = await backend.generateProof(witness, { keccakZK: true });
      say(`proof: ${lap()}`);
      setProof(result);

      const ok = await backend.verifyProof(result, { keccakZK: true });
      say(`verified in the browser: ${ok}`);
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
