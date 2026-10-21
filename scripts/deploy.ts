import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const NETWORKS = ["devnet", "sepolia", "mainnet"];
const CONTRACTS_DIR = fileURLToPath(new URL("../contracts/", import.meta.url));
const DEPLOYMENTS_DIR = fileURLToPath(
  new URL("../deployments/", import.meta.url),
);

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
const deployed: Record<string, string> = { ADMIN: admin };

for (const [pkg, contract] of Object.entries(CONTRACTS)) {
  if (only && only !== pkg) continue;

  const declared = declare(contract.contractName, pkg);
  deployed[`${pkg.toUpperCase()}_CLASS_HASH`] = declared.classHash;

  if ("declareOnly" in contract) {
    console.log(`${pkg} class ${declared.log}`);
    continue;
  }

  const instance = await deploy(
    declared.classHash,
    contract.constructorCalldata,
  );
  deployed[pkg.toUpperCase()] = instance.address;
  console.log(`${pkg} ${instance.log}\n    class ${declared.log}`);
}

const file = `${DEPLOYMENTS_DIR}${network}.env`;
const existing: Record<string, string> = {};
if (fs.existsSync(file))
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#"))
      existing[line.slice(0, eq)] = line.slice(eq + 1);
  }
const record = { ...existing, ...deployed };
fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
fs.writeFileSync(
  file,
  "# Written by the deploy, read by the services and the demo. Edit the deploy, not this file\n" +
    Object.entries(record)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
);
console.log(`Written to ${file}`);
