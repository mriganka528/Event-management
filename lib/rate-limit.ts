import { isIP } from "node:net";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function removeExpired(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_BUCKETS * 0.8) break;
  }
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, Math.ceil(MAX_BUCKETS * 0.1));
    for (const [key] of oldest) buckets.delete(key);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  removeExpired(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function allowRequest(key: string, limit = 10, windowMs = 10 * 60 * 1000) {
  return checkRateLimit(key, limit, windowMs).allowed;
}

export function getClientIp(request: Request | { headers: Headers }) {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  const candidate = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? forwarded?.at(-1) ?? "";
  return candidate && isIP(candidate) ? candidate : "unknown";
}
