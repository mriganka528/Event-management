import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The four changes: staff assignment, the date range, the staff shift, and
 * the terms.
 *
 * Each of these was a complaint about the application not showing something
 * it already had:
 *
 *  - an admin assigned somebody to an event and could not see who, and could
 *    assign the same person to the same event twice;
 *  - a customer could say "the 2nd" and "three days" and be describing two
 *    different events;
 *  - a staff member tapped their shift and the visitor's email client opened
 *    instead of the shift;
 *  - the terms could not be read before agreeing to them.
 */

const bookingOperations = readFileSync("components/admin/booking-operations.tsx", "utf8");
const actions = readFileSync("lib/actions.ts", "utf8");
const bookingDetail = readFileSync("app/(admin)/admin/bookings/[id]/page.tsx", "utf8");
const bookingForm = readFileSync("components/booking/booking-form.tsx", "utf8");
const staffPage = readFileSync("app/(staff)/staff/page.tsx", "utf8");
const termsPage = readFileSync("app/(root)/terms/page.tsx", "utf8");
const siteFooter = readFileSync("components/layout/site-footer.tsx", "utf8");
const siteHeader = readFileSync("components/layout/site-header.tsx", "utf8");
const sitemap = readFileSync("app/sitemap.ts", "utf8");

test("the assign section shows who is on the event", () => {
  // The roster used to sit in a separate card further down the page, and the
  // only sign of it in the assign section was a count.
  assert.match(bookingOperations, /On this event \(\{assignedStaff\.length\}\)/, "the roster must be shown in the assign section");
  assert.match(bookingOperations, /\{member\.name\}/, "with the name of each person on it");
  assert.match(bookingOperations, /\{member\.type\.toLowerCase\(\)/, "and their role");
  // And the page has to hand it over.
  assert.match(bookingDetail, /assignedStaff=\{booking\.bookingStaff\.map/, "the booking page must pass the roster");
});

test("somebody already on the event is not offered again", () => {
  // Offering a second assignment for the same person meant the choice was
  // made and then refused at the last step.
  assert.match(bookingOperations, /const assignableStaff = staff\.filter\(\(member\) => !alreadyAssigned\.has\(member\.id\)\)/, "the drop-down must exclude the people already assigned");
  assert.match(bookingOperations, /assignableStaff\.map/, "and offer the rest");
});

test("the server refuses a second assignment of the same person", () => {
  // The insert was an upsert with an empty update, so a repeat was swallowed
  // and the admin was told it had worked.
  assert.match(actions, /const alreadyOnThisBooking = await tx\.bookingStaff\.findUnique/, "the duplicate must be checked");
  assert.match(actions, /already assigned to this event/, "and refused with a message that says so");
  assert.doesNotMatch(actions, /bookingStaff\.upsert\(\{ where: \{ bookingId_staffId/, "a repeat must not be a silent upsert");
  assert.match(actions, /await tx\.bookingStaff\.create\(\{ data: \{ bookingId, staffId \} \}\)/, "the assignment is a plain insert");
});

test("an assigned person can be taken off the event", () => {
  assert.match(bookingOperations, /unassignStaffAction/, "the roster must offer a way to correct a mistake");
  assert.match(bookingOperations, /name="assignmentId" value=\{member\.assignmentId\}/, "identified by the assignment");
});

test("the customer picks a date range, not a day count", () => {
  assert.match(bookingForm, /name="eventDate"/, "the start date");
  assert.match(bookingForm, /name="eventEndDate"/, "and the end date");
  // The day count is derived and sent, not typed and hoped for.
  assert.match(bookingForm, /<input type="hidden" name="durationDays" value=\{days\} \/>/, "the derived day count is sent");
  assert.doesNotMatch(bookingForm, /<Input\s*\n\s*name="durationDays"/, "the customer must not type a day count");
  assert.match(bookingForm, /Your event runs for \$\{rangeDays\} day\$\{rangeDays === 1 \? "" : "s"\}/, "and the form states the length it derived");
});

test("the server derives the day count from the range", () => {
  // A customer who typed "3" and a customer who picked three dates were
  // describing the same event, and the two answers could disagree.
  assert.match(actions, /eventEndDate: getString\(formData, "eventEndDate"\)/, "the range reaches the server");
  assert.match(readFileSync("lib/bookings.ts", "utf8"), /const durationDays = rangeDays \?\? data\.durationDays/, "the server derives the length from the range");
  assert.match(readFileSync("lib/bookings.ts", "utf8"), /eventDayCount\(data\.eventDate, data\.eventEndDate\)/, "using the shared arithmetic");
});

test("the staff shift opens the shift, not an email client", () => {
  // The whole card was a `mailto:` link, so tapping a shift opened the
  // visitor's mail client and showed nothing.
  assert.match(staffPage, /<details/, "the shift must be a disclosure");
  assert.doesNotMatch(staffPage, /href=\{`mailto:\$\{booking\.customer\.user\.email\}`\}\s*className="flex flex-col/, "the card must not be a mail link");
  // The contact details are a deliberate action inside it.
  assert.match(staffPage, /mailto:\$\{booking\.customer\.user\.email\}/, "emailing is a button inside the shift");
  assert.match(staffPage, /tel:\$\{booking\.customer\.user\.phone\}/, "and so is calling");
  // And the shift itself says what the work is.
  assert.match(staffPage, /What you are setting up/, "the shift must say what it involves");
  assert.match(staffPage, /bookingServices/, "and list the services");
});

test("the terms are a public page, linked and indexed", () => {
  assert.match(termsPage, /Terms and conditions/, "the page must exist");
  assert.match(termsPage, /export const revalidate/, "and be cached like the other public pages");
  // Reachable from the header and the footer.
  assert.match(siteHeader, /href: "\/terms"/, "the header must link to it");
  assert.match(siteFooter, /href: "\/terms"/, "and so must the footer");
  // And findable.
  assert.match(sitemap, /absoluteUrl\("\/terms"\)/, "the sitemap must list it");
});

test("the public footer exists at all", () => {
  // The public pages had no footer, so there was nowhere for the terms or the
  // business address to be reached from.
  assert.match(siteFooter, /All rights reserved/, "the footer must state the business");
  assert.match(siteFooter, /Terms and conditions/, "and link the terms");
  assert.match(readFileSync("app/(root)/layout.tsx", "utf8"), /<SiteFooter/, "every public page must render it");
});
