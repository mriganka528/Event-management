import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The staff dashboard with no shifts.
 *
 * Two things were wrong:
 *
 *  - the "My shifts" button in the workspace bar was a plain `href="/staff"`,
 *    and the staff dashboard *is* `/staff`, so pressing it did nothing at all.
 *    A control that appears to do something and does not is worse than no
 *    control;
 *  - the empty state was a dashed box that said an admin would assign them an
 *    event. It read like a page that had failed to load, and it told the
 *    person reading it nothing they could act on — while they are on shift
 *    and expecting to be told where to go.
 */

const staffLayout = readFileSync("app/(staff)/staff/layout.tsx", "utf8");
const staffDashboard = readFileSync("app/(staff)/staff/page.tsx", "utf8");
const noShifts = readFileSync("components/staff/no-shifts-state.tsx", "utf8");

test("the My shifts button goes to the shifts, not back to the page it is on", () => {
  // `/staff` is the staff dashboard itself, so linking there made the button
  // inert. It has to point at the shifts section.
  assert.match(staffLayout, /href="\/staff#my-shifts"/, "the button must point at the shifts section");
  assert.doesNotMatch(staffLayout, /href="\/staff"\s*\n?\s*className="inline-flex h-10 shrink-0/, "the button must not link to the page it is already on");
  // And the section it points at has to exist.
  assert.match(staffDashboard, /id="my-shifts"/, "the shifts section must carry the id the button points at");
});

test("the shifts section is reachable without the sticky bar covering it", () => {
  // The workspace bar is sticky, so an anchored section that does not leave
  // room for it scrolls underneath the bar and its heading is hidden.
  assert.match(staffDashboard, /scroll-mt-/, "the anchored section must clear the sticky bar");
});

test("the no-shifts state says something actionable", () => {
  // The screen has to answer three questions: is there really nothing, what
  // does the team know about me, and what happens next.
  assert.match(noShifts, /No shifts scheduled yet/, "it must say that nothing is scheduled");
  assert.match(noShifts, /Your role/, "it must show the role the team has on file");
  assert.match(noShifts, /Your status/, "it must show whether they are available");
  assert.match(noShifts, /marked available/, "and say what that means for being assigned");
  assert.match(noShifts, /marked unavailable/, "the unavailable case needs its own wording");
});

test("the no-shifts state is used by the dashboard", () => {
  assert.match(staffDashboard, /<NoShiftsState/, "the dashboard must use the no-shifts state");
  assert.match(staffDashboard, /import \{ NoShiftsState \} from "@\/components\/staff\/no-shifts-state"/, "and import it");
  // The old generic empty box told the reader nothing.
  assert.doesNotMatch(staffDashboard, /No assignments yet/, "the old empty copy must be gone");
});

test("an administrator is not told they are unavailable", () => {
  // An admin looking at the staff workspace has no shifts because they are not
  // staff, not because they are marked unavailable. Saying the latter would
  // be nonsense.
  assert.match(noShifts, /No staff member is signed in here/, "the admin case needs its own wording");
  assert.match(noShifts, /isAdminView/, "and the component must tell the two cases apart");
});

test("the availability the state reports is the one the dashboard holds", () => {
  // The state must be given the live availability, not a hardcoded value.
  assert.match(staffDashboard, /isAvailable=\{staff \? staff\.isAvailable : undefined\}/, "the state must use the real availability");
  assert.match(staffDashboard, /role=\{staff\?\.staffType \?\? null\}/, "and the real role");
});
