// The relayer, on a local devnet: `make devnet-service`.
//
//   POST /relay  { constructorCalldata, proof } -> { address }
//
// One endpoint, the one the dev will host (`server/` in TRACKING.md, Target layout): it sends the first
// transaction of a login, deploy + `register_session`, and pays for it. Same request, same transaction.
// It cannot steal: both calls are open to anyone, and only the proof grants a session key.

import http from "node:http";
import { declare, devnetAccount, readDeployment, relay } from "./devnet.ts";

const PORT = 8787;

const relayer = await devnetAccount();
const { accountClassHash } = readDeployment();
// The account class must be declared before anyone can deploy one
await declare(relayer, "account_Account");

const isFelts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((x) => typeof x === "string");

// Every input is untrusted, even on devnet: checked before anything touches the chain
async function handleRelay(body: Record<string, unknown>) {
  const { constructorCalldata, proof } = body;
  if (!isFelts(constructorCalldata) || !isFelts(proof))
    throw new Error("constructorCalldata and proof must be arrays of felts");
  const address = await relay(
    relayer,
    accountClassHash,
    constructorCalldata,
    proof,
  );
  return { address };
}

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
    if (req.url !== "/relay") return res.writeHead(404).end();

    const json = (status: number, value: unknown) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(value));
    try {
      json(200, await handleRelay(await readBody(req)));
      console.log("ok   /relay");
    } catch (e) {
      console.log(`fail /relay: ${e}`);
      json(400, { error: String(e) });
    }
  })
  .listen(PORT, () =>
    console.log(
      `devnet relayer on http://127.0.0.1:${PORT} (${relayer.address})`,
    ),
  );
