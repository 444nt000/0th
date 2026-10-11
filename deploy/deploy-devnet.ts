// Deploys the shared contracts on a local devnet (make devnet) and writes contracts/deployments/devnet.json.
//
// usage: make deploy-devnet

import { Contract } from "starknet";
import {
  check,
  classAt,
  declare,
  deploy,
  devnetAccount,
  googleKeys,
  provider,
  send,
  testKey,
  writeDeployment,
} from "./devnet.ts";

// Every key a letter could be sealed with: Google's live ones for a real login, and the committed test
// key for the offline paths (`make e2e-devnet`, `make devnet-service`). The test key belongs on devnet
// only: its private half is committed, so it forges any login. A real network takes Google's keys alone,
// which is why the set is picked here and not inside the deploy helpers (`TRACKING.md`, Target layout)
const keys = [...(await googleKeys()), testKey()];

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
// One transaction for all of them, so a rerun after a Google rotation costs one round trip
const known = await Promise.all(
  keys.map((key) => registryContract.is_key(key)),
);
const missing = keys.filter((_, i) => !known[i]);
if (missing.length)
  await send(
    account,
    missing.map((key) => registryContract.populate("add_key", [key])),
  );

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
check(
  (await Promise.all(keys.map((key) => registryContract.is_key(key)))).every(
    Boolean,
  ),
  `registry knows all ${keys.length} keys (${keys.length - 1} from Google, 1 test)`,
);
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
