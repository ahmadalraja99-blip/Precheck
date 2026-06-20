import { BadRequestException, Injectable } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';

@Injectable()
export class SessionStatusMachine {
  private readonly allowed: Record<SessionStatus, SessionStatus[]> = {
    SCHEDULED: [SessionStatus.PRECHECK_IN_PROGRESS, SessionStatus.CANCELLED],
    PRECHECK_IN_PROGRESS: [SessionStatus.PRECHECK_BLOCKED, SessionStatus.OPERATING],
    PRECHECK_BLOCKED: [SessionStatus.PRECHECK_IN_PROGRESS, SessionStatus.CANCELLED],
    OPERATING: [SessionStatus.OUTCHECK_IN_PROGRESS],
    OUTCHECK_IN_PROGRESS: [SessionStatus.OUTCHECK_PENDING_APPROVAL],
    OUTCHECK_PENDING_APPROVAL: [SessionStatus.CLOSED, SessionStatus.OUTCHECK_REJECTED],
    OUTCHECK_REJECTED: [SessionStatus.CLOSED_WITH_ISSUES, SessionStatus.CLOSED],
    CLOSED: [],
    CLOSED_WITH_ISSUES: [],
    CANCELLED: [],
  };

  assert(current: SessionStatus, next: SessionStatus) {
    if (!this.allowed[current].includes(next)) {
      throw new BadRequestException(`Invalid session transition from ${current} to ${next}`);
    }
  }
}
