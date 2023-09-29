import PgMigrate from 'node-pg-migrate';
import { MigrationDirection } from 'node-pg-migrate/dist/types';
import { logger } from '../logger';
import { PgConnectionArgs, standardizedConnectionArgs } from './connection';

/**
 * Run migrations in one direction.
 * @param dir - Migrations directory
 * @param direction - Migration direction (`'down'` or `'up'`)
 * @param connectionArgs - Postgres connection args
 */
export async function runMigrations(
  dir: string,
  direction: MigrationDirection,
  connectionArgs?: PgConnectionArgs
) {
  const args = standardizedConnectionArgs(connectionArgs, 'migrations');
  await PgMigrate({
    dir,
    direction,
    count: Infinity,
    ignorePattern: '.*map',
    databaseUrl:
      typeof args === 'string'
        ? args
        : {
            host: args.host,
            port: args.port,
            user: args.user,
            password: args.password,
            database: args.database,
          },
    migrationsTable: 'pgmigrations',
    logger: {
      info: _msg => {},
      warn: msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });
}

/**
 * Cycle migrations down and up.
 * @param dir - Migrations directory
 * @param connectionArgs - Postgres connection args
 */
export async function cycleMigrations(dir: string, connectionArgs?: PgConnectionArgs) {
  await runMigrations(dir, 'down', connectionArgs);
  await runMigrations(dir, 'up', connectionArgs);
}
