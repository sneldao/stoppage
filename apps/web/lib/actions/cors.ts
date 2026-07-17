/**
 * Solana Actions (Blinks) CORS helpers.
 * Every /api/actions/* route must respond with these headers and export
 * an OPTIONS handler, or wallets/clients will refuse the Action.
 *
 * The wildcard Access-Control-Allow-Origin is required by the Solana
 * Actions spec — wallets and X clients fetch these endpoints from
 * arbitrary origins. This is intentional and safe: the endpoints are
 * read-only (GET returns market metadata, POST returns an unsigned
 * transaction that the wallet signs locally — no server-side signing,
 * no fund movement, no authenticated actions).
 */

export const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "Content-Type": "application/json",
} as const;

export function actionJson(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      ...ACTIONS_CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
