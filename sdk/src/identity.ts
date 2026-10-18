import { ec, encode } from "starknet";
import { poseidon3, poseidon8 } from "poseidon-lite";

const GOOGLE_ISS = "https://accounts.google.com";
const AUD_FIELDS = 3;
const MAX_AUD_LENGTH = 31 * AUD_FIELDS;
const MAX_SUB_LENGTH = 31;

// Cuts text into Fields of 31 bytes, big-endian, zero-padded: 31 is the largest size that always
// fits a Field
function pack(text: string, fields: number) {
  const bytes = new Uint8Array(31 * fields);
  bytes.set(new TextEncoder().encode(text));
  return Array.from({ length: fields }, (_, i) =>
    encode.uint8ArrayToBigInt(bytes.subarray(i * 31, (i + 1) * 31)),
  );
}

// The circuit counts bytes, so a non-ASCII claim must not be measured in UTF-16 code units
const byteLength = (text: string) => new TextEncoder().encode(text).length;

export const hasStringFields = <K extends string>(
  value: unknown,
  fields: readonly K[],
): value is Record<K, string> =>
  typeof value === "object" &&
  value !== null &&
  fields.every(
    (field) => typeof (value as Record<string, unknown>)[field] === "string",
  );

// One part of a JWT, JSON parsed: 0 is the header, 1 the payload
export function segment(jwt: string, i: 0 | 1): unknown {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("not a JWT: expected three parts");
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.fromBase64(parts[i]!, { alphabet: "base64url" }),
    ),
  );
}

// The claims an identity is built from, rejecting a wrong iss, aud or nonce
export function claims(jwt: string, clientId: string, nonce: string) {
  const payload = segment(jwt, 1);
  if (!hasStringFields(payload, ["iss", "aud", "sub", "nonce"]))
    throw new Error("letter has no iss, aud, sub or nonce");
  const { iss, aud, sub, nonce: sealed } = payload;
  if (iss !== GOOGLE_ISS) throw new Error(`letter is not Google's: iss ${iss}`);
  if (aud !== clientId)
    throw new Error(`letter is for another app: aud ${aud}`);
  if (sealed !== nonce)
    throw new Error("letter does not name this session key");
  if (byteLength(aud) > MAX_AUD_LENGTH) throw new Error(`aud too long: ${aud}`);
  if (byteLength(sub) > MAX_SUB_LENGTH) throw new Error(`sub too long: ${sub}`);
  return { aud, sub };
}

// The account's own identity, which it stores at deploy and rejects any other. The lengths are
// hashed too, so "123" and "1230" cannot collide. The layout is fixed: changing it moves every
// address, and the circuit proves the same hash
export function identityHash(aud: string, sub: string, salt: bigint) {
  return poseidon8([
    ...pack(GOOGLE_ISS, 1),
    ...pack(aud, AUD_FIELDS),
    BigInt(byteLength(aud)),
    ...pack(sub, 1),
    BigInt(byteLength(sub)),
    salt,
  ]);
}

// Sent to the provider at login, copied into the letter under its seal. secret keeps the provider
// from learning the session key
export const loginNonce = (
  sessionPublicKey: bigint,
  expiry: bigint,
  secret: bigint,
) => poseidon3([sessionPublicKey, expiry, secret]).toString();

export const randomSecret = () =>
  encode.uint8ArrayToBigInt(crypto.getRandomValues(new Uint8Array(31)));

export function newSessionKey() {
  const privateKey = encode.addHexPrefix(
    encode.buf2hex(ec.starkCurve.utils.randomPrivateKey()),
  );
  return {
    privateKey,
    publicKey: BigInt(ec.starkCurve.getStarkKey(privateKey)),
  };
}
