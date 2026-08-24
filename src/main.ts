import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter, LoggingInterceptor } from '@common/index';
import { APP_CONFIG, type AppConfig } from '@infrastructure/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService).getOrThrow<AppConfig>(APP_CONFIG);

  app.use(helmet());
  app.use(compression());
  app.enableCors();
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
        .build(),
    );
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document);
  }

  await app.listen(config.port);
  new Logger('Bootstrap').log(
    `API escuchando en http://localhost:${config.port}/${config.apiPrefix}`,
  );
}

void bootstrap();
