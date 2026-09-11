import "server-only";

import {
  staffToolsOrigin,
  shiftFlowOrigin,
  transitionPublicKey,
  validateIsolatedEnvironment,
} from "../../../supabase/functions/_shared/environment";
import { fetchValidatedShiftFlowApi } from "../../../supabase/functions/_shared/shiftflow-request";

export function getStaffToolsOrigin() {
  validateIsolatedEnvironment(process.env, "web");
  return staffToolsOrigin(process.env);
}

export function getShiftFlowOrigin() {
  validateIsolatedEnvironment(process.env, "web");
  return shiftFlowOrigin(process.env);
}

export function fetchShiftFlowApi(init: RequestInit = {}) {
  return fetchValidatedShiftFlowApi(getShiftFlowOrigin(), process.env, init);
}

export function getTransitionPublicKey() {
  // An already-issued logout intent can still be verified when another setting
  // breaks, allowing its local cookie cleanup to finish without network calls.
  return transitionPublicKey(process.env);
}
