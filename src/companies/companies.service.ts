import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateCompanyDto, user: AuthUser) {
    const exists = await this.prisma.company.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Company code already exists');
    const company = await this.prisma.company.create({ data: dto });
    await this.audit.record({ user, action: 'CREATE_COMPANY', entityType: 'Company', entityId: company.id });
    return company;
  }

  async list(query: PaginationDto) {
    const { skip, take, page, limit } = paginate(query);
    const where: Prisma.CompanyWhereInput = query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.company.count({ where }),
    ]);
    return { items, meta: { total, page, limit } };
  }

  async find(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, user: AuthUser) {
    await this.find(id);
    const company = await this.prisma.company.update({ where: { id }, data: dto });
    await this.audit.record({ user, action: 'UPDATE_COMPANY', entityType: 'Company', entityId: id });
    return company;
  }
}
