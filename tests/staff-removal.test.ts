import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Staff removal is a suspension, not a delete.
 *
 * The `Staff` row is the target of every `BookingStaff` assignment. Deleting it
 * cascaded the work history with it, and demoting the user to CUSTOMER let them
 * sign straight back in with the same password. These checks keep the three
 * properties of the fix in place: history survives, the credential stops
 * working, and a new request is required before access can return.
 */

const read = (path: string) => readFileSync(path, "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing "${start}"`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing "${end}" after "${start}"`);
  return source.slice(from, to);
}

test("removing staff suspends the row and keeps every assignment", () => {
  const actions = read("lib/actions.ts");
  const removal = between(actions, "export async function removeStaffAction", "export async function assignStaffAction");

  assert.doesNotMatch(removal, /tx\.staff\.delete/, "the staff row must not be deleted");
  assert.match(removal, /status: StaffStatus\.SUSPENDED/);
  assert.match(removal, /isAvailable: false/);
  assert.match(removal, /accountStatus: AccountStatus\.SUSPENDED/);
  assert.match(removal, /isActive: false/);
  assert.match(removal, /suspensionReason: "Staff access removed by an administrator\."/);

  // The old implementation refused to remove anyone who had ever been assigned.
  assert.doesNotMatch(removal, /assignments > 0/);
  assert.doesNotMatch(removal, /Remove this staff member from all assigned events before deleting them/);

  // No customer role change and no Customer profile: removal must not become a
  // side door back into the customer workspace.
  assert.doesNotMatch(removal, /customerRole/);
  assert.doesNotMatch(removal, /tx\.customer\.create/);

  // Outstanding invites and codes are burned.
  assert.match(removal, /tx\.activationToken\.updateMany/);
  assert.match(removal, /tx\.otpChallenge\.updateMany/);

  // The live browser is signed out after the commit.
  const commit = removal.indexOf("await withSerializableRetry");
  const revoke = removal.indexOf("await revokeAllSessions");
  assert.ok(commit >= 0 && revoke > commit, "session revocation must follow the suspension transaction");
  assert.match(removal, /ACCOUNT_SUSPENDED/);
  assert.match(removal, /previous assignments remain available/);
});

test("a removed staff member can submit a fresh access request", () => {
  const team = read("lib/auth/team.ts");
  const submit = between(team, "export async function submitAccessRequest", "export async function approveAccessRequest");

  assert.match(submit, /staffProfile: \{ select: \{ status: true \} \}/);
  assert.match(submit, /const removedStaff = staffProfile\?\.status === StaffStatus\.SUSPENDED/);
  assert.match(submit, /const currentTeamMember =/);
  assert.match(submit, /You are already on the team/);
  assert.match(submit, /accountStatus === AccountStatus\.SUSPENDED && !removedStaff/);

  // Only a pending request blocks a new one. The old code refused an APPROVED
  // request forever, which is what left removed staff with no way back in.
  assert.match(submit, /previous\.status === AdminRequestStatus\.PENDING/);
  assert.doesNotMatch(submit, /previous\.status !== AdminRequestStatus\.REJECTED/);
  assert.doesNotMatch(submit, /Your previous request was approved/);
});

test("re-approval forces a fresh activation and clears the suspension", () => {
  const team = read("lib/auth/team.ts");
  const approve = between(team, "export async function approveAccessRequest", "export async function rejectAccessRequest");

  assert.match(approve, /suspendedAt: null,\s*suspensionReason: null/);
  assert.match(approve, /mustSetPassword: true/);
  assert.match(approve, /status: StaffStatus\.PENDING/);
  assert.match(approve, /isAvailable: true/);
  assert.match(approve, /activatedAt: null/);
  assert.match(approve, /revokeAllSessions\(user\.id/);
});

test("activation invalidates sessions that predate the new password", () => {
  const team = read("lib/auth/team.ts");
  const activate = between(team, "export async function activateWithToken", "export async function enableTwoFactor");

  assert.match(activate, /revokeAllSessions\(inspected\.userId/);
  assert.match(activate, /emailVerifiedAt: new Date\(\)/);
});

test("the admin can still see a removed member's previous work", () => {
  const page = read("app/(admin)/admin/staff/page.tsx");
  assert.match(page, /const isRemoved = member\.status === StaffStatus\.SUSPENDED/);
  assert.match(page, /Access removed/);
  assert.match(page, /Previous work \(/);
  // The list is the finished assignments rather than all of them: a member
  // whose events are all over is holding none of them, and the work they did
  // is what is left to show.
  assert.match(page, /finishedAssignments\.map/);
  assert.match(page, /\{!isRemoved \?/);

  // The suspended row must remain in the directory query.
  const data = read("lib/admin-data.ts");
  const staff = between(data, "export async function getAdminStaff", "export async function getStaffOptions");
  assert.doesNotMatch(staff, /where:\s*\{\s*status:\s*StaffStatus\.ACTIVE/);
});

test("the removed staff member sees the re-application form, not the suspension block", () => {
  const page = read("app/(customer)/customer/access/page.tsx");
  assert.match(page, /const removedStaff = user\.staffProfile\?\.status === StaffStatus\.SUSPENDED/);
  assert.match(page, /const suspended = user\.accountStatus === AccountStatus\.SUSPENDED && !removedStaff/);
  assert.match(page, /previous staff access was removed/);
});

test("access decisions respond before the notification email is sent", () => {
  const team = read("lib/auth/team.ts");
  assert.match(team, /import \{ after \} from "next\/server"/);

  const approve = between(team, "export async function approveAccessRequest", "export async function rejectAccessRequest");
  assert.match(approve, /after\(async \(\) => \{[\s\S]*sendTeamInviteEmail/);
  assert.match(approve, /notifyAdmins\([\s\S]*Invitation email could not be sent/);

  const reject = between(team, "export async function rejectAccessRequest", "export async function inviteTeamMember");
  assert.match(reject, /after\(async \(\) => \{[\s\S]*sendAccessDeclinedEmail/);
});

test("review buttons disable themselves while the decision is being saved", () => {
  const page = read("app/(admin)/admin/admins/page.tsx");
  assert.match(page, /import \{ ActionSubmitButton \}/);
  assert.match(page, /<ActionSubmitButton[^>]*>[\s\S]*Approve/);
  assert.match(page, /<ActionSubmitButton[^>]*>[\s\S]*Decline/);
});

