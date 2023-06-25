import PgMigrate from 'node-pg-migrate';
import { MigrationDirection } from 'node-pg-migrate/dist/types';
import { logger } from '../logger';

export async function runMigrations(dir: string, direction: MigrationDirection) {
  await PgMigrate({
    dir,
    direction,
    count: Infinity,
    ignorePattern: '.*map',
    databaseUrl: {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT ?? '5432'),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    migrationsTable: 'pgmigrations',
    logger: {
      info: msg => {},
      warn: msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });
}

export async function cycleMigrations(dir: string) {
  await runMigrations(dir, 'down');
  await runMigrations(dir, 'up');
}
