import { IsBoolean, IsEmail, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  logoPath?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  logoPath?: string;
}

export class UpdateCompanyLogoDto {
  @IsUrl()
  logoUrl: string;
}
