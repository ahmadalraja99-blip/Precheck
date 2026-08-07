import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { DailyFlightPreChecksService } from './daily-flight-prechecks.service';
import { SavePreCheckResultsDto } from './dto/save-precheck-results.dto';

@Controller('session-flights/:sessionFlightId/precheck')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyFlightPreChecksController {
  constructor(private readonly preChecks: DailyFlightPreChecksService) {}

  @Get()
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  get(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.preChecks.get(sessionFlightId, user);
  }

  @Post('start')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  start(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.preChecks.start(sessionFlightId, user);
  }

  @Patch('results')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  saveResults(
    @Param('sessionFlightId') sessionFlightId: string,
    @Body() dto: SavePreCheckResultsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.preChecks.saveResults(sessionFlightId, dto, user);
  }

  @Post('submit')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  submit(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.preChecks.submit(sessionFlightId, user);
  }
}
