import { registerAs } from '@nestjs/config';

/** Almacenamiento de objetos S3-compatible (MinIO en desarrollo). */
export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicUrl?: string;
}

export const STORAGE_CONFIG = 'storage';

export default registerAs<StorageConfig>(STORAGE_CONFIG, () => ({
  endpoint: process.env.S3_ENDPOINT as string,
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET as string,
  accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  publicUrl: process.env.S3_PUBLIC_URL || undefined,
}));
