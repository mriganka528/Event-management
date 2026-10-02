import { ZodError } from "zod";

type ZodLikeIssue = {
  path?: (string | number)[];
  message?: string;
  code?: string;
};

function humanizePath(path: (string | number)[] | undefined) {
  const field = path?.filter((segment) => typeof segment === "number" || segment).at(-1);
  if (typeof field !== "string" || !field) return null;
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return null;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Zod's default messages read like "Too small: expected string to have >=2 characters".
// When a schema provides its own message (for example "First name is required."),
// we keep it because it is already human-friendly.
function isMachineMessage(message: string) {
  return /^(too small|too big|invalid type|invalid input|invalid format|invalid option|invalid date|invalid base64url|invalid uuid|unrecognized key|expected)\b/i.test(
    message.trim(),
  );
}

function friendlyIssue(issue: ZodLikeIssue) {
  const message = issue.message?.trim() ?? "";
  const field = humanizePath(issue.path);
  if (message && !isMachineMessage(message)) return message;
  if (field) {
    if (issue.code === "too_small" || /required/i.test(message)) return `${field} is required.`;
    return `${field} is not valid.`;
  }
  return "Please check the highlighted information and try again.";
}

function summarizeIssues(issues: ZodLikeIssue[]) {
  if (issues.length === 0) return "Please check the form and try again.";
  const first = friendlyIssue(issues[0]);
  if (issues.length === 1) return first;
  return `${first} (+${issues.length - 1} more)`;
}

// ZodError.message is the raw JSON-serialized issue list, so a thrown Zod error
// can leak as `[{ "code": "too_small", ... }]` if it is stringified blindly.
// We recover the friendly text from either the error object or that JSON.
function fromZodLike(value: unknown): string | null {
  if (value instanceof ZodError) return summarizeIssues(value.issues as ZodLikeIssue[]);
  if (value && typeof value === "object" && Array.isArray((value as { issues?: unknown }).issues)) {
    return summarizeIssues((value as { issues: ZodLikeIssue[] }).issues);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const issues = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.issues) ? parsed.issues : null;
        if (issues?.length) return summarizeIssues(issues as ZodLikeIssue[]);
      } catch {
        // Not JSON; fall through to the normal message handling below.
      }
    }
  }
  return null;
}

export function toFriendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const zodMessage = fromZodLike(error);
  if (zodMessage) return zodMessage;

  if (error instanceof Error) {
    if (error.message.includes("Unique constraint")) return "That record already exists.";
    // A thrown ZodError's .message is the JSON-serialized issue list; recover
    // the human-readable version instead of showing the raw JSON.
    const recovered = fromZodLike(error.message);
    if (recovered) return recovered;
    if (error.message) return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return fromZodLike(error) ?? error.trim();
  }
  return fallback;
}
