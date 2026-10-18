// Derives the per-user salt, so an address does not follow from a sub alone

import { hkdfSync } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_ISS = "https://accounts.google.com";

// Module level so the keys are fetched once, not per request
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export async function saltFor(seed: string, clientId: string, jwt: string) {
  const { payload } = await jwtVerify(jwt, googleKeys, {
    issuer: GOOGLE_ISS,
    audience: clientId,
  });
  if (typeof payload.sub !== "string") throw new Error("letter has no sub");

  // Binds the salt to the provider and the dapp, so one seed can serve several of either
  const salt = hkdfSync(
    "sha256",
    seed,
    `${GOOGLE_ISS}|${clientId}`,
    payload.sub,
    31,
  );
  return BigInt(`0x${Buffer.from(salt).toString("hex")}`);
}
