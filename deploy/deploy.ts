// usage: node deploy.ts <devnet|sepolia|mainnet> [verifier|registry|account]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { testKey } from "./devnet.ts";

const NETWORKS = ["devnet", "sepolia", "mainnet"];
const CONTRACTS_DIR = fileURLToPath(new URL("../contracts/", import.meta.url));

// Builds the calldata for registry.add_key/is_key from google's public key, already split into 120
// bit chunks by the circuit. The contract expects the chunk count first, then each chunk followed by a 0
const keyCalldata = (limbs: string[]) => [
  String(limbs.length),
  ...limbs.flatMap((limb) => [limb, "0"]),
];

// Runs sncast and parses its --json output. sncast prints one JSON object per line, and some errors
// as plain text instead, so every parsed field is merged into one object and the raw output kept too
function sncast(...args: string[]): Record<string, string> & { raw: string } {
  const { error, stdout, stderr } = spawnSync(
    "sncast",
    ["--json", "--profile", network, ...args],
    { cwd: CONTRACTS_DIR, encoding: "utf8" },
  );
  if (error) throw error;
  const raw = `${stdout}${stderr}`;
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    try {
      Object.assign(fields, JSON.parse(line));
    } catch {}
  }
  return { ...fields, raw };
}

// Labels a transaction hash as new or unchanged (if it was already on chain)
const label = (hash: string, known: boolean) =>
  `${hash} (${known ? "unchanged" : "new"})`;

// Returns the field, or throws with the raw sncast output if it is missing
function must(out: { raw: string } & Record<string, string>, field: string) {
  const value = out[field];
  if (!value) throw new Error(`missing ${field}:\n${out.raw}`);
  return value;
}

function declare(contractName: string, pkg: string) {
  const out = sncast(
    "--wait",
    "declare",
    "--contract-name",
    contractName,
    "--package",
    pkg,
  );
  // sncast has no check-first option for declare, unlike deploy's classAt: an existing class is only
  // found by erroring, and the error message carries the hash
  const known = out.raw.match(
    /class hash (0x[0-9a-fA-F]+) is already declared/,
  )?.[1];
  const classHash = out.class_hash ?? known;
  if (!classHash)
    throw new Error(`failed to declare ${contractName}:\n${out.raw}`);
  return { classHash, log: label(classHash, Boolean(known)) };
}

// Returns the class hash at an address, or undefined if nothing is deployed there yet
async function classAt(address: string) {
  const res = await fetch(config.rpc_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_getClassHashAt",
      params: { block_id: "latest", contract_address: address },
    }),
  });
  return ((await res.json()) as { result?: string }).result;
}

// Deploys through the UDC with salt 0, so the address depends only on the class hash and the
// constructor calldata. Running this again with the same arguments finds the same address and skips
// the deploy instead of erroring
async function deploy(
  classHash: string,
  constructorCalldata: readonly string[],
) {
  const args = ["--class-hash", classHash, "--salt", "0x0"];
  if (constructorCalldata.length)
    args.push("--constructor-calldata", ...constructorCalldata);

  const address = must(
    sncast("utils", "contract-address", "--url", config.rpc_url, ...args),
    "contract_address",
  );
  const known = Boolean(await classAt(address));
  if (!known) must(sncast("--wait", "deploy", ...args), "contract_address");
  return { address, log: label(address, known) };
}

// Adds the test key to the registry if it is not there yet, and returns new or unchanged
function addTestKey(registry: string) {
  const calldata = keyCalldata(testKey());
  const target = ["--contract-address", registry, "--function"];

  if (
    sncast("call", ...target, "is_key", "--calldata", ...calldata).response ===
    "true"
  )
    return "unchanged";

  must(
    sncast("--wait", "invoke", ...target, "add_key", "--calldata", ...calldata),
    "transaction_hash",
  );
  return "new";
}

const [network, only] = process.argv.slice(2);
if (!NETWORKS.includes(network))
  throw new Error(`usage: node deploy.ts <${NETWORKS.join("|")}> [contract]`);

const config = sncast("show-config");

// The accounts file is keyed by chain id. Devnet and Sepolia share one chain id, so the account is
// searched for across every chain's bucket
const accounts: Record<
  string,
  Record<string, { address: string }>
> = JSON.parse(
  fs.readFileSync(`${CONTRACTS_DIR}${config.accounts_file_path}`, "utf8"),
);
const admin = Object.values(accounts)
  .map((chain) => chain[config.account]?.address)
  .find(Boolean);
if (!admin)
  throw new Error(
    `no account ${config.account} in ${config.accounts_file_path}`,
  );

// The account is declared here, not deployed: each user's instance takes a different identity hash,
// so there is no single constructor calldata to deploy with
const CONTRACTS = {
  verifier: {
    contractName: "UltraKeccakZKHonkVerifier",
    constructorCalldata: [],
  },
  registry: { contractName: "Registry", constructorCalldata: [admin] },
  account: { contractName: "Account", declareOnly: true },
} as const;

if (only && !(only in CONTRACTS))
  throw new Error(
    `unknown contract ${only}: one of ${Object.keys(CONTRACTS).join(", ")}`,
  );

console.log(`Deploying to ${network} (admin: ${admin})`);
const deployed: Record<string, string> = { admin };

for (const [pkg, contract] of Object.entries(CONTRACTS)) {
  if (only && only !== pkg) continue;

  const declared = declare(contract.contractName, pkg);
  deployed[`${pkg}ClassHash`] = declared.classHash;

  if ("declareOnly" in contract) {
    console.log(`${pkg} class ${declared.log}`);
    continue;
  }

  const instance = await deploy(
    declared.classHash,
    contract.constructorCalldata,
  );
  deployed[pkg] = instance.address;
  console.log(`${pkg} ${instance.log}\n    class ${declared.log}`);
}

// Only seeded on devnet: the test key's private half is in the repo, so anyone can forge a login
// against it. Run once here, after the loop, instead of inside it
if (network === "devnet" && deployed.registry)
  console.log(`test key (${addTestKey(deployed.registry)})`);

// Merged with the existing file, so deploying one contract leaves the others in it untouched
const file = `${CONTRACTS_DIR}deployments/${network}.json`;
const existing = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
const merged = JSON.stringify({ ...existing, ...deployed }, null, 2) + "\n";
if (merged !== JSON.stringify(existing, null, 2) + "\n") {
  fs.mkdirSync(`${CONTRACTS_DIR}deployments`, { recursive: true });
  fs.writeFileSync(file, merged);
  console.log(`Written to ${file}`);
}
