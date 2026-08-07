import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { DailyFlightOutChecksService } from './daily-flight-outchecks.service';
import { SaveOutCheckResultsDto } from './dto/save-outcheck-results.dto';

@Controller('session-flights/:sessionFlightId/outcheck')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailyFlightOutChecksController {
  constructor(private readonly outChecks: DailyFlightOutChecksService) {}

  @Get()
  @Roles(Role.COMPANY_USER, Role.MOVEMENT_SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  get(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.outChecks.get(sessionFlightId, user);
  }

  @Post('start')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  start(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.outChecks.start(sessionFlightId, user);
  }

  @Patch('results')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  saveResults(
    @Param('sessionFlightId') sessionFlightId: string,
    @Body() dto: SaveOutCheckResultsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.outChecks.saveResults(sessionFlightId, dto, user);
  }

  @Post('submit')
  @Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
  submit(@Param('sessionFlightId') sessionFlightId: string, @CurrentUser() user: AuthUser) {
    return this.outChecks.submit(sessionFlightId, user);
  }
}
