import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { AuthUser } from "../../../common/types/auth-user.type";
import { DailyFlightOutCheckSubmissionsService } from "./daily-flight-outcheck-submissions.service";
import { OutCheckSubmissionAttemptParamDto } from "./dto/outcheck-submission-attempt-param.dto";

@Controller("session-flights/:sessionFlightId/outcheck/submissions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  Role.COMPANY_USER,
  Role.MOVEMENT_SUPERVISOR,
  Role.ADMIN,
  Role.SUPER_ADMIN,
)
export class DailyFlightOutCheckSubmissionsController {
  constructor(
    private readonly submissions: DailyFlightOutCheckSubmissionsService,
  ) {}

  @Get()
  list(
    @Param("sessionFlightId") sessionFlightId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.list(sessionFlightId, user);
  }

  @Get(":attemptNumber")
  find(
    @Param() params: OutCheckSubmissionAttemptParamDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.find(
      params.sessionFlightId,
      params.attemptNumber,
      user,
    );
  }
}
