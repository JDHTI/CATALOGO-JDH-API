import { Readable } from 'node:stream';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { STORAGE_CONFIG, type StorageConfig } from '@infrastructure/config';

export interface PutObjectOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface StoredObject {
  key: string;
  url: string;
}

/**
 * Almacenamiento de objetos S3-compatible.
 * En desarrollo apunta a MinIO; en producción, a S3 real sin cambiar el código.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly config: StorageConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<StorageConfig>(STORAGE_CONFIG);

    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  get bucket(): string {
    return this.config.bucket;
  }

  /** URL pública del objeto (usa S3_PUBLIC_URL si está configurada). */
  publicUrl(key: string): string {
    const base =
      this.config.publicUrl ??
      `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}`;
    return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }

  async put(
    key: string,
    body: Buffer | Readable | Uint8Array | string,
    options: PutObjectOptions = {},
  ): Promise<StoredObject> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        Metadata: options.metadata,
        CacheControl: options.cacheControl,
      },
    });

    await upload.done();
    this.logger.debug(`Objeto subido: ${key}`);

    return { key, url: this.publicUrl(key) };
  }

  async get(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return response.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async healthCheck(): Promise<boolean> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.bucket }),
    );
    return true;
  }
}
