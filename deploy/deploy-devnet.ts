// Deploys the shared contracts on a local devnet (make devnet) and writes contracts/deployments/devnet.json.
//
// usage: make deploy-devnet

import { Contract } from "starknet";
import prover from "../circuits/Prover.json" with { type: "json" };
import {
  check,
  classAt,
  declare,
  deploy,
  devnetAccount,
  provider,
  writeDeployment,
} from "./devnet.ts";

// The RSA key that signs the test JWTs (circuits/scripts/fixture.ts), as 18 limbs
const testKey = prover.pubkey_modulus_limbs;

const account = await devnetAccount();
const admin = account.address;

// Verifier
const verifierClass = await declare(
  account,
  "verifier_UltraKeccakZKHonkVerifier",
);
const verifier = await deploy(account, verifierClass.classHash, []);

// Registry
const registryClass = await declare(account, "registry_Registry");
const registry = await deploy(account, registryClass.classHash, [admin]);
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
const accountClass = await declare(account, "account_Account");

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
  admin,
  verifier,
  registry,
  accountClassHash: accountClass.classHash,
};
writeDeployment(deployment);
console.log(deployment);
