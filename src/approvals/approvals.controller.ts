import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ApprovalsService } from './approvals.service';
import { RejectOutCheckDto } from './dto/approval.dto';

@Controller('sessions/:sessionId/outcheck')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post('approve')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_APPROVE_OUTCHECK)
  approve(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.approvals.approve(sessionId, user);
  }

  @Post('reject')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Permissions(PermissionCode.CAN_APPROVE_OUTCHECK)
  reject(@Param('sessionId') sessionId: string, @Body() dto: RejectOutCheckDto, @CurrentUser() user: AuthUser) {
    return this.approvals.reject(sessionId, dto.rejectionReason, user);
  }
}
