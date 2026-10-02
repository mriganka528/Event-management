/**
 * @deprecated Use the guards in `@/lib/auth/server` directly. This module is
 * retained as a thin alias so call sites read consistently during the migration
 * away from the previous Clerk-based helpers.
 */
export { requireUser, requireAdmin, requireSuperAdmin, requireCustomer, requireStaff, isAdminRole, getCurrentUser, requestIp } from "@/lib/auth/server";
