// Checks on the letter claims, the ones that decide which address a login lands on.
// Pure, so no browser and no chain. The DOM parts of a login (the redirect, sessionStorage) are not
// covered here: they need a browser, and a real login through the page is what exercises them.
//
// usage: make test (node --test, nothing installed)

import assert from "node:assert/strict";
import test from "node:test";
import { claims, identityHash, loginNonce, segment } from "./login.ts";

const CLIENT_ID = "an-app.apps.googleusercontent.com";
const SUB = "123456789012345678901";
const NONCE = "456";

// A letter is a JWT: header.payload.signature, each base64url. Only the payload is read here,
// so the seal can be anything: the proof is what vouches for it (login.ts, claims).
// Encoded the way a browser does it, since that is what claims decodes
const letter = (payload: object) =>
  `e30.${new TextEncoder()
    .encode(JSON.stringify(payload))
    .toBase64({ alphabet: "base64url", omitPadding: true })}.e30`;

const google = (over: Record<string, unknown> = {}) =>
  letter({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: SUB,
    nonce: NONCE,
    ...over,
  });

test("reads one part of a JWT, or says it is not one", () => {
  // 0 is the header, 1 the payload: both paths of a login decode one of them
  assert.deepEqual(segment(google(), 1), {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: SUB,
    nonce: NONCE,
  });
  // anything that is not three base64url parts is not a letter, and says so instead of throwing
  // an opaque decode error further in
  assert.throws(() => segment("header.payload", 1), /not a JWT/);
  assert.throws(() => segment("", 0), /not a JWT/);
});

test("reads aud and sub from a Google letter", () => {
  const { aud, sub } = claims(google(), CLIENT_ID, NONCE);
  assert.equal(aud, CLIENT_ID);
  assert.equal(sub, SUB);
});

test("a letter that is not about this login is refused", () => {
  // another issuer: anyone can sign a letter, only Google's counts
  assert.throws(
    () => claims(google({ iss: "https://evil.example" }), CLIENT_ID, NONCE),
    /not Google's/,
  );
  // another app: a real Google letter, but its aud gives a different identity_hash, so proving it
  // would build an address this page does not control
  assert.throws(
    () => claims(google({ aud: "another-app" }), CLIENT_ID, NONCE),
    /for another app/,
  );
  // another nonce: the letter does not name our session key, so the circuit would refuse it
  assert.throws(() => claims(google(), CLIENT_ID, "999"), /this session key/);
  // a claim the circuit cannot pack
  assert.throws(
    () => claims(google({ sub: "x".repeat(32) }), CLIENT_ID, NONCE),
    /sub too long/,
  );
  assert.throws(
    () => claims(google({ aud: "x".repeat(94) }), "x".repeat(94), NONCE),
    /aud too long/,
  );
  // claims missing altogether
  assert.throws(() => claims(letter({ iss: "x" }), CLIENT_ID, NONCE), /has no/);
});

test("the identity is the claims, not the letter", () => {
  // setup: two letters for the same person and app, one issued later with another session key
  const first = identityHash(CLIENT_ID, SUB, 1n);
  const second = identityHash(CLIENT_ID, SUB, 1n);

  // assertions: same identity, so the same address on every login
  assert.equal(first, second);
  // a different app, a different person or a different salt is a different account
  assert.notEqual(first, identityHash("other-app", SUB, 1n));
  assert.notEqual(first, identityHash(CLIENT_ID, "999", 1n));
  assert.notEqual(first, identityHash(CLIENT_ID, SUB, 2n));
});

test("the nonce commits to the session key, the expiry and the secret", () => {
  const nonce = loginNonce(7n, 100n, 3n);
  // decimal, as Google copies it into the letter and the circuit reads it
  assert.match(nonce, /^[0-9]+$/);
  // changing any of the three changes it, so a letter cannot be reused for another session
  assert.notEqual(nonce, loginNonce(8n, 100n, 3n));
  assert.notEqual(nonce, loginNonce(7n, 101n, 3n));
  assert.notEqual(nonce, loginNonce(7n, 100n, 4n));
});
