import { IsBoolean, IsEmail, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  name: string;

  @IsString()
  @Matches(/^[A-Z0-9]{2}$/, {
    message: 'Company code must contain exactly two uppercase letters or numbers',
  })
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
  @Matches(/^[A-Z0-9]{2}$/, {
    message: 'Company code must contain exactly two uppercase letters or numbers',
  })
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
