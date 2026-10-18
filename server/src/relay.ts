import {
  Account,
  type Call,
  addAddressPadding,
  defaultDeployer,
  hash,
} from "starknet";

export const isFelts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((x) => typeof x === "string");

// New accounts are funded here to cover deployment fees. Devnet only
const devnetMint = (nodeUrl: string, address: string) =>
  fetch(nodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "devnet_mint",
      params: { address, amount: 2000000000000000000, unit: "FRI" },
    }),
  });

type RelayConfig = {
  relayer: Account;
  accountClassHash: string;
  nodeUrl: string;
  devnet: boolean;
};

// Salt 0 and the deployer out of the hash, so the same login always lands on the same account
const udcAddress = (accountClassHash: string, constructorCalldata: string[]) =>
  addAddressPadding(
    hash.calculateContractAddressFromHash(
      0,
      accountClassHash,
      constructorCalldata,
      0,
    ),
  );

// Every login registers a session key, only the first one deploys
export async function relay(
  { relayer, accountClassHash, nodeUrl, devnet }: RelayConfig,
  constructorCalldata: string[],
  proof: string[],
) {
  const address = udcAddress(accountClassHash, constructorCalldata);
  const deployed = await relayer.provider
    .getClassHashAt(address)
    .catch(() => undefined);

  const calls: Call[] = [];
  if (!deployed) {
    if (devnet) await devnetMint(nodeUrl, address);
    calls.push(
      ...defaultDeployer.buildDeployerCall(
        {
          classHash: accountClassHash,
          salt: "0x0",
          unique: false,
          constructorCalldata,
        },
        relayer.address,
      ).calls,
    );
  }
  calls.push({
    contractAddress: address,
    entrypoint: "register_session",
    calldata: proof,
  });

  const { transaction_hash } = await relayer.execute(calls);
  await relayer.provider.waitForTransaction(transaction_hash);
  return address;
}
