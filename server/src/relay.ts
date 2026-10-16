// Pays the deploy and register_session of a login
// Both calls are open to anyone, only the proof grants a session key

import http from "node:http";
import {
  Account,
  RpcProvider,
  type Call,
  addAddressPadding,
  defaultDeployer,
  hash,
  logger,
} from "starknet";

// starknet.js warns on every fee estimate that a quiet chain has too few transactions to sample
logger.setLogLevel("ERROR");

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const rpcUrl = need("RPC_URL");
const accountClassHash = need("ACCOUNT_CLASS_HASH");
const relayer = new Account({
  provider: new RpcProvider({ nodeUrl: rpcUrl }),
  address: need("ACCOUNT"),
  signer: need("PRIVATE_KEY"),
});

// Devnet has no onramp, so DEVNET funds a new account for the transactions it pays itself
const devnetMint = (address: string) =>
  process.env.DEVNET &&
  fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "devnet_mint",
      params: { address, amount: 2000000000000000000, unit: "FRI" },
    }),
  });

// Salt 0 and the deployer out of the hash, so the same login always lands on the same account
const udcAddress = (constructorCalldata: string[]) =>
  addAddressPadding(
    hash.calculateContractAddressFromHash(
      0,
      accountClassHash,
      constructorCalldata,
      0,
    ),
  );

// Every login registers a session key, only the first one deploys
async function relay(constructorCalldata: string[], proof: string[]) {
  const address = udcAddress(constructorCalldata);
  const deployed = await relayer.provider
    .getClassHashAt(address)
    .catch(() => undefined);

  const calls: Call[] = [];
  if (!deployed) {
    await devnetMint(address);
    calls.push(
      ...defaultDeployer.buildDeployerCall(
        {
          classHash: accountClassHash,
          salt: "0x0",
          unique: false,
          constructorCalldata,
        },
        relayer.address,
      ).calls,
    );
  }
  calls.push({
    contractAddress: address,
    entrypoint: "register_session",
    calldata: proof,
  });

  const { transaction_hash } = await relayer.execute(calls);
  await relayer.provider.waitForTransaction(transaction_hash);
  return address;
}

const isFelts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((x) => typeof x === "string");

async function readBody(req: http.IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const port = Number(process.env.PORT ?? 8787);

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
      const { constructorCalldata, proof } = await readBody(req);
      if (!isFelts(constructorCalldata) || !isFelts(proof))
        throw new Error(
          "constructorCalldata and proof must be arrays of felts",
        );

      const address = await relay(constructorCalldata, proof);
      json(200, { address });
      console.log(`ok   /relay ${address}`);
    } catch (e) {
      console.log(`fail /relay: ${e}`);
      json(400, { error: String(e) });
    }
  })
  .listen(port, () =>
    console.log(`relayer on http://127.0.0.1:${port} (${relayer.address})`),
  );
