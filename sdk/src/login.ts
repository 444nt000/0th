import { accountAddress, type Deployment } from "./account.ts";
import { googleKey, readGoogleAnswer, redirectToGoogle } from "./google.ts";
import {
  claims,
  identityHash,
  loginNonce,
  newSessionKey,
  randomSecret,
} from "./identity.ts";
import {
  type Circuit,
  loadGaraga,
  type ProofStep,
  proveLogin,
} from "./proof.ts";
import { fetchSalt, relay } from "./server.ts";
import { storeSession } from "./session.ts";

// A day, well under the 30 the account caps a session at
const SESSION_LENGTH = 24n * 3600n;

export type Step = ProofStep | "relay";

export type PendingLogin = NonNullable<ReturnType<typeof readGoogleAnswer>>;

export type LoginConfig = {
  // The dapp's client id at the provider. Public, no secret in this flow
  clientId: string;
  // Must match what is registered, byte for byte, trailing slash included
  redirectUri: string;
};

export type FinishConfig = {
  clientId: string;
  deployment: Deployment;
  serverUrl: string;
  circuit: Circuit;
  onStep?: (step: Step, ms: number) => void;
};

export function startLogin({ clientId, redirectUri }: LoginConfig) {
  const session = newSessionKey();
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + SESSION_LENGTH;
  const secret = randomSecret();
  redirectToGoogle(
    clientId,
    redirectUri,
    loginNonce(session.publicKey, expiry, secret),
    session,
    expiry,
    secret,
  );
}

// The letter the provider left in the URL, or undefined on an ordinary page load
export const pendingLogin = (): PendingLogin | undefined => readGoogleAnswer();

export async function finishLogin(
  answer: PendingLogin,
  { clientId, deployment, serverUrl, circuit, onStep }: FinishConfig,
) {
  const { jwt, session, expiry, secret } = answer;

  // Garaga's WASM depends on nothing in the letter, so it compiles during the checks and the
  // fetch below
  void loadGaraga();

  // Checked up front so a bad letter fails before spending time on a proof
  const { aud, sub } = claims(
    jwt,
    clientId,
    loginNonce(session.publicKey, expiry, secret),
  );

  const [providerKey, salt] = await Promise.all([
    googleKey(jwt),
    fetchSalt(serverUrl, jwt),
  ]);

  const { calldata, identity } = await proveLogin(
    circuit,
    { jwt, providerKey },
    { publicKey: session.publicKey, expiry, secret, salt },
    onStep,
  );

  // Catches this package and the circuit disagreeing on how an identity is built
  const expected = identityHash(aud, sub, salt);
  if (expected !== identity)
    throw new Error(
      `identity_hash differs: computed 0x${expected.toString(16)}, proved 0x${identity.toString(16)}`,
    );

  const { address, constructorCalldata } = accountAddress(deployment, identity);

  const since = performance.now();
  const relayed = await relay(
    serverUrl,
    constructorCalldata,
    calldata.map(String),
  );
  // The relayer cannot choose the address, it follows from the class hash and constructor data
  if (BigInt(relayed.address) !== BigInt(address))
    throw new Error(`relayer deployed ${relayed.address}, not ${address}`);
  onStep?.("relay", performance.now() - since);

  storeSession({ address, session, expiry });
  return { address, session, expiry };
}
