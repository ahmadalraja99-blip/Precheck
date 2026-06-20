import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesPermissionsModule } from './roles-permissions/roles-permissions.module';
import { CompaniesModule } from './companies/companies.module';
import { CountersModule } from './counters/counters.module';
import { DevicesModule } from './devices/devices.module';
import { CheckItemsModule } from './check-items/check-items.module';
import { SessionsModule } from './sessions/sessions.module';
import { PrecheckModule } from './precheck/precheck.module';
import { OutcheckModule } from './outcheck/outcheck.module';
import { IssuesModule } from './issues/issues.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { MailerModule } from './mailer/mailer.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    StorageModule,
    MailerModule,
    RolesPermissionsModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    CountersModule,
    DevicesModule,
    CheckItemsModule,
    SessionsModule,
    PrecheckModule,
    IssuesModule,
    OutcheckModule,
    ApprovalsModule,
    ReportsModule,
    SchedulerModule,
  ],
})
export class AppModule {}
