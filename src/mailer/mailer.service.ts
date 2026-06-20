import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStatus, NotificationType, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MailerService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private transporter() {
    return nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: this.config.get<string>('SMTP_USER')
        ? { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') }
        : undefined,
    });
  }

  async send(input: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    attachments?: { filename: string; path: string }[];
    relatedEntityType?: string;
    relatedEntityId?: string;
  }) {
    const log = await this.prisma.emailLog.create({
      data: {
        to: input.to.join(','),
        cc: input.cc?.join(','),
        subject: input.subject,
        bodyPreview: input.body.slice(0, 250),
        attachments: input.attachments as Prisma.InputJsonValue,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
      },
    });
    try {
      await this.transporter().sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.body,
        attachments: input.attachments,
      });
      await this.audit.record({ action: 'SEND_EMAIL', entityType: 'EmailLog', entityId: log.id, result: 'SUCCESS' });
      return this.prisma.emailLog.update({ where: { id: log.id }, data: { status: EmailStatus.SENT, sentAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email send failed';
      await this.notifications.create({
        title: 'Email failed',
        message,
        type: NotificationType.EMAIL_FAILED,
        entityType: 'EmailLog',
        entityId: log.id,
      });
      await this.audit.record({ action: 'EMAIL_FAILED', entityType: 'EmailLog', entityId: log.id, result: 'FAILED', note: message });
      return this.prisma.emailLog.update({ where: { id: log.id }, data: { status: EmailStatus.FAILED, errorMessage: message } });
    }
  }
}
