import { Account, RpcProvider, logger } from "starknet";
import { isFelts, relay } from "./relay.ts";
import { saltFor } from "./salt.ts";
import { need, serve } from "./serve.ts";

logger.setLogLevel("ERROR");

const rpcUrl = need("RPC_URL");
const seed = need("SEED");
const clientId = need("GOOGLE_CLIENT_ID");

const relayConfig = {
  relayer: new Account({
    provider: new RpcProvider({ nodeUrl: rpcUrl }),
    address: need("ACCOUNT"),
    signer: need("PRIVATE_KEY"),
  }),
  accountClassHash: need("ACCOUNT_CLASS_HASH"),
  nodeUrl: rpcUrl,
  devnet: Boolean(process.env.DEVNET),
};

serve(
  {
    "/relay": async ({ constructorCalldata, proof }) => {
      if (!isFelts(constructorCalldata) || !isFelts(proof))
        throw new Error(
          "constructorCalldata and proof must be arrays of felts",
        );
      return { address: await relay(relayConfig, constructorCalldata, proof) };
    },
    "/salt": async ({ jwt }) => {
      if (typeof jwt !== "string") throw new Error("jwt must be a string");
      return { salt: String(await saltFor(seed, clientId, jwt)) };
    },
  },
  Number(process.env.PORT ?? 8787),
);
