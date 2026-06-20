import { Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateDeviceDto, user: AuthUser) {
    const device = await this.prisma.device.create({ data: dto });
    await this.audit.record({ user, action: 'CREATE_DEVICE', entityType: 'Device', entityId: device.id });
    return device;
  }

  async list(query: PaginationDto & { counterId?: string; status?: DeviceStatus }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.DeviceWhereInput = {
      counterId: query.counterId,
      status: query.status,
      OR: query.search ? [{ name: { contains: query.search, mode: 'insensitive' } }, { assetTag: { contains: query.search, mode: 'insensitive' } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.device.findMany({ where, include: { counter: true }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.device.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id }, include: { counter: true } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async update(id: string, dto: UpdateDeviceDto, user: AuthUser) {
    await this.find(id);
    const device = await this.prisma.device.update({ where: { id }, data: dto });
    await this.audit.record({ user, action: 'UPDATE_DEVICE', entityType: 'Device', entityId: id });
    return device;
  }
}
