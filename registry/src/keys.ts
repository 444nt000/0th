import { type webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import type { Account } from "starknet";

// noir-jwt 0.4.5's ESM build breaks in Node (extensionless imports), so load its CommonJS build
const { splitBigIntToChunks } = createRequire(import.meta.url)(
  "noir-jwt",
) as typeof import("noir-jwt");

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Splits the modulus with noir-jwt's own function, the one the circuit's pubkey_modulus_limbs comes
// from, so the registry and the circuit cannot carve a key differently
function keyLimbs(jwk: webcrypto.JsonWebKey) {
  if (jwk.kty !== "RSA" || !jwk.n) throw new Error("not an RSA public key");
  // The circuit fixes the exponent at 65537, so another one would prove nothing about this key
  if (jwk.e !== "AQAB") throw new Error(`exponent is not 65537: e ${jwk.e}`);
  const modulus = BigInt(
    `0x${Buffer.from(jwk.n, "base64url").toString("hex")}`,
  );
  // 18 limbs of 120 bits hold 2160, but noir_rsa is instantiated for 2048: a longer key would be
  // silently truncated into a modulus nobody signs with
  if (modulus.toString(2).length !== 2048)
    throw new Error(`key is not 2048 bits: ${modulus.toString(2).length}`);
  return splitBigIntToChunks(modulus, 120, 18).map(String);
}

// Several keys, since Google publishes the next one before it rotates to it
async function googleKeys() {
  const res = await fetch(JWKS_URL).catch(() => undefined);
  if (!res?.ok) throw new Error(`cannot reach Google's JWKS (${JWKS_URL})`);
  const { keys } = (await res.json()) as {
    keys: (webcrypto.JsonWebKey & { alg?: string })[];
  };
  // The circuit checks a PKCS#1 v1.5 SHA-256 seal and nothing else
  const signing = keys.filter((key) => key.alg === "RS256");
  if (!signing.length) throw new Error("Google publishes no RS256 key");
  return signing.map(keyLimbs);
}

// The registry takes each limb as a u256, so every limb is followed by its zero half
const keyCalldata = (limbs: string[]) => [
  String(limbs.length),
  ...limbs.flatMap((limb) => [limb, "0"]),
];

// Keys already there are left alone, so a rotation only costs one transaction for the new key
export async function addKeys(account: Account, registry: string) {
  const keys = await googleKeys();
  const known = await Promise.all(
    keys.map(async (limbs) => {
      const [is] = await account.provider.callContract({
        contractAddress: registry,
        entrypoint: "is_key",
        calldata: keyCalldata(limbs),
      });
      return BigInt(is!) !== 0n;
    }),
  );

  const missing = keys.filter((_, i) => !known[i]);
  if (missing.length) {
    const { transaction_hash } = await account.execute(
      missing.map((limbs) => ({
        contractAddress: registry,
        entrypoint: "add_key",
        calldata: keyCalldata(limbs),
      })),
    );
    await account.provider.waitForTransaction(transaction_hash);
  }
  return missing;
}
