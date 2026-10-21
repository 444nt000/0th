// REGISTRY_ADMIN_PRIVATE_KEY holds the admin role, so it can register its own RSA key and sign a letter for any user.
// Devnet and testnet only, until zkTLS makes the write permissionless

import { Account, RpcProvider, logger } from "starknet";
import { renewKeys } from "./keys.ts";

logger.setLogLevel("ERROR");

// Google's JWKS carries no expiry, so a key stays valid by being renewed hourly
const EVERY_MS = 60 * 60 * 1000;

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const account = new Account({
  provider: new RpcProvider({ nodeUrl: need("RPC_URL") }),
  address: need("REGISTRY_ADMIN_ACCOUNT"),
  signer: need("REGISTRY_ADMIN_PRIVATE_KEY"),
});
const registry = need("REGISTRY");

const pass = async () => {
  try {
    const keys = await renewKeys(account, registry);
    console.log(`${new Date().toISOString()} ${keys.length} key(s) renewed`);
  } catch (error) {
    // The next pass retries
    console.error(`${new Date().toISOString()} ${error}`);
  }
};

await pass();
setInterval(pass, EVERY_MS);
