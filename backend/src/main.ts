import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export function configureApp(app: NestExpressApplication, config: ConfigService): void {
  app.setGlobalPrefix('api');

  // whitelist: strip unknown fields; forbidNonWhitelisted: reject them loudly.
  // So a client can't sneak in { "userId": "<someone else>" } on a create.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGIN', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  });

  // Behind Nginx every request comes from the proxy's IP. Trusting one proxy hop
  // makes req.ip the real client IP, which rate limiting depends on.
  if (config.get<boolean>('TRUST_PROXY')) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  configureApp(app, config);

  // Lets Docker stop the container gracefully (finish requests, close DB pool) on SIGTERM.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

if (require.main === module) {
  void bootstrap();
}
