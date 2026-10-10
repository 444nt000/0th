// Stands in for Google and the relayer on a local devnet: `make devnet-service`.
//
// Two endpoints, both devnet only:
//   POST /letter  { nonce }                      -> { jwt, pubkey }   Google's job (test RSA key)
//   POST /relay   { constructorCalldata, proof } -> { address }       deploy + register_session
//
// The relayer half is what the dev will host (`server/` in TRACKING.md, Target layout): same request, same
// transaction. The letter half disappears at the real Google redirect, but stays as the local test path:
// it is the only way to log in without Google's live keys in the registry.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import {
  declare,
  devnetAccount,
  provider,
  readDeployment,
  relay,
  setTime,
} from "./devnet.ts";

const PORT = 8787;

// Same claims, order and formats as circuits/scripts/fixture.ts, so a letter from here and one from
// `make fixtures` differ only in the nonce
const CLIENT_ID =
  "123456789012-0123456789abcdef0123456789abcdef.apps.googleusercontent.com";
const SUB = "123456789012345678901";
const GOOGLE_ISS = "https://accounts.google.com";

const privateKey = crypto.createPrivateKey(
  fs.readFileSync(
    new URL("../circuits/fixtures/test_rsa_key.pem", import.meta.url),
  ),
);
const publicKey = crypto.createPublicKey(privateKey);

// A letter naming whatever session key the nonce commits to, sealed with the test RSA key
function letter(nonce: string) {
  const payload = {
    iss: GOOGLE_ISS,
    azp: CLIENT_ID,
    aud: CLIENT_ID,
    sub: SUB,
    nonce,
    nbf: 1737641917,
    iat: 1737642217,
    exp: 1799999999,
    jti: "0123456789abcdef0123456789abcdef01234567",
  };
  const header = {
    alg: "RS256",
    kid: "0123456789abcdef0123456789abcdef01234567",
    typ: "JWT",
  };
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const signedData = `${b64(header)}.${b64(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(signedData), privateKey);
  return {
    jwt: `${signedData}.${signature.toString("base64url")}`,
    pubkey: publicKey.export({ format: "jwk" }),
  };
}

const relayer = await devnetAccount();
const { accountClassHash } = readDeployment();
// The account class must be declared before anyone can deploy one
await declare(relayer, "account_Account");

// A letter from here expires relative to now, so the account (`now < expiry`) only accepts it while the
// chain's clock is near now. `make e2e-devnet` leaves devnet in 2027: its letter is the committed fixture,
// whose expiry is a fixed date (`circuits/scripts/fixture.ts`, the real cause). So put the clock back once
// here, then refuse a letter nobody could register rather than rewriting the clock under whoever else is
// using the chain. A real Google letter removes all of this (TRACKING.md, Next)
await setTime(BigInt(Math.floor(Date.now() / 1000)));

async function assertClockIsNow() {
  const { timestamp } = await provider.getBlock("latest");
  const drift = Math.abs(timestamp - Math.floor(Date.now() / 1000));
  if (drift > 3600)
    throw new Error(
      `devnet's clock is ${(drift / 86400).toFixed(0)} days off, so this letter would expire on arrival: ` +
        `restart devnet (make e2e-devnet moves the clock to its fixture)`,
    );
}

const isFelts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((x) => typeof x === "string");

// Every input is untrusted, even on devnet: each route checks its own before touching the chain
const routes: Record<string, (input: Record<string, unknown>) => unknown> = {
  "/letter": async ({ nonce }) => {
    if (typeof nonce !== "string" || !/^[0-9]+$/.test(nonce))
      throw new Error("nonce must be a decimal string");
    await assertClockIsNow();
    return letter(nonce);
  },
  "/relay": async ({ constructorCalldata, proof }) => {
    if (!isFelts(constructorCalldata) || !isFelts(proof))
      throw new Error("constructorCalldata and proof must be arrays of felts");
    const address = await relay(
      relayer,
      accountClassHash,
      constructorCalldata,
      proof,
    );
    return { address };
  },
};

async function readBody(req: http.IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

http
  .createServer(async (req, res) => {
    // The page is cross-origin isolated and served from another port
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    const route = routes[req.url ?? ""];
    if (!route) return res.writeHead(404).end();

    const json = (status: number, value: unknown) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(value));
    try {
      const result = await route(await readBody(req));
      console.log(`ok   ${req.url}`);
      json(200, result);
    } catch (e) {
      console.log(`fail ${req.url}: ${e}`);
      json(400, { error: String(e) });
    }
  })
  .listen(PORT, () =>
    console.log(
      `devnet service on http://127.0.0.1:${PORT} (relayer ${relayer.address})`,
    ),
  );
