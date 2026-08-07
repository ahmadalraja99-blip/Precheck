import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { PermissionCode, Role } from "@prisma/client";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../../common/guards/permissions.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { AuthUser } from "../../../common/types/auth-user.type";
import { OutCheckSubmissionAttemptParamDto } from "../submissions/dto/outcheck-submission-attempt-param.dto";
import { DailyFlightOutCheckReviewsService } from "./daily-flight-outcheck-reviews.service";
import {
  ApproveDailyFlightOutCheckSubmissionDto,
  RejectDailyFlightOutCheckSubmissionDto,
} from "./dto/review-daily-flight-outcheck-submission.dto";

@Controller("session-flights/:sessionFlightId/outcheck/submissions")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Permissions(PermissionCode.CAN_APPROVE_OUTCHECK)
export class DailyFlightOutCheckReviewsController {
  constructor(private readonly reviews: DailyFlightOutCheckReviewsService) {}

  @Post(":attemptNumber/approve")
  approve(
    @Param() params: OutCheckSubmissionAttemptParamDto,
    @Body() dto: ApproveDailyFlightOutCheckSubmissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.approve(
      params.sessionFlightId,
      params.attemptNumber,
      dto.comment,
      user,
    );
  }

  @Post(":attemptNumber/reject")
  reject(
    @Param() params: OutCheckSubmissionAttemptParamDto,
    @Body() dto: RejectDailyFlightOutCheckSubmissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.reject(
      params.sessionFlightId,
      params.attemptNumber,
      dto.reason,
      user,
    );
  }
}
