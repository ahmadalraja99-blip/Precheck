import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { SubmitPreCheckDto } from './dto/precheck.dto';
import { PrecheckService } from './precheck.service';

@Controller('sessions/:sessionId/precheck')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
export class PrecheckController {
  constructor(private readonly precheck: PrecheckService) {}

  @Post('start')
  start(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.precheck.start(sessionId, user);
  }

  @Post('submit')
  submit(@Param('sessionId') sessionId: string, @Body() dto: SubmitPreCheckDto, @CurrentUser() user: AuthUser) {
    return this.precheck.submit(sessionId, dto, user);
  }

  @Get()
  get(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.precheck.get(sessionId, user);
  }
}
