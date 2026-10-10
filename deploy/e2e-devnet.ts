// Plays relayer and user on a local devnet: one login lands a transfer paid by the user's account.
//
// usage: make e2e-devnet  (needs make devnet, and a proof from make verifier)
//
// Shortcuts, devnet only: the letter is the test fixture (make fixtures), not Google's; the proof comes from
// `bb prove` on disk instead of the browser; the relayer is devnet's first account; funds come from devnet_mint.

import fs from "node:fs";
import { getZKHonkCallData, init as initGaraga } from "garaga";
import {
  Account,
  CallData,
  Contract,
  Signer,
  type WeierstrassSignatureType,
  cairo,
  ec,
  num,
} from "starknet";
import {
  check,
  classAt,
  devnetAccount,
  provider,
  readDeployment,
  relay,
  send,
  setTime,
} from "./devnet.ts";

// The session key the proof registers (circuits/scripts/fixture.ts)
const SESSION_PRIVKEY = "0x1234567890abcdef";
// Starknet's fee token, same address on every network
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const TRANSFER = 1000n;

// Position of each public input of the proof (circuits/src/main.nr)
const SESSION_KEY_INPUT = 18;
const EXPIRY_INPUT = 19;
const IDENTITY_INPUT = 20;

const TARGET = new URL("../circuits/target/", import.meta.url);

// Calldata of `register_session(proof: Span<felt252>)`: Garaga's felts, led by their count.
// Same bytes as `garaga calldata` (scripts/gen-verifier.sh), which writes the span without the count
async function proofCalldata() {
  await initGaraga();
  const read = (file: string) => {
    const path = new URL(file, TARGET);
    if (!fs.existsSync(path))
      throw new Error(`missing circuits/target/${file}: run make verifier`);
    return new Uint8Array(fs.readFileSync(path));
  };
  return getZKHonkCallData(read("proof"), read("public_inputs"), read("vk"));
}

// A public input of the proof, as u256. The calldata is `span_len, count, (low, high) * count, ...`
// (same layout as web/src/login.ts)
const publicInput = (calldata: bigint[], i: number) =>
  (calldata[3 + 2 * i] << 128n) | calldata[2 + 2 * i];

const relayer = await devnetAccount();
const { registry, verifier, accountClassHash } = readDeployment();

// Browser side: the proof of the login, and what it claims
const calldata = await proofCalldata();
const sessionKey = publicInput(calldata, SESSION_KEY_INPUT);
const expiry = publicInput(calldata, EXPIRY_INPUT);
const identityHash = publicInput(calldata, IDENTITY_INPUT);

check(
  BigInt(ec.starkCurve.getStarkKey(SESSION_PRIVKEY)) === sessionKey,
  "proof registers the fixture session key",
);

// The fixture's expiry is a fixed date, further out than MAX_SESSION allows from today, so move
// devnet's clock to one day before it: same convention as the account tests (tests/utils/setup.cairo)
await setTime(expiry - 24n * 3600n);

// Browser side: the address, from the identity and the contracts the account will trust.
// admin = the relayer until the role goes away (TRACKING.md, Later)
const constructorCalldata = CallData.compile([
  relayer.address,
  registry,
  verifier,
  cairo.uint256(identityHash),
]);
// Relayer side: deploy the account and register the session, in one transaction
const address = await relay(
  relayer,
  accountClassHash,
  constructorCalldata,
  calldata.map(String),
);
console.log(`account  ${address}`);

// The account class is declared by make deploy-devnet, which this target depends on
const accountClass = await provider.getClassByHash(accountClassHash);
check((await classAt(address)) === accountClassHash, "account deployed");
const account = new Contract({
  abi: accountClass.abi,
  address,
  providerOrAccount: provider,
});
check(
  BigInt(await account.get_session_expiry(sessionKey)) === expiry,
  "session registered in the same transaction",
);

// User side: a transfer signed by the session key, paid by the account.
// The account reads [session_key, r, s] (account.cairo, __validate__), so the key leads the signature
// instead of starknet.js's plain [r, s]. signRaw is the one place every signing path goes through.
// Same class as web/src/login.ts: it moves to sdk/ when that package exists (TRACKING.md, Target layout)
class SessionSigner extends Signer {
  async signRaw(hash: string) {
    // The base signer always signs on the Stark curve, so r and s are there
    const { r, s } = (await super.signRaw(hash)) as WeierstrassSignatureType;
    return [await this.getPubKey(), num.toHex(r), num.toHex(s)];
  }
}
const user = new Account({
  provider,
  address,
  signer: new SessionSigner(SESSION_PRIVKEY),
});
// Called directly, so the 672 KB STRK class never has to be fetched for its ABI.
// balance_of returns a u256, as [low, high]
const balance = async (who: string) => {
  const [low, high] = await provider.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [who],
  });
  return (BigInt(high) << 128n) | BigInt(low);
};
const [relayerBefore, accountBefore] = await Promise.all([
  balance(relayer.address),
  balance(address),
]);
await send(user, [
  {
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: CallData.compile([relayer.address, cairo.uint256(TRANSFER)]),
  },
]);
check(
  (await balance(relayer.address)) - relayerBefore === TRANSFER,
  "transfer signed by the session key landed",
);
// The relayer only paid the first transaction: the fee came out of the account, on top of the transfer
check(
  accountBefore - (await balance(address)) > TRANSFER,
  "the account paid its own fee",
);
