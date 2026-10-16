// The redirect leaves the page, so a login cannot be one call: startLogin goes to the provider,
// pendingLogin picks the letter back up, finishLogin proves it and lands the account on chain

export { finishLogin, pendingLogin, startLogin } from "./login.ts";
export type { FinishConfig, LoginConfig, PendingLogin, Step } from "./login.ts";

export { accountAddress, sessionAccount } from "./account.ts";
export type { Deployment } from "./account.ts";

export type { Circuit, ProofStep } from "./proof.ts";
// Lets a dapp type its compiled circuit without depending on noir_js directly
export type { CompiledCircuit } from "@noir-lang/noir_js";

// Paired with accountAddress, these give a dapp the address before any login
export { identityHash, MAX_SUB_LENGTH } from "./identity.ts";
