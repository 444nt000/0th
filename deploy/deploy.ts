import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const NETWORKS = ["devnet", "sepolia", "mainnet"];
const CONTRACTS_DIR = fileURLToPath(new URL("../contracts/", import.meta.url));

// Runs sncast and parses its --json output
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

// Salt 0, so the address depends only on the class hash and the constructor calldata: running this
// again with the same arguments finds the same address and skips the deploy
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

const [network, only] = process.argv.slice(2);
if (!NETWORKS.includes(network))
  throw new Error(`usage: node deploy.ts <${NETWORKS.join("|")}> [contract]`);

const config = sncast("show-config");

// Gets the deployer's address from sncast's accounts file
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

// Declare account. Each user gets their own instance, deployed during account creation.
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

// Merged with the existing json deployment file, so deploying one contract leaves the others in it untouched
const file = `${CONTRACTS_DIR}addresses/${network}.json`;
const existing = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
const merged = JSON.stringify({ ...existing, ...deployed }, null, 2) + "\n";
if (merged !== JSON.stringify(existing, null, 2) + "\n") {
  fs.mkdirSync(`${CONTRACTS_DIR}addresses`, { recursive: true });
  fs.writeFileSync(file, merged);
  console.log(`Written to ${file}`);
}
