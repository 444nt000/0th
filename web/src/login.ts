// The browser's side of a login: session key, nonce, identity and address.
//
// This is what `sdk/` will be (TRACKING.md, Target layout). `pack` and `identityHash` mirror
// `circuits/src/main.nr`: the circuit computes the same value, and the account stores it, so these
// layouts must never drift.

import {
  Account,
  CallData,
  type Call,
  type RpcProvider,
  Signer,
  type WeierstrassSignatureType,
  cairo,
  ec,
  encode,
  hash,
  num,
} from "starknet";
import { poseidon3, poseidon8 } from "poseidon-lite";

const GOOGLE_ISS = "https://accounts.google.com";
// Multiples of 31, same as src/main.nr: pack cuts text into 31-byte pieces
const MAX_AUD_LENGTH = 93;
const MAX_SUB_LENGTH = 31;

// Same as `pack` in src/main.nr: 31 bytes per Field, padded with 0 bytes
function pack(text: string, max: number) {
  const bytes = new Uint8Array(max);
  bytes.set(new TextEncoder().encode(text));
  return Array.from({ length: max / 31 }, (_, i) =>
    encode.uint8ArrayToBigInt(bytes.subarray(i * 31, (i + 1) * 31)),
  );
}

type LetterPayload = { iss: string; aud: string; sub: string };

const isLetterPayload = (value: unknown): value is LetterPayload =>
  typeof value === "object" &&
  value !== null &&
  ["iss", "aud", "sub"].every(
    (claim) => typeof (value as Record<string, unknown>)[claim] === "string",
  );

// The claims the identity is built from, read from the letter the way the circuit reads them.
// The letter is untrusted input here: the proof is what vouches for it, and only later
export function claims(jwt: string): { aud: string; sub: string } {
  // base64url, unpadded as JWTs are, then UTF-8 like the bytes the circuit packs
  const payload: unknown = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.fromBase64(jwt.split(".")[1], { alphabet: "base64url" }),
    ),
  );
  if (!isLetterPayload(payload))
    throw new Error("letter has no iss, aud or sub");
  const { iss, aud, sub } = payload;
  if (iss !== GOOGLE_ISS) throw new Error(`letter is not Google's: iss ${iss}`);
  // The circuit's limits: a longer claim cannot be proven
  if (aud.length > MAX_AUD_LENGTH) throw new Error(`aud too long: ${aud}`);
  if (sub.length > MAX_SUB_LENGTH) throw new Error(`sub too long: ${sub}`);
  return { aud, sub };
}

// Same layout as `identity_hash` in src/main.nr. Lengths are hashed because pack pads with 0 bytes
export function identityHash(aud: string, sub: string, salt: bigint) {
  const audFields = pack(aud, MAX_AUD_LENGTH);
  const subFields = pack(sub, MAX_SUB_LENGTH);
  return poseidon8([
    pack(GOOGLE_ISS, 31)[0],
    audFields[0],
    audFields[1],
    audFields[2],
    BigInt(aud.length),
    subFields[0],
    BigInt(sub.length),
    salt,
  ]);
}

// What the browser sends Google at login. Google copies it into the letter, under its seal,
// so the letter vouches for this session key and expiry. `secret` hides the key from Google
export const loginNonce = (
  sessionPubkey: bigint,
  expiry: bigint,
  secret: bigint,
) => poseidon3([sessionPubkey, expiry, secret]).toString();

// Hides the session key from Google (`secret` in src/main.nr). 31 bytes always fits a Field
export const randomSecret = () =>
  encode.uint8ArrayToBigInt(crypto.getRandomValues(new Uint8Array(31)));

// A public input of the proof, as u256. Garaga's calldata is `span_len, count, (low, high) * count, ...`
export const publicInput = (calldata: bigint[], i: number) =>
  (calldata[3 + 2 * i] << 128n) | calldata[2 + 2 * i];

// Position of each public input the account reads (src/main.nr, contracts/account)
export const IDENTITY_INPUT = 20;

// A session key pair. Stark curve, so WebCrypto cannot hold it: it is plain JS data
export function newSessionKey() {
  const privateKey = encode.addHexPrefix(
    encode.buf2hex(ec.starkCurve.utils.randomPrivateKey()),
  );
  return {
    privateKey,
    publicKey: BigInt(ec.starkCurve.getStarkKey(privateKey)),
  };
}

// The account reads [session_key, r, s] (contracts/account, __validate__), so the key leads the
// signature instead of starknet.js's plain [r, s]. signRaw is the one place every signing path goes through
class SessionSigner extends Signer {
  async signRaw(hash: string) {
    // The base signer always signs on the Stark curve, so r and s are there
    const { r, s } = (await super.signRaw(hash)) as WeierstrassSignatureType;
    return [await this.getPubKey(), num.toHex(r), num.toHex(s)];
  }
}

// An account that signs with its session key and pays its own fees
export const sessionAccount = (
  provider: RpcProvider,
  address: string,
  sessionPrivkey: string,
) =>
  new Account({ provider, address, signer: new SessionSigner(sessionPrivkey) });

// Starknet's fee token, same address on every network
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const transferCall = (to: string, amount: bigint): Call => ({
  contractAddress: STRK,
  entrypoint: "transfer",
  calldata: CallData.compile([to, cairo.uint256(amount)]),
});

// The account's address: the class and the constructor data decide it, so the browser can compute it
// before the account exists (deploy/e2e-devnet.ts does the same, through the UDC with salt 0)
export function accountAddress(
  classHash: string,
  admin: string,
  registry: string,
  verifier: string,
  identity: bigint,
) {
  const constructorCalldata = CallData.compile([
    admin,
    registry,
    verifier,
    cairo.uint256(identity),
  ]);
  return {
    constructorCalldata,
    address: hash.calculateContractAddressFromHash(
      0,
      classHash,
      constructorCalldata,
      0,
    ),
  };
}
