// add_key is admin-only, so this account can forge any login (devnet only until zkTLS)

import { Account, RpcProvider, logger } from "starknet";
import { addKeys } from "./keys.ts";

logger.setLogLevel("ERROR");

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const account = new Account({
  provider: new RpcProvider({ nodeUrl: need("RPC_URL") }),
  address: need("ACCOUNT"),
  signer: need("PRIVATE_KEY"),
});

const added = await addKeys(account, need("REGISTRY"));
console.log(`${added.length} key(s) added`);
