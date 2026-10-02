import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const RETRYABLE_CODES = new Set(["P2034", "P2028"]);

/**
 * Runs a write in a serializable transaction and retries the small set of
 * PostgreSQL/Prisma conflicts that can occur when two operators act at once.
 * Callers still need to use conditional updates for business invariants.
 */
export async function withSerializableRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { retries?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
      if (!code || !RETRYABLE_CODES.has(code) || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }

  throw new Error("The transaction could not be completed.");
}
