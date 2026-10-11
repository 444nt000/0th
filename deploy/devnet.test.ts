// Checks on the key helpers in devnet.ts, the ones that decide what the registry trusts.
// No chain and no network: `keyLimbs` is pure, so a wrong key must be refused here.
//
// usage: make test (node --test, nothing installed)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { keyLimbs, testKey } from "./devnet.ts";

const rsaKey = (modulusLength: number, publicExponent = 65537) =>
  crypto
    .generateKeyPairSync("rsa", { modulusLength, publicExponent })
    .publicKey.export({ format: "jwk" });

test("the test key gives 18 limbs of 120 bits", () => {
  const limbs = testKey();
  assert.equal(limbs.length, 18);
  assert.ok(limbs.every((limb) => BigInt(limb) < 1n << 120n));
});

test("the limbs are the circuit's own, little endian", () => {
  // setup: a key whose modulus is known, so each limb is known
  const modulus = (1n << 2047n) | 0xabcdefn;
  const jwk = {
    kty: "RSA",
    e: "AQAB",
    n: Buffer.from(modulus.toString(16).padStart(512, "0"), "hex").toString(
      "base64url",
    ),
  };

  // assertions: limb 0 is the low 120 bits, limb 17 the top ones
  const limbs = keyLimbs(jwk);
  assert.equal(BigInt(limbs[0]), 0xabcdefn);
  assert.equal(BigInt(limbs[17]), modulus >> (17n * 120n));
});

test("a key the circuit cannot verify is refused", () => {
  // 18 limbs of 120 bits hold 2160, but noir_rsa is instantiated for 2048: a longer modulus would
  // be truncated into one nobody signs with, a shorter one is not what the circuit checks
  assert.throws(() => keyLimbs(rsaKey(3072)), /not 2048 bits/);
  assert.throws(() => keyLimbs(rsaKey(1024)), /not 2048 bits/);
  // the circuit fixes the exponent at 65537, so another one proves nothing about this key
  assert.throws(() => keyLimbs(rsaKey(2048, 3)), /not 65537/);
  // only RSA has a modulus to store
  assert.throws(
    () =>
      keyLimbs(
        crypto
          .generateKeyPairSync("ec", { namedCurve: "P-256" })
          .publicKey.export({ format: "jwk" }),
      ),
    /not an RSA public key/,
  );
});
