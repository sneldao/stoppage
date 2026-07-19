/**
 * TxLINE fixtures API — snapshot of upcoming and current fixtures.
 */

import type { Network, TxLineCredentials, Fixture } from "./types";
import { getApiBase } from "./config";

function authHeaders(creds: TxLineCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.jwt}`,
    "X-Api-Token": creds.apiToken,
  };
}

/**
 * Fetch all fixtures, optionally filtered by competition ID.
 */
export async function fetchFixtures(
  network: Network,
  creds: TxLineCredentials,
  competitionId?: number
): Promise<Fixture[]> {
  const url = new URL(`${getApiBase(network)}/fixtures/snapshot`);
  if (competitionId !== undefined) {
    url.searchParams.set("competitionId", String(competitionId));
  }
  const resp = await fetch(url.toString(), {
    headers: { ...authHeaders(creds), "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Fixtures snapshot failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as Fixture[];
}

/**
 * Fetch a single fixture by ID.
 * Convenience wrapper around fetchFixtures with client-side filtering.
 */
export async function fetchFixture(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number
): Promise<Fixture | null> {
  const all = await fetchFixtures(network, creds);
  return all.find((f) => f.FixtureId === fixtureId) ?? null;
}
