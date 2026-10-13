"use server";

import {
  approveUserAccessAction,
  cancelBookingAction,
  changeUserRoleAction,
  createEventAction,
  deleteEventAction,
  createInventoryAction,
  createInvoiceAction,
  createPackageAction,
  createServiceAction,
  deleteInventoryAction,
  deletePackageAction,
  deleteServiceAction,
  createStaffAction,
  grantAdminAccessAction,
  rejectUserAccessAction,
  removeAdminAction,
  removeStaffAction,
  resendStaffInviteAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  recordPaymentAction,
  reviewAdminRequestAction,
  saveBusinessSettingsAction,
  setInventoryActiveAction,
  setPackageActiveAction,
  setServiceActiveAction,
  unassignStaffAction,
  updateInventoryAction,
  updateOwnAvailabilityAction,
  updatePackageAction,
  updateServiceAction,
  updateStaffAction,
  updateUserActiveAction,
  type ActionState,
} from "@/lib/actions";
import { toFriendlyError } from "@/lib/errors";

type DirectAction = (formData: FormData) => Promise<ActionState>;

async function runAction(action: DirectAction, formData: FormData): Promise<ActionState> {
  try {
    return await action(formData);
  } catch (error) {
    return {
      success: null,
      error: toFriendlyError(error),
    };
  }
}

export async function cancelBookingFormAction(formData: FormData) {
  return runAction(cancelBookingAction, formData);
}
export async function createInventoryFormAction(formData: FormData) {
  return runAction(createInventoryAction, formData);
}
export async function updateInventoryFormAction(formData: FormData) {
  return runAction(updateInventoryAction, formData);
}
export async function setInventoryActiveFormAction(formData: FormData) {
  return runAction(setInventoryActiveAction, formData);
}
export async function deleteInventoryFormAction(formData: FormData) {
  return runAction(deleteInventoryAction, formData);
}
export async function createPackageFormAction(formData: FormData) {
  return runAction(createPackageAction, formData);
}
export async function updatePackageFormAction(formData: FormData) {
  return runAction(updatePackageAction, formData);
}
export async function setPackageActiveFormAction(formData: FormData) {
  return runAction(setPackageActiveAction, formData);
}
export async function deletePackageFormAction(formData: FormData) {
  return runAction(deletePackageAction, formData);
}
export async function createServiceFormAction(formData: FormData) {
  return runAction(createServiceAction, formData);
}
export async function updateServiceFormAction(formData: FormData) {
  return runAction(updateServiceAction, formData);
}
export async function setServiceActiveFormAction(formData: FormData) {
  return runAction(setServiceActiveAction, formData);
}
export async function deleteServiceFormAction(formData: FormData) {
  return runAction(deleteServiceAction, formData);
}
export async function createStaffFormAction(formData: FormData) {
  return runAction(createStaffAction, formData);
}
export async function updateStaffFormAction(formData: FormData) {
  return runAction(updateStaffAction, formData);
}
export async function removeStaffFormAction(formData: FormData) {
  return runAction(removeStaffAction, formData);
}
export async function resendStaffInviteFormAction(formData: FormData) {
  return runAction(resendStaffInviteAction, formData);
}
export async function recordPaymentFormAction(formData: FormData) {
  return runAction(recordPaymentAction, formData);
}
export async function createInvoiceFormAction(formData: FormData) {
  return runAction(createInvoiceAction, formData);
}
export async function createEventFormAction(formData: FormData) {
  return runAction(createEventAction, formData);
}
export async function deleteEventFormAction(formData: FormData) {
  return runAction(deleteEventAction, formData);
}
export async function markAllNotificationsFormAction(formData: FormData) {
  return runAction(async () => markAllNotificationsReadAction(), formData);
}
export async function markNotificationFormAction(formData: FormData) {
  return runAction(markNotificationReadAction, formData);
}
export async function reviewAdminRequestFormAction(formData: FormData) {
  return runAction(reviewAdminRequestAction, formData);
}
export async function saveBusinessSettingsFormAction(formData: FormData) {
  return runAction(saveBusinessSettingsAction, formData);
}
export async function unassignStaffFormAction(formData: FormData) {
  return runAction(unassignStaffAction, formData);
}
export async function updateUserActiveFormAction(formData: FormData) {
  return runAction(updateUserActiveAction, formData);
}
export async function approveUserAccessFormAction(formData: FormData) {
  return runAction(approveUserAccessAction, formData);
}
export async function rejectUserAccessFormAction(formData: FormData) {
  return runAction(rejectUserAccessAction, formData);
}
export async function changeUserRoleFormAction(formData: FormData) {
  return runAction(changeUserRoleAction, formData);
}
export async function removeAdminFormAction(formData: FormData) {
  return runAction(removeAdminAction, formData);
}
export async function grantAdminAccessFormAction(formData: FormData) {
  return runAction(grantAdminAccessAction, formData);
}
export async function updateOwnAvailabilityFormAction(formData: FormData) {
  return runAction(updateOwnAvailabilityAction, formData);
}
