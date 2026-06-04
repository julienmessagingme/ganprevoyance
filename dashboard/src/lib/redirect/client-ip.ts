/**
 * Returns the real client IP from a request.
 *
 * Trust order (most → least trusted) :
 *   1. CF-Connecting-IP (Cloudflare orange-cloud proxy injects this with the
 *      real client IP and overwrites whatever the client sent).
 *   2. Last entry of X-Forwarded-For (in a chain client → cf → npm → app, the
 *      LAST entry is what the closest trusted proxy added; entries injected
 *      by the client itself appear earlier and are therefore untrusted).
 *
 * NEVER pick the FIRST entry of XFF — clients can spoof it.
 */
export function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return null;
}
