import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { DailyFlightOperationsService } from './daily-flight-operations.service';

@Controller('session-flights/:sessionFlightId/operation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyFlightOperationsController {
  constructor(private readonly operations: DailyFlightOperationsService) {}

  @Post('start')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  start(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.operations.start(sessionFlightId, user);
  }
}
