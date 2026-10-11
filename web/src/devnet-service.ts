// Client for the devnet service (deploy/devnet-service.ts, `make devnet-service`).
//
// Only `/relay`: the request the dev's real server will answer (`server/` in TRACKING.md, Target
// layout). The letter comes from Google itself (`src/google.ts`).

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

// Deploy the account and register the session, in one transaction paid by the relayer
export const relay = (constructorCalldata: string[], proof: string[]) =>
  post<{ address: string }>("/relay", { constructorCalldata, proof });
