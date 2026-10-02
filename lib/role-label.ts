/**
 * Human-readable role name for the account chip.
 *
 * Deliberately in its own module with no `"use client"`. The three workspace
 * layouts (admin, staff, customer) are Server Components that call this to build
 * the props for the client `AccountMenu`, and a function exported from a module
 * marked `"use client"` is replaced on the server by a stub that throws:
 *
 *   Error: Attempted to call formatRoleLabel() from the server but
 *   formatRoleLabel is on the client.
 *
 * That threw on every admin, staff, and customer page render, so the sign-in
 * completed but the workspace behind it could never load. Keeping the pure
 * function out of the client boundary is what lets both sides use it.
 */
export function formatRoleLabel(role: string): string {
  return role.replaceAll("_", " ").toLowerCase();
}