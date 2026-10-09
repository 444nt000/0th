// Deploys the shared contracts on a local devnet (make devnet) and writes contracts/deployments/devnet.json.

import fs from "node:fs";
import {
  Account,
  Contract,
  RpcProvider,
  addAddressPadding,
  hash,
  json,
  logger,
} from "starknet";
import prover from "../circuits/Prover.json" with { type: "json" };

logger.setLogLevel("ERROR");

const RPC_URL = "http://127.0.0.1:5050/rpc";
const ARTIFACTS = new URL("../contracts/target/dev/", import.meta.url);
const OUTPUT = new URL("../contracts/deployments/devnet.json", import.meta.url);

// The RSA key that signs the test JWTs (circuits/scripts/fixture.ts), as 18 limbs
const testKey = prover.pubkey_modulus_limbs;

async function devnetAccount() {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "devnet_getPredeployedAccounts",
    }),
  }).catch(() => undefined);
  const accounts = (await res?.json())?.result;
  if (!accounts) throw new Error(`no devnet at ${RPC_URL}: run make devnet`);
  return accounts[0] as { address: string; private_key: string };
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const { address: admin, private_key } = await devnetAccount();
const account = new Account({ provider, address: admin, signer: private_key });

const read = (file: string) =>
  json.parse(fs.readFileSync(new URL(file, ARTIFACTS), "utf8"));

async function declare(name: string) {
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
const classAt = (address: string) =>
  provider.getClassHashAt(address).then(addAddressPadding, () => undefined);

// Through the UDC with salt 0, not unique: the address depends only on the class and the constructor data
async function deploy(classHash: string, constructorCalldata: string[]) {
  const address = addAddressPadding(
    hash.calculateContractAddressFromHash(0, classHash, constructorCalldata, 0),
  );
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

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`check failed: ${what}`);
  console.log(`ok   ${what}`);
}

// Verifier
const verifierClass = await declare("verifier_UltraKeccakZKHonkVerifier");
const verifier = await deploy(verifierClass.classHash, []);

// Registry
const registryClass = await declare("registry_Registry");
const registry = await deploy(registryClass.classHash, [admin]);
const registryContract = new Contract({
  abi: registryClass.abi,
  address: registry,
  providerOrAccount: account,
});
if (!(await registryContract.is_key(testKey))) {
  const { transaction_hash } = await registryContract.add_key(testKey);
  await provider.waitForTransaction(transaction_hash);
}

// Account
const accountClass = await declare("account_Account");

// Read back from the chain
check(
  (await classAt(verifier)) === verifierClass.classHash,
  "verifier deployed",
);
check(
  (await classAt(registry)) === registryClass.classHash,
  "registry deployed",
);
check(await registryContract.is_key(testKey), "registry knows the test key");
check(
  await provider.getClassByHash(accountClass.classHash).then(
    () => true,
    () => false,
  ),
  "account declared",
);

const deployment = {
  admin: addAddressPadding(admin),
  verifier,
  registry,
  accountClassHash: accountClass.classHash,
};
fs.writeFileSync(OUTPUT, JSON.stringify(deployment, null, 2) + "\n");
console.log(deployment);
