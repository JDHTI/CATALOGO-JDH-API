import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter, LoggingInterceptor } from '@common/index';
import { APP_CONFIG, type AppConfig } from '@infrastructure/config';
import { concurrencyLimit } from '@common/middlewares/concurrency-limit.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService).getOrThrow<AppConfig>(APP_CONFIG);

  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(compression());
  app.enableCors();
  const healthPath = `/${config.apiPrefix}/v${config.apiVersion.replace(/^v/, '')}/health`;
  app.use(
    concurrencyLimit(config.maxInflightRequests, [
      `${healthPath}/live`,
      `${healthPath}/ready`,
    ]),
  );

  app.enableShutdownHooks();

  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.apiVersion.replace(/^v/, ''),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('JDH Catálogo API')
        .setDescription('API del catálogo de productos JDH')
        .setVersion(config.apiVersion)
        // El catálogo es público; solo las superficies privadas piden token
        // (ver docs/favoritos.md y docs/order-lists.md).
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .build(),
    );
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document);
  }

  const server = app.getHttpServer();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 65000;
  await app.listen(config.port);
  new Logger('Bootstrap').log(
    `API escuchando en http://localhost:${config.port}/${config.apiPrefix}`,
  );
}

void bootstrap();
