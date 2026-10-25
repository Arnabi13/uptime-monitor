import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * Single source of truth for DB settings, shared by the Nest app
 * and the TypeORM CLI (data-source.ts), so they can never drift apart.
 *
 * synchronize is ALWAYS false: schema changes only happen through
 * reviewed migrations, never by TypeORM guessing from entities.
 */
export function buildTypeOrmOptions(env: NodeJS.ProcessEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    // gen_random_uuid() is built into Postgres 13+, so no extension to install.
    uuidExtension: 'pgcrypto',
    // ...and so TypeORM shouldn't try to CREATE EXTENSION (needs extra DB privileges).
    installExtensions: false,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging:
      env.NODE_ENV === 'test'
        ? false // tests deliberately trigger constraint errors; keep the output clean
        : env.NODE_ENV === 'development'
          ? ['error', 'warn', 'migration']
          : ['error'],
  };
}
