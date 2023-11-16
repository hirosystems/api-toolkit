import PgMigrate from 'node-pg-migrate';
import { MigrationDirection } from 'node-pg-migrate/dist/types';
import { logger } from '../logger';
import { PgConnectionArgs, connectPostgres, standardizedConnectionArgs } from './connection';
import { isDevEnv, isTestEnv } from '../helpers/values';

export interface MigrationOptions {
  // Bypass the NODE_ENV check when performing a "down" migration which irreversibly drops data.
  dangerousAllowDataLoss?: boolean;
  logMigrations?: boolean;
}

/**
 * Run migrations in one direction.
 * @param dir - Migrations directory
 * @param direction - Migration direction (`'down'` or `'up'`)
 * @param connectionArgs - Postgres connection args
 * @param opts - Migration options
 */
export async function runMigrations(
  dir: string,
  direction: MigrationDirection,
  connectionArgs?: PgConnectionArgs,
  opts?: MigrationOptions
) {
  if (!opts?.dangerousAllowDataLoss && direction !== 'up' && !isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
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
      info: msg => (opts?.logMigrations === true ? logger.info(msg) : {}),
      warn: msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });
}

/**
 * Cycle migrations down and up.
 * @param dir - Migrations directory
 * @param connectionArgs - Postgres connection args
 * @param opts - Migration options
 */
export async function cycleMigrations(
  dir: string,
  connectionArgs?: PgConnectionArgs,
  opts?: MigrationOptions & {
    checkForEmptyData?: boolean;
  }
) {
  await runMigrations(dir, 'down', connectionArgs, opts);
  if (
    opts?.checkForEmptyData &&
    (await databaseHasData(connectionArgs, { ignoreMigrationTables: true }))
  ) {
    throw new Error('Migration down process did not completely remove DB tables');
  }
  await runMigrations(dir, 'up', connectionArgs, opts);
}

/**
 * Check the `pg_class` table for any data structures contained in the database. We will consider
 * any and all results here as "data" contained in the DB, since anything that is not a completely
 * empty DB could lead to strange errors when running the API. See:
 * https://www.postgresql.org/docs/current/catalog-pg-class.html
 * @returns `boolean` if the DB has data
 */
export async function databaseHasData(
  connectionArgs?: PgConnectionArgs,
  opts?: {
    ignoreMigrationTables?: boolean;
  }
): Promise<boolean> {
  const sql = await connectPostgres({
    usageName: 'contains-data-check',
    connectionArgs: standardizedConnectionArgs(connectionArgs, 'contains-data-check'),
  });
  try {
    const ignoreMigrationTables = opts?.ignoreMigrationTables ?? false;
    const result = await sql<{ count: number }[]>`
      SELECT COUNT(*)
      FROM pg_class c
      JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = ${sql.options.connection.search_path}
      ${ignoreMigrationTables ? sql`AND c.relname NOT LIKE 'pgmigrations%'` : sql``}
    `;
    return result.count > 0 && result[0].count > 0;
  } catch (error: any) {
    if (error.message?.includes('does not exist')) {
      return false;
    }
    throw error;
  } finally {
    await sql.end();
  }
}

/**
 * Drops all tables from the Postgres DB. DANGEROUS!!!
 */
export async function dangerousDropAllTables(
  connectionArgs?: PgConnectionArgs,
  opts?: {
    acknowledgePotentialCatastrophicConsequences?: 'yes';
  }
) {
  if (opts?.acknowledgePotentialCatastrophicConsequences !== 'yes') {
    throw new Error('Dangerous usage error.');
  }
  const sql = await connectPostgres({
    usageName: 'dangerous-drop-all-tables',
    connectionArgs: standardizedConnectionArgs(connectionArgs, 'dangerous-drop-all-tables'),
  });
  const schema = sql.options.connection.search_path;
  try {
    await sql.begin(async sql => {
      const relNamesQuery = async (kind: string) => sql<{ relname: string }[]>`
        SELECT relname
        FROM pg_class c
        JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = ${schema} AND c.relkind = ${kind}
      `;
      // Remove materialized views first and tables second.
      // Using CASCADE in these DROP statements also removes associated indexes and constraints.
      const views = await relNamesQuery('m');
      for (const view of views) {
        await sql`DROP MATERIALIZED VIEW IF EXISTS ${sql(view.relname)} CASCADE`;
      }
      const tables = await relNamesQuery('r');
      for (const table of tables) {
        await sql`DROP TABLE IF EXISTS ${sql(table.relname)} CASCADE`;
      }
    });
  } finally {
    await sql.end();
  }
}
