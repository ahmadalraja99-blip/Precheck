import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { SubmitPreCheckDto } from '../precheck/dto/precheck.dto';
import { OutcheckService } from './outcheck.service';

@Controller('sessions/:sessionId/outcheck')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COMPANY_USER, Role.SUPER_ADMIN)
export class OutcheckController {
  constructor(private readonly outcheck: OutcheckService) {}

  @Post('start')
  start(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.outcheck.start(sessionId, user);
  }

  @Post('submit')
  submit(@Param('sessionId') sessionId: string, @Body() dto: SubmitPreCheckDto, @CurrentUser() user: AuthUser) {
    return this.outcheck.submit(sessionId, dto, user);
  }

  @Get()
  get(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.outcheck.get(sessionId, user);
  }
}
