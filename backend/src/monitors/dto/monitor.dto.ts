import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MonitorMethod } from '../monitor.entity';

/**
 * Shape-level validation only. Whether the URL is SAFE to call
 * (DNS, private IPs) is checked in the service, because it needs async DNS.
 */
export class CreateMonitorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsEnum(MonitorMethod)
  method?: MonitorMethod;

  /** Minimum 60s: stops anyone using us to hammer a site (and keeps our costs sane). */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  intervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(30_000)
  timeoutMs?: number;

  /** Send null to go back to "any 2xx/3xx is up". */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(100)
  @Max(599)
  expectedStatusCode?: number | null;

  /** Show on the public status page (name + status only — never the URL). */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateMonitorDto extends PartialType(CreateMonitorDto) {
  /** false = pause checks, true = resume. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class HistoryQueryDto {
  @IsOptional()
  @IsIn(['24h', '7d', '30d'])
  range?: '24h' | '7d' | '30d';
}
