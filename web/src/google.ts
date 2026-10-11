// Google login, by redirect.
//
// `response_type=id_token` is the implicit flow: Google answers with the letter itself, in the URL
// fragment, and there is no client secret and no token exchange. A full-page navigation, not a popup,
// so the page keeps COOP `same-origin` and bb.js keeps its threads (`E2E.md`, section 2).
//
// The session key is made before leaving and used after coming back, so it has to survive the
// navigation: sessionStorage, which is scoped to this tab and dropped when it closes. The key is plain
// JS data either way (WebCrypto has no Stark curve), so this adds no exposure the page did not already
// have (`TRACKING.md`, Next, carried over).

import { segment } from "./login";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const PENDING = "0th.login";

// What the browser keeps across the redirect. Everything the proof needs besides the letter
type Pending = {
  privateKey: string;
  publicKey: string;
  expiry: string;
  secret: string;
  state: string;
};

const isPending = (value: unknown): value is Pending =>
  typeof value === "object" &&
  value !== null &&
  ["privateKey", "publicKey", "expiry", "secret", "state"].every(
    (field) => typeof (value as Record<string, unknown>)[field] === "string",
  );

// Leaves the page. Google comes back to `redirectUri` with the letter in the fragment
export function redirectToGoogle(
  clientId: string,
  redirectUri: string,
  nonce: string,
  session: { privateKey: string; publicKey: bigint },
  expiry: bigint,
  secret: bigint,
) {
  // Checked when Google answers: a letter is only ours if it carries the state we just stored
  const state = crypto.randomUUID();
  const pending: Pending = {
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
    response_type: "id_token",
    // `openid` alone: the circuit reads iss, aud, sub and the nonce, and nothing asks for a name
    // or an email, so a login needs no consent screen beyond signing in
    scope: "openid",
    // Google copies it into the letter, under its seal: this is what binds the letter to our session key
    nonce,
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

// The letter Google left in the fragment, with what we stored before leaving. Undefined on a normal
// page load. Clears both, so a reload does not try to reuse a letter that is already spent
export function readGoogleAnswer() {
  const pending = sessionStorage.getItem(PENDING);
  // Google answers in the fragment, so the letter never reaches a server or a log
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.size) return undefined;
  // Clear the fragment first: a reload must not look like a fresh answer
  history.replaceState(null, "", location.pathname);
  sessionStorage.removeItem(PENDING);

  const error = fragment.get("error");
  if (error) throw new Error(`Google refused the login: ${error}`);

  const jwt = fragment.get("id_token");
  if (!jwt) return undefined;
  if (!pending)
    throw new Error("a letter came back, but this tab was not logging in");

  const parsed: unknown = JSON.parse(pending);
  if (!isPending(parsed)) throw new Error("the stored login is unreadable");
  // Our own value, round-tripped through Google: a letter carrying another one is not from our login
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

// Google's live signing keys. The letter names one in its `kid`; the circuit takes the key as an input,
// so the browser picks it. Same URL as deploy/devnet.ts (GOOGLE_JWKS_URL), which seeds the registry from
// it: keep the two in step, or the browser proves against a key the registry does not hold and the
// account rejects the login. They cannot share a constant yet, being a browser and a Node package with
// no dependency between them; it lands in `sdk/` (TRACKING.md, Target layout)
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export async function googleKey(jwt: string) {
  const { kid } = segment(jwt, 0) as { kid?: unknown };
  if (typeof kid !== "string") throw new Error("letter has no kid");

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`cannot reach Google's JWKS (${JWKS_URL})`);
  const { keys } = (await res.json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };
  const key = keys.find((candidate) => candidate.kid === kid);
  // Google rotates: a letter older than the key it names cannot be proven, and nothing we hold fixes it
  if (!key) throw new Error(`Google's JWKS has no key ${kid}`);
  return key;
}
