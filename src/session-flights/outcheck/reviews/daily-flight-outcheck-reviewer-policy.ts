import { ForbiddenException } from "@nestjs/common";
import { PermissionCode, Role } from "@prisma/client";

export interface DailyFlightOutCheckReviewerRecord {
  id: string;
  fullName: string;
  role: Role;
  companyId: string | null;
  isActive: boolean;
  permissions: Array<{ permission: { code: PermissionCode } }>;
}

export function assertDailyFlightOutCheckReviewerAuthority(
  reviewer: DailyFlightOutCheckReviewerRecord | null,
) {
  if (
    !reviewer?.isActive ||
    (reviewer.role !== Role.SUPER_ADMIN &&
      (reviewer.role !== Role.ADMIN ||
        !reviewer.permissions.some(
          ({ permission }) =>
            permission.code === PermissionCode.CAN_APPROVE_OUTCHECK,
        )))
  ) {
    throw new ForbiddenException("Reviewer is not authorized.");
  }
  return reviewer;
}

export function assertDailyFlightOutCheckReviewerEligible(
  reviewer: Pick<DailyFlightOutCheckReviewerRecord, "id" | "companyId">,
  input: {
    flightCompanyId: string;
    startedById: string;
    submittedById: string | null;
  },
) {
  if (
    reviewer.id === input.submittedById ||
    reviewer.id === input.startedById ||
    (reviewer.companyId !== null &&
      reviewer.companyId === input.flightCompanyId)
  ) {
    throw new ForbiddenException("Self-review is prohibited.");
  }
}
