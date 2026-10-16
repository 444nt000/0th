import {
  Account,
  CallData,
  type RpcProvider,
  Signer,
  type WeierstrassSignatureType,
  cairo,
  hash,
  num,
} from "starknet";

// The account contract's constructor arguments
export type Deployment = {
  admin: string;
  registry: string;
  verifier: string;
  accountClassHash: string;
};

export function accountAddress(deployment: Deployment, identity: bigint) {
  const constructorCalldata = CallData.compile([
    deployment.admin,
    deployment.registry,
    deployment.verifier,
    cairo.uint256(identity),
  ]);
  return {
    constructorCalldata,
    address: hash.calculateContractAddressFromHash(
      0,
      deployment.accountClassHash,
      constructorCalldata,
      0,
    ),
  };
}

// Signs as [session_key, r, s], naming which session key signed
class SessionSigner extends Signer {
  async signRaw(hash: string) {
    const { r, s } = (await super.signRaw(hash)) as WeierstrassSignatureType;
    return [await this.getPubKey(), num.toHex(r), num.toHex(s)];
  }
}

export const sessionAccount = (
  provider: RpcProvider,
  address: string,
  sessionPrivateKey: string,
) =>
  new Account({
    provider,
    address,
    signer: new SessionSigner(sessionPrivateKey),
  });
