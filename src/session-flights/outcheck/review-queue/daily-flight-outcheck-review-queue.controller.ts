import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PermissionCode, Role } from "@prisma/client";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Permissions } from "../../../common/decorators/permissions.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../../common/guards/permissions.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { AuthUser } from "../../../common/types/auth-user.type";
import { DailyFlightOutCheckReviewQueueService } from "./daily-flight-outcheck-review-queue.service";
import { ListDailyFlightOutCheckReviewQueueDto } from "./dto";

@Controller("daily-flight-outcheck-reviews")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Permissions(PermissionCode.CAN_APPROVE_OUTCHECK)
export class DailyFlightOutCheckReviewQueueController {
  constructor(private readonly queue: DailyFlightOutCheckReviewQueueService) {}

  @Get("pending")
  list(
    @Query() query: ListDailyFlightOutCheckReviewQueueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.queue.list(query, user);
  }
}
