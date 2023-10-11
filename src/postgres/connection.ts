import * as postgres from 'postgres';
import { logger } from '../logger';
import { isPgConnectionError } from './errors';
import { stopwatch, timeout } from './helpers';
import { PG_TYPE_MAPPINGS } from './types';

/** Postgres client instance */
export type PgSqlClient = postgres.Sql<any> | postgres.TransactionSql<any>;
/** Postgres pending query or query fragment */
export type PgSqlQuery = postgres.PendingQuery<postgres.Row[]>;

/** Postgres connection URI string */
export type PgConnectionUri = string;
/** Postgres connection values */
export type PgConnectionVars = {
  database?: string;
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  schema?: string;
  ssl?: boolean;
  application_name?: string;
};
/** Postgres connection arguments */
export type PgConnectionArgs = PgConnectionUri | PgConnectionVars;
/** Postgres connection options */
export type PgConnectionOptions = {
  /** Time to wait before automatically closing an idle connection (s) */
  idleTimeout?: number;
  /** Maximum allowed duration of any statement (ms) */
  statementTimeout?: number;
  /** Maximum time a connection can exist (s) */
  maxLifetime?: number;
  /** Max number of connections */
  poolMax?: number;
};

/**
 * Takes in connection arguments provided via an object or a connection string and returns them with
 * a standardized application name format. If no connection args are provided, they are built from
 * standard postgres ENV vars.
 * @param args - Connection arguments
 * @param usage - Usage string
 * @returns PgConnectionVars
 */
export function standardizedConnectionArgs(
  args?: PgConnectionArgs,
  usage?: string
): PgConnectionArgs {
  const appName = process.env.APPLICATION_NAME ?? process.env.PGAPPNAME ?? 'postgres';
  const appUsage = usage ?? 'query';
  if (!args) {
    return {
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT ?? '5432'),
      ssl: true,
      application_name: `${appName}:${appUsage}`,
    };
  }
  if (typeof args === 'string') {
    const uri = new URL(args);
    uri.searchParams.set(
      'application_name',
      `${uri.searchParams.get('application_name') ?? appName}:${appUsage}`
    );
    return uri.toString();
  }
  return args;
}

/**
 * Connects to Postgres. This function will also test the connection first to make sure all
 * connection parameters were specified correctly.
 * @param args - Connection options
 * @returns configured `Pool` object
 */
export async function connectPostgres({
  usageName,
  connectionArgs,
  connectionConfig,
}: {
  usageName: string;
  connectionArgs: PgConnectionArgs;
  connectionConfig?: PgConnectionOptions;
}): Promise<PgSqlClient> {
  const initTimer = stopwatch();
  let connectionError: Error | undefined;
  let connectionOkay = false;
  let lastElapsedLog = 0;
  do {
    const testSql = getPostgres({
      usageName: `${usageName};conn-poll`,
      connectionArgs,
      connectionConfig,
    });
    try {
      await testSql`SELECT version()`;
      connectionOkay = true;
      break;
    } catch (error: any) {
      if (isPgConnectionError(error)) {
        const timeElapsed = initTimer.getElapsed();
        if (timeElapsed - lastElapsedLog > 2000) {
          lastElapsedLog = timeElapsed;
          logger.error(error, 'Pg connection failed, retrying..');
        }
        connectionError = error;
        await timeout(100);
      } else {
        logger.error(error, 'Cannot connect to pg');
        throw error;
      }
    } finally {
      await testSql.end();
    }
  } while (initTimer.getElapsed() < Number.MAX_SAFE_INTEGER);
  if (!connectionOkay) {
    connectionError = connectionError ?? new Error('Error connecting to database');
    throw connectionError;
  }
  const sql = getPostgres({
    usageName: `${usageName};datastore-crud`,
    connectionArgs,
    connectionConfig,
  });
  return sql;
}

/**
 * Creates a Postgres client based on the provided connection arguments.
 * @param args - Connection options
 * @returns PgSqlClient
 */
export function getPostgres({
  usageName,
  connectionArgs,
  connectionConfig,
}: {
  usageName: string;
  connectionArgs: PgConnectionArgs;
  connectionConfig?: PgConnectionOptions;
}): PgSqlClient {
  const args = standardizedConnectionArgs(connectionArgs, usageName);
  if (typeof args === 'string') {
    return postgres(args, {
      idle_timeout: connectionConfig?.idleTimeout,
      max_lifetime: connectionConfig?.maxLifetime,
      max: connectionConfig?.poolMax,
    });
  } else {
    return postgres({
      database: args.database,
      user: args.user,
      password: args.password,
      host: args.host,
      port: args.port,
      ssl: args.ssl,
      idle_timeout: connectionConfig?.idleTimeout,
      max_lifetime: connectionConfig?.maxLifetime,
      max: connectionConfig?.poolMax,
      types: PG_TYPE_MAPPINGS,
      connection: {
        application_name: args.application_name,
        search_path: args.schema,
        statement_timeout: connectionConfig?.statementTimeout?.toString(),
      },
    });
  }
}
