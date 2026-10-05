import crypto from "crypto";
import fs from "fs";
import { poseidon3, poseidon8 } from "poseidon-lite";
import { createRequire } from "module";

// noir-jwt 0.4.5's ESM build has extensionless imports Node cannot resolve, so load its CommonJS build
const { generateInputs } = createRequire(import.meta.url)("noir-jwt");

const SALT = 12345n; // fixed for experiments, the real one comes from the dev's salt endpoint
const EXPIRY = 1800000000n; // session expiry, a Starknet timestamp
const GOOGLE_ISS = "https://accounts.google.com";
const digits = (n: number) =>
  Array.from(crypto.randomBytes(n), (b) => b % 10).join("");
const felt = () => BigInt("0x" + crypto.randomBytes(31).toString("hex"));

function createKeyAndSignData(iss: string, nonce: string) {
  // Fresh RSA key, same shape as Google's (2048-bit, exponent 65537)
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 65537,
  });

  // Google-shaped payload for scope "openid" only (no email, no profile): claim order and formats as Google sends them
  const clientId = `${digits(12)}-${crypto.randomBytes(16).toString("hex")}.apps.googleusercontent.com`;
  const payload = {
    iss,
    azp: clientId,
    aud: clientId,
    sub: digits(21),
    nonce,
    nbf: 1737641917,
    iat: 1737642217,
    exp: 1799999999, // 2027-01-15T07:59:59.000Z
    jti: crypto.randomBytes(20).toString("hex"),
  };

  // Sign the payload: RS256 is RSA PKCS#1 v1.5 over SHA-256 of "header.payload"
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const signedData = `${b64({ alg: "RS256", kid: crypto.randomBytes(20).toString("hex"), typ: "JWT" })}.${b64(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(signedData), privateKey);
  const jwt = `${signedData}.${signature.toString("base64url")}`;

  // Convert public key to JWK
  const pubkeyJwk = publicKey.export({ format: "jwk" });

  return { pubkeyJwk, jwt, payload };
}

// Same as `pack` in src/main.nr: 31 bytes per field, big-endian, zero-padded to max
const pack = (s: string, max: number) => {
  const bytes = Buffer.alloc(max);
  Buffer.from(s).copy(bytes);
  return Array.from({ length: max / 31 }, (_, i) =>
    BigInt("0x" + bytes.subarray(i * 31, (i + 1) * 31).toString("hex")),
  );
};

// usage: node scripts/fixture.ts [prover name] [iss]
//   e.g. `Bad_iss http://test.com` writes Bad_iss.toml, a letter for a test that must fail
const [name = "Prover", iss = GOOGLE_ISS] = process.argv.slice(2);

// Browser side: a stand-in session public key (a random felt, not a real Stark key) and the secret.
// The nonce sent to Google is Poseidon(session key, expiry, secret) in decimal
const sessionPubkey = felt();
const secret = felt();
const nonce = poseidon3([sessionPubkey, EXPIRY, secret]).toString();

const { pubkeyJwk, jwt, payload } = createKeyAndSignData(iss, nonce);

// Expected circuit output: `nargo execute` fails if the circuit's identity_hash differs from this one
const identityHash = poseidon8([
  ...pack(GOOGLE_ISS, 31),
  ...pack(payload.aud, 93),
  BigInt(payload.aud.length),
  ...pack(payload.sub, 31),
  BigInt(payload.sub.length),
  SALT,
]);

const inputs = await generateInputs({
  jwt,
  pubkey: pubkeyJwk,
  maxSignedDataLength: 1024, // MAX_DATA_LENGTH in src/main.nr
});

// Circuit inputs, in the layout `nargo check` generates
const arr = (xs: unknown[]) => JSON.stringify(xs.map(String));
const toml = [
  `base64_decode_offset = "${inputs.base64_decode_offset}"`,
  `pubkey_modulus_limbs = ${arr(inputs.pubkey_modulus_limbs)}`,
  `redc_params_limbs = ${arr(inputs.redc_params_limbs)}`,
  `signature_limbs = ${arr(inputs.signature_limbs)}`,
  `session_pubkey = "${sessionPubkey}"`,
  `expiry = "${EXPIRY}"`,
  `secret = "${secret}"`,
  `salt = "${SALT}"`,
  `return = "${identityHash}"`,
  "",
  "[data]",
  `len = "${inputs.data.len}"`,
  `storage = ${arr(inputs.data.storage)}`,
  "",
].join("\n");

fs.writeFileSync(new URL(`../${name}.toml`, import.meta.url), toml);
