// Client for the devnet service (deploy/devnet-service.ts, `make devnet-service`).
//
// It plays Google (`/letter`) and the relayer (`/relay`). The relay call is the shape the dev's real
// server will answer (`server/` in TRACKING.md, Target layout); the letter call is devnet only.

const SERVICE = "http://127.0.0.1:8787";

async function post<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(SERVICE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {
    throw new Error(`no devnet service at ${SERVICE}: run make devnet-service`);
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${body.error}`);
  return body as T;
}

// Google's job on devnet: a letter whose nonce commits to our session key, sealed with the test RSA key
export const getLetter = (nonce: string) =>
  post<{ jwt: string; pubkey: JsonWebKey }>("/letter", { nonce });

// Deploy the account and register the session, in one transaction paid by the relayer
export const relay = (constructorCalldata: string[], proof: string[]) =>
  post<{ address: string }>("/relay", { constructorCalldata, proof });
