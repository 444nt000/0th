export { finishLogin, pendingLogin, startLogin } from "./login.ts";
export type { FinishConfig, LoginConfig, PendingLogin, Step } from "./login.ts";

export { accountAddress, sessionAccount } from "./account.ts";
export type { Deployment } from "./account.ts";

export type { Circuit, ProofStep } from "./proof.ts";
// Lets a dapp type its compiled circuit without depending on noir_js directly
export type { CompiledCircuit } from "@noir-lang/noir_js";

export { identityHash } from "./identity.ts";
