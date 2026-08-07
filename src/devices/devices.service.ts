import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private parseOptionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isActive must be true or false');
  }

  async create(dto: CreateDeviceDto, user: AuthUser) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const counter = await tx.counter.findUnique({ where: { id: dto.counterId } });
        if (!counter) throw new NotFoundException('Counter not found');
        if (!counter.isActive) throw new ConflictException('Inactive counters cannot receive device assignments');
        const device = await tx.device.create({ data: { ...dto,
          serialNumber: dto.serialNumber || null, assetTag: dto.assetTag || null } });
        await tx.deviceAssignmentHistory.create({ data: { deviceId: device.id, counterId: device.counterId,
          assignedById: user.id, reason: 'Initial device assignment' } });
        await this.audit.record({ user, action: 'CREATE_DEVICE', entityType: 'Device', entityId: device.id,
          metadata: { counterId: device.counterId, type: device.type, assetTag: device.assetTag, status: device.status } }, tx);
        return device;
      });
    } catch (error) { this.rethrowUnique(error); }
  }

  async list(query: PaginationDto & { counterId?: string; status?: DeviceStatus; type?: string; isActive?: boolean }) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.DeviceWhereInput = {
      counterId: query.counterId,
      status: query.status,
      type: query.type,
      isActive: this.parseOptionalBoolean(query.isActive),
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Device" WHERE "id"=${id} FOR UPDATE`;
        const existing = await tx.device.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Device not found');
        const assignmentChanged = dto.counterId !== undefined && dto.counterId !== existing.counterId;
        const nextActive = dto.isActive ?? existing.isActive;
        if (assignmentChanged) {
          if (!nextActive || (dto.status ?? existing.status) === DeviceStatus.INACTIVE)
            throw new ConflictException('Inactive devices cannot be assigned');
          const counter = await tx.counter.findUnique({ where: { id: dto.counterId } });
          if (!counter) throw new NotFoundException('Counter not found');
          if (!counter.isActive || counter.status === 'OUT_OF_SERVICE')
            throw new ConflictException('Device cannot be assigned to an inactive or out-of-service counter');
          await tx.deviceAssignmentHistory.updateMany({ where: { deviceId: id, unassignedAt: null },
            data: { unassignedAt: new Date(), unassignedById: user.id, reason: 'Device reassigned' } });
          await tx.deviceAssignmentHistory.create({ data: { deviceId: id, counterId: dto.counterId!,
            assignedById: user.id, reason: 'Device reassigned' } });
        }
        const normalized = { ...dto, serialNumber: dto.serialNumber === '' ? null : dto.serialNumber,
          assetTag: dto.assetTag === '' ? null : dto.assetTag,
          status: dto.isActive === false ? DeviceStatus.INACTIVE : dto.status };
        const device = await tx.device.update({ where: { id }, data: normalized });
        const action = assignmentChanged ? 'ASSIGN_DEVICE' : dto.isActive === false ? 'DEACTIVATE_DEVICE' :
          dto.isActive === true && !existing.isActive ? 'ACTIVATE_DEVICE' : 'UPDATE_DEVICE';
        await this.audit.record({ user, action, entityType: 'Device', entityId: id,
          metadata: { previousCounterId: existing.counterId, counterId: device.counterId,
            previousStatus: existing.status, status: device.status, previousIsActive: existing.isActive,
            isActive: device.isActive, identifiersChanged: existing.assetTag !== device.assetTag || existing.serialNumber !== device.serialNumber } }, tx);
        return device;
      });
    } catch (error) { this.rethrowUnique(error); }
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException('Device asset tag or serial number already exists');
    throw error;
  }
}
