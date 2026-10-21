import { hasStringFields } from "./identity.ts";

const STORED = "0th.session";

const STORED_FIELDS = ["address", "privateKey", "publicKey", "expiry"] as const;

export type StoredSession = {
  address: string;
  session: { privateKey: string; publicKey: bigint };
  expiry: bigint;
};

export function storeSession({ address, session, expiry }: StoredSession) {
  localStorage.setItem(
    STORED,
    JSON.stringify({
      address,
      privateKey: session.privateKey,
      publicKey: String(session.publicKey),
      expiry: String(expiry),
    }),
  );
}

export function clearSession() {
  localStorage.removeItem(STORED);
}

// Loads the last stored session, unless it expired or was written by an older version
export function resumeSession(): StoredSession | undefined {
  const stored = localStorage.getItem(STORED);
  if (!stored) return undefined;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!hasStringFields(parsed, STORED_FIELDS))
      throw new Error("a field is missing");

    const expiry = BigInt(parsed.expiry);
    // The account refuses a signature from an expired session
    if (expiry * 1000n <= BigInt(Date.now()))
      throw new Error("the session has expired");

    return {
      address: parsed.address,
      session: {
        privateKey: parsed.privateKey,
        publicKey: BigInt(parsed.publicKey),
      },
      expiry,
    };
  } catch {
    // An expired or unreadable session is removed, so the page asks for a new login
    clearSession();
    return undefined;
  }
}
