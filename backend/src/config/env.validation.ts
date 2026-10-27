import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Validates environment variables once, at startup.
 * If anything required is missing or malformed, the app refuses to boot —
 * far better than failing on the first request in production.
 */
class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @Transform(({ value }) => Number(value))
  @IsInt()
  PORT: number = 3000;

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:5173';

  // How many reverse proxies sit in front of the app, so req.ip (used by rate
  // limiting) is the real client and not a proxy. 0 = none (local dev),
  // 1 = Nginx only, 2 = CloudFront → Nginx. "true"/"false" still work (= 1 / 0).
  @Transform(({ value }) => (value === true || value === 'true' ? 1 : value === false || value === 'false' ? 0 : Number(value)))
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY: number = 0;

  @IsString()
  DB_HOST: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  DB_PORT: number = 5432;

  @IsString()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = '1d';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  MAX_MONITORS_PER_USER: number = 10;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  MAX_MONITORS_PER_HOST: number = 3;

  // --- AWS / SQS (Day 2: scheduler + worker) ---

  @IsString()
  AWS_REGION: string;

  @IsString()
  SQS_QUEUE_URL: string;

  // Credentials are optional: locally they come from these env vars, but on EC2
  // (Day 4) the AWS SDK picks them up automatically from the instance's IAM role
  // instead — no long-lived keys in production.
  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY?: string;

  // How many consecutive failed checks open an incident (and trigger an email).
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  ALERT_FAILURE_THRESHOLD: number = 3;

  // SES sender address. Must be a verified identity in SES (sandbox mode).
  // Alerts are silently skipped (logged only) until this is set.
  @IsOptional()
  @IsString()
  ALERT_EMAIL_FROM?: string;

  // Run the in-process cron scheduler. Off by default in tests.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_SCHEDULER: boolean = true;

  // Run the in-process SQS worker loop. Off by default in tests.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_WORKER: boolean = true;
}

export type AppEnv = EnvironmentVariables;

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return validated;
}
