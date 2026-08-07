import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RolesPermissionsModule } from '../roles-permissions/roles-permissions.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [JwtModule.register({}), RolesPermissionsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
