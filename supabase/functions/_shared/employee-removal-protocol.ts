import { importSPKI, jwtVerify } from "jose";

export type EmployeeRemoval = {
  employeeId: string;
  sevenShiftsEmployeeId: string;
  authVersion: number;
};

export async function verifyEmployeeRemoval(
  assertion: unknown,
  publicKey: string | undefined,
  audience: "ope-training-employee-removal" | "ope-facilities-employee-removal",
): Promise<EmployeeRemoval> {
  if (typeof assertion !== "string" || assertion.length > 3000 || !publicKey) {
    throw new Error("Invalid employee removal");
  }
  const { payload, protectedHeader } = await jwtVerify(
    assertion, await importSPKI(publicKey, "EdDSA"),
    { algorithms: ["EdDSA"], issuer: "staff-tools-employee-access", audience, maxTokenAge: "45s", clockTolerance: 0 },
  );
  const now = Math.floor(Date.now() / 1000);
  if (protectedHeader.typ !== "JWT" || protectedHeader.kid !== "employee-removal-v1" ||
      payload.kind !== "employee_removal" || payload.active !== false ||
      typeof payload.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
      payload.sub === "emp-alexis-younker" ||
      typeof payload.sevenShiftsEmployeeId !== "string" || !/^[1-9][0-9]{0,19}$/.test(payload.sevenShiftsEmployeeId) ||
      typeof payload.authVersion !== "number" || !Number.isSafeInteger(payload.authVersion) || payload.authVersion < 1 ||
      typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
      payload.exp <= now || payload.exp - payload.iat > 45 || payload.iat > now ||
      typeof payload.jti !== "string" || !/^[a-f0-9-]{36}$/.test(payload.jti)) {
    throw new Error("Invalid employee removal");
  }
  return { employeeId: payload.sub, sevenShiftsEmployeeId: payload.sevenShiftsEmployeeId, authVersion: payload.authVersion };
}
