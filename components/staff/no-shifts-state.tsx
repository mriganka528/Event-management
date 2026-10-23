import { CalendarClock, CheckCircle2, MailQuestion, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What a staff member sees when they have no shifts.
 *
 * The empty state used to be a dashed box that said an admin would assign
 * them an event. That told the reader nothing they could act on, and it was
 * indistinguishable from a page that had failed to load — which matters,
 * because the person reading it is on shift and expecting to be told where
 * to go.
 *
 * It now says three things: that there is genuinely nothing scheduled, what
 * the team already knows about them (their role and whether they are marked
 * available), and what happens next. The availability line is the important
 * one: a staff member who is marked unavailable and a staff member who is
 * available and simply not needed yet are in very different positions, and
 * only the second one is waiting for the phone to ring.
 */
export function NoShiftsState({
  isAvailable,
  role,
  className,
}: {
  /**
   * `undefined` means the reader is not a staff member at all — an
   * administrator looking at the staff workspace. They have no shifts to
   * wait for, and telling them they are "unavailable" would be nonsense.
   */
  isAvailable?: boolean;
  role?: string | null;
  className?: string;
}) {
  const isAdminView = isAvailable === undefined;
  const roleLabel = role
    ? role.charAt(0) + role.slice(1).toLowerCase().replaceAll("_", " ")
    : null;

  return (
    <div
      className={cn(
        "rounded-[20px] border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-6 text-center sm:p-8",
        className,
      )}
    >
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand-dark)]">
        {isAdminView ? (
          <ShieldQuestion className="h-6 w-6" aria-hidden="true" />
        ) : (
          <CalendarClock className="h-6 w-6" aria-hidden="true" />
        )}
      </span>

      <p className="mt-4 text-base font-semibold text-[var(--foreground)]">
        {isAdminView ? "No staff member is signed in here" : "No shifts scheduled yet"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
        {isAdminView
          ? "This screen shows the shifts of the staff member who is signed in. Open it as a staff member to see their schedule."
          : "Nothing is on your schedule at the moment. When the team books an event that needs your role, it will appear here with the date, the venue, and the guest count."}
      </p>

      {isAdminView ? null : (
        <>
          {/*
            What the team already knows about this person, and whether they are
            currently offering to work. Without it the screen is a dead end:
            the reader has no idea whether to wait or to change something.
          */}
          <dl className="mx-auto mt-5 grid max-w-md gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 text-left">
              <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Your role</dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {roleLabel ?? "Not set yet"}
              </dd>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 text-left">
              <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Your status</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    isAvailable ? "bg-emerald-500" : "bg-stone-400",
                  )}
                />
                {isAvailable ? "Available" : "Unavailable"}
              </dd>
            </div>
          </dl>

          <p
            className={cn(
              "mx-auto mt-4 inline-flex items-start gap-2 rounded-2xl px-3 py-2 text-left text-xs leading-5",
              isAvailable
                ? "bg-[var(--success-soft)] text-[var(--success-text)]"
                : "bg-[var(--warning-soft)] text-[var(--warning-text)]",
            )}
          >
            {isAvailable ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <MailQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {isAvailable
                ? "You are marked available, so the team can assign you as soon as a booking needs you."
                : "You are marked unavailable, so the team will not assign you. Use the button above to change that when you can work."}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
