import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { PermissionCode, Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { DailyFlightOperationalIssuesService } from './daily-flight-operational-issues.service';
import { ResolveDailyFlightOperationalIssueDto } from './dto/resolve-daily-flight-operational-issue.dto';
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DailyFlightOperationalIssuesController {
  constructor(private readonly issues: DailyFlightOperationalIssuesService) {}
  @Get('session-flights/:flightId/operational-issues')
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  list(@Param('flightId', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.issues.listForFlight(id, user); }
  @Patch('operational-issues/:issueId/resolve')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN) @Permissions(PermissionCode.CAN_RESOLVE_ISSUES)
  resolve(@Param('issueId', new ParseUUIDPipe()) id: string, @Body() dto: ResolveDailyFlightOperationalIssueDto,
    @CurrentUser() user: AuthUser) { return this.issues.resolve(id, dto, user); }
}
