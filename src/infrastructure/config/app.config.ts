import { registerAs } from '@nestjs/config';
import { Environment } from './env.validation';

export interface AppConfig {
  env: Environment;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  isProduction: boolean;
}

export const APP_CONFIG = 'app';

export default registerAs<AppConfig>(APP_CONFIG, () => {
  const env = (process.env.NODE_ENV as Environment) ?? Environment.Development;

  return {
    env,
    port: Number(process.env.PORT ?? 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    apiVersion: process.env.API_VERSION ?? 'v1',
    isProduction: env === Environment.Production,
  };
});
