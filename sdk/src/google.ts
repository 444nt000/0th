import { hasStringFields, segment } from "./identity.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const PENDING = "0th.login";

// What crosses the redirect in sessionStorage, so every value is a string
const STORED_FIELDS = [
  "privateKey",
  "publicKey",
  "expiry",
  "secret",
  "state",
] as const;

type StoredLogin = Record<(typeof STORED_FIELDS)[number], string>;

export function redirectToGoogle(
  clientId: string,
  redirectUri: string,
  nonce: string,
  session: { privateKey: string; publicKey: bigint },
  expiry: bigint,
  secret: bigint,
) {
  const state = crypto.randomUUID();
  const pending: StoredLogin = {
    privateKey: session.privateKey,
    publicKey: String(session.publicKey),
    expiry: String(expiry),
    secret: String(secret),
    state,
  };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    // minimum scope OAuth requires to get a token back
    scope: "openid",
    response_type: "id_token",
    nonce,
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

export function readGoogleAnswer() {
  const pending = sessionStorage.getItem(PENDING);
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.size) return undefined;
  history.replaceState(null, "", location.pathname);
  sessionStorage.removeItem(PENDING);

  const error = fragment.get("error");
  if (error) throw new Error(`Google refused the login: ${error}`);

  const jwt = fragment.get("id_token");
  if (!jwt) return undefined;
  if (!pending)
    throw new Error("a letter came back, but this tab was not logging in");

  const parsed: unknown = JSON.parse(pending);
  if (!hasStringFields(parsed, STORED_FIELDS))
    throw new Error("the stored login is unreadable");
  // Confirms this letter came from this login, not a replayed one
  if (fragment.get("state") !== parsed.state)
    throw new Error("state does not match: this letter is not from this login");

  return {
    jwt,
    session: {
      privateKey: parsed.privateKey,
      publicKey: BigInt(parsed.publicKey),
    },
    expiry: BigInt(parsed.expiry),
    secret: BigInt(parsed.secret),
  };
}

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Fetches Google's current signing keys and picks the one matching the letter's kid
export async function googleKey(jwt: string) {
  const { kid } = segment(jwt, 0) as { kid?: unknown };
  if (typeof kid !== "string") throw new Error("letter has no kid");

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`cannot reach Google's JWKS (${JWKS_URL})`);
  const { keys } = (await res.json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) throw new Error(`Google's JWKS has no key ${kid}`);
  return key;
}
