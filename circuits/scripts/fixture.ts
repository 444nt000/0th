import crypto from "crypto";
import fs from "fs";
import { createRequire } from "module";

// noir-jwt 0.4.5's ESM build has extensionless imports Node cannot resolve, so load its CommonJS build
const { generateInputs } = createRequire(import.meta.url)("noir-jwt");

const nonce = "123123123";
const email = "alice@test.com";

export async function createKeyAndSignData() {
  // Fresh RSA key, same shape as Google's (2048-bit, exponent 65537)
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 65537,
  });

  // Sample payload
  const payload = {
    iss: "http://test.com",
    sub: "ABCD123123",
    email_verified: true,
    nonce,
    email,
    iat: 1737642217,
    aud: "123123123.456456456",
    exp: 1799999999, // 2027-01-15T07:59:59.000Z
  };

  // Sign the payload: RS256 is RSA PKCS#1 v1.5 over SHA-256 of "header.payload"
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const signedData = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(signedData), privateKey);
  const jwt = `${signedData}.${signature.toString("base64url")}`;

  // Convert public key to JWK
  const pubkeyJwk = publicKey.export({ format: "jwk" });

  return {
    pubkeyJwk,
    jwt,
    payload,
  };
}

// Write a valid letter as circuit inputs, in the layout `nargo check` generates
async function writeProverToml() {
  const { pubkeyJwk, jwt } = await createKeyAndSignData();

  const inputs = await generateInputs({
    jwt,
    pubkey: pubkeyJwk as JsonWebKey,
    maxSignedDataLength: 1024, // MAX_DATA_LENGTH in src/main.nr
  });

  const arr = (xs: unknown[]) => JSON.stringify(xs.map(String));
  const toml = [
    `base64_decode_offset = "${inputs.base64_decode_offset}"`,
    `pubkey_modulus_limbs = ${arr(inputs.pubkey_modulus_limbs)}`,
    `redc_params_limbs = ${arr(inputs.redc_params_limbs)}`,
    `signature_limbs = ${arr(inputs.signature_limbs)}`,
    "",
    "[data]",
    `len = "${inputs.data!.len}"`,
    `storage = ${arr(inputs.data!.storage)}`,
    "",
  ].join("\n");

  fs.writeFileSync(new URL("../Prover.toml", import.meta.url), toml);
}

writeProverToml().catch(console.error);
