import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const DEFAULT_MAX_BODY_BYTES = 128 * 1024;

function configuredSiteOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const allowed = new Set<string>([new URL(request.url).origin]);
  const siteOrigin = configuredSiteOrigin();
  if (siteOrigin) allowed.add(siteOrigin);
  const host = request.headers.get("host");
  if (host) {
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
    allowed.add(`${protocol}://${host}`);
  }
  return allowed.has(origin);
}

export function rejectCrossSiteMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || isSameOrigin(request)) return null;
  return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
}

export function rejectOversizedBody(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  return null;
}

export function rateLimitApi(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number; keySuffix?: string },
) {
  const result = checkRateLimit(`${scope}:${getClientIp(request)}:${options.keySuffix ?? "all"}`, options.limit, options.windowMs);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

export class RequestBodyTooLargeError extends Error {}
export class InvalidJsonError extends Error {}

export async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<unknown> {
  const text = await readTextWithLimit(request, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

export function requireJsonContentType(request: Request) {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  return null;
}

export function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function publicJson(data: unknown, init?: ResponseInit) {
  return withNoStore(NextResponse.json(data, init));
}
