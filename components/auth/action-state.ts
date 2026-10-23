/**
 * The contract between the first-party auth server actions and the forms that
 * call them.
 *
 * A server action answers with a `status`, and the client is expected to act on
 * it. Getting this wrong fails silently and confusingly: the form re-renders
 * unchanged with no error and no navigation, which looks like "the login is
 * broken" rather than "the client ignored a status".
 *
 * That is not hypothetical. `beginSignInAction` answers `verify` when a code is
 * sent, but `activate` when a privileged account has cleared its password and
 * still has to enrol a second factor. A form that only watches for `verify`
 * leaves an administrator staring at a sign-in form that appears to do nothing.
 * `activateAccountAction` answers `activate` as well, for the same reason.
 *
 * Keeping the decision here means every form reacts to every hand-off status,
 * and adding a new status without a destination fails loudly in the tests rather
 * than quietly in the browser.
 */

export type AuthActionState = {
  status: "idle" | "error" | "success" | "verify" | "activate" | "done";
  error?: string;
  message?: string;
  /** Where the client should go once this step succeeds. */
  next?: string;
  /** Nonce tying a submitted code to the half-finished sign-in. */
  maskedDestination?: string;
  fieldErrors?: Record<string, string>;
  /**
   * What the applicant actually submitted, echoed back by
   * `submitAccessRequestAction`.
   *
   * "Your request has been sent" told the applicant nothing they could check.
   * Someone who asked to join as a driver had no way to confirm they had said
   * driver rather than decorator, so they either chased a super admin to ask or
   * simply reapplied.
   */
  request?: AccessRequestSummary;
  /**
   * The request that was already on file, attached to a duplicate refusal.
   *
   * Without it the applicant is told "you already have a request awaiting
   * review" and shown nothing about it — the same dead end as a confirmation
   * with no details, which is exactly what they need to see in order to know
   * they do not have to apply again.
   */
  previousRequest?: AccessRequestSummary;
};

export type AccessRequestSummary = {
  fullName: string;
  email: string;
  phone: string | null;
  requestedRole: string;
  requestedStaffType: string | null;
  note: string | null;
  /** Short, non-sensitive handle they can quote to a super admin. */
  reference: string;
  createdAt: string;
  /** `PENDING`, `APPROVED`, or `REJECTED`, when known. */
  status: string | null;
  reviewedAt: string | null;
};

export const IDLE_AUTH_STATE: AuthActionState = { status: "idle" };

/**
 * Statuses that hand the flow over to a different screen. The server decides
 * where; the client only follows.
 */
const NAVIGATION_STATUSES = new Set<AuthActionState["status"]>(["verify", "activate", "done"]);

/**
 * The route the client must navigate to, or null when it should stay put.
 *
 * A navigation status without a destination returns null: the form is expected
 * to stay visible and let the user act, as the code screen does.
 */
export function nextRoute(state: AuthActionState): string | null {
  if (!NAVIGATION_STATUSES.has(state.status)) return null;
  return state.next ?? null;
}

/** True once the server has asked for a one-time code to be entered. */
export function isAwaitingCode(state: AuthActionState): boolean {
  return state.status === "verify";
}