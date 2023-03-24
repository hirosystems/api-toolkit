import * as path from 'path';
import PgMigrate from 'node-pg-migrate';
import { MigrationDirection } from 'node-pg-migrate/dist/types';
import { logger } from '../logger';

export async function runMigrations(direction: MigrationDirection) {
  await PgMigrate({
    direction: direction,
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
    dir: path.join(__dirname, '../../migrations'),
    logger: {
      info: msg => {},
      warn: msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });
}

export async function cycleMigrations() {
  await runMigrations('down');
  await runMigrations('up');
}
