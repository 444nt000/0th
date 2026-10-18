async function post<T>(url: string, input: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {
    throw new Error(`cannot reach ${url}`);
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : res.statusText;
    throw new Error(`${url} failed: ${error}`);
  }
  return body as T;
}

// Deploys the account and registers the session key in one transaction, paid by the relayer
export const relay = (
  serverUrl: string,
  constructorCalldata: string[],
  proof: string[],
) =>
  post<{ address: string }>(`${serverUrl}/relay`, {
    constructorCalldata,
    proof,
  });

// The salt is derived server side, so an address cannot be computed from the claims alone
export const fetchSalt = async (serverUrl: string, jwt: string) =>
  BigInt((await post<{ salt: string }>(`${serverUrl}/salt`, { jwt })).salt);
