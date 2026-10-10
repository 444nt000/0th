// Devnet helpers shared by the deploy script (deploy-devnet.ts) and the end-to-end run (e2e-devnet.ts).

import fs from "node:fs";
import {
  Account,
  type Call,
  RpcProvider,
  addAddressPadding,
  defaultDeployer,
  hash,
  json,
  logger,
} from "starknet";

logger.setLogLevel("ERROR");

const RPC_URL = "http://127.0.0.1:5050/rpc";
const ARTIFACTS = new URL("../contracts/target/dev/", import.meta.url);

export const provider = new RpcProvider({ nodeUrl: RPC_URL });

// A devnet JSON-RPC method (devnet_*), outside the Starknet spec so starknet.js does not expose it
async function devnetCall<T>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).catch(() => undefined);
  if (!res) throw new Error(`no devnet at ${RPC_URL}: run make devnet`);
  const body = await res.json();
  if (body.error)
    throw new Error(`devnet refused ${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

// Devnet's first predeployed account. Refuses to run elsewhere: devnet's chain id is Sepolia's,
// so the chain id cannot tell them apart
export async function devnetAccount() {
  const [first] = await devnetCall<{ address: string; private_key: string }[]>(
    "devnet_getPredeployedAccounts",
  );
  return new Account({
    provider,
    // Padded, so the address reads the same everywhere (deployments JSON, logs)
    address: addAddressPadding(first.address),
    signer: first.private_key,
  });
}

// Gives an address enough fee token to pay for its own transactions
export const mint = (address: string, amount: number) =>
  devnetCall("devnet_mint", { address, amount, unit: "FRI" });

// Moves devnet's clock, so a committed proof fixture can be used past its real date
export const setTime = (time: bigint) =>
  devnetCall("devnet_setTime", { time: Number(time), generate_block: true });

const read = (file: string) =>
  json.parse(fs.readFileSync(new URL(file, ARTIFACTS), "utf8"));

export async function declare(account: Account, name: string) {
  const contract = read(`${name}.contract_class.json`);
  const casm = read(`${name}.compiled_contract_class.json`);
  const { class_hash, transaction_hash } = await account.declareIfNot({
    contract,
    casm,
  });
  if (transaction_hash) await provider.waitForTransaction(transaction_hash);
  return { classHash: addAddressPadding(class_hash), abi: contract.abi };
}

// The class deployed at an address, or undefined
export const classAt = (address: string) =>
  provider.getClassHashAt(address).then(addAddressPadding, () => undefined);

// Through the UDC with salt 0, not unique: the address depends only on the class and the constructor data
export const udcAddress = (classHash: string, constructorCalldata: string[]) =>
  addAddressPadding(
    hash.calculateContractAddressFromHash(0, classHash, constructorCalldata, 0),
  );

export async function deploy(
  account: Account,
  classHash: string,
  constructorCalldata: string[],
) {
  const address = udcAddress(classHash, constructorCalldata);
  if (!(await classAt(address))) {
    const { transaction_hash } = await account.deployContract({
      classHash,
      constructorCalldata,
      salt: "0x0",
      unique: false,
    });
    await provider.waitForTransaction(transaction_hash);
  }
  return address;
}

export async function send(account: Account, calls: Call[]) {
  const { transaction_hash } = await account.execute(calls);
  return provider.waitForTransaction(transaction_hash);
}

// What the relayer funds a new account with. It pays its own fees from then on, and a proof check
// is ~197M L2 gas
const FUNDING = 2e18;

// The relayer's transaction, the one the dev's server will send (`E2E.md` step 6): deploy the user's
// account and register the session key its proof names. The relayer cannot steal, both calls are open
// to anyone and only the proof grants keys.
// `register_session` runs at every login, the deploy only at the first one: a returning user already has
// an account, and their new session key still has to be registered
export async function relay(
  relayer: Account,
  classHash: string,
  constructorCalldata: string[],
  proof: string[],
) {
  const address = udcAddress(classHash, constructorCalldata);
  const deployed = await classAt(address);
  // Funded once, at the first login: the account pays for everything after this transaction
  if (!deployed) await mint(address, FUNDING);
  const deploy = deployed
    ? []
    : defaultDeployer.buildDeployerCall(
        { classHash, salt: "0x0", unique: false, constructorCalldata },
        relayer.address,
      ).calls;
  await send(relayer, [
    ...deploy,
    {
      contractAddress: address,
      entrypoint: "register_session",
      calldata: proof,
    },
  ]);
  return address;
}

export function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`check failed: ${what}`);
  console.log(`ok   ${what}`);
}

export type Deployment = {
  admin: string;
  verifier: string;
  registry: string;
  accountClassHash: string;
};

const DEPLOYMENT = new URL(
  "../contracts/deployments/devnet.json",
  import.meta.url,
);

export const writeDeployment = (deployment: Deployment) =>
  fs.writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + "\n");

export const readDeployment = (): Deployment =>
  JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
