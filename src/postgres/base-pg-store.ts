import { AsyncLocalStorage } from 'async_hooks';
import { PgSqlClient } from '.';
import { isProdEnv } from '../helpers/values';

/**
 * AsyncLocalStorage used to determine if the current async context is running inside a SQL
 * transaction.
 */
export const sqlTransactionContext = new AsyncLocalStorage<SqlTransactionContext>();
type SqlTransactionContext = {
  usageName: string;
  sql: PgSqlClient;
};
type UnwrapPromiseArray<T> = T extends any[]
  ? {
      [k in keyof T]: T[k] extends Promise<infer R> ? R : T[k];
    }
  : T;

/**
 * Base class that provides access to a SQL client and SQL transaction management.
 */
export abstract class BasePgStore {
  /**
   * Getter for a SQL client. If used inside `sqlTransaction`, the scoped client within the current
   * async context will be returned to guarantee transaction consistency.
   */
  get sql(): PgSqlClient {
    const sqlContext = sqlTransactionContext.getStore();
    return sqlContext ? sqlContext.sql : this._sql;
  }
  private readonly _sql: PgSqlClient;

  constructor(sql: PgSqlClient) {
    this._sql = sql;
  }

  async close(args?: { timeout?: number }) {
    await this._sql.end({ timeout: args?.timeout });
  }

  /**
   * Start a SQL transaction. If any SQL client used within the callback was already scoped inside a
   * `BEGIN` transaction, no new transaction will be opened. This flexibility allows us to avoid
   * repeating code while making sure we don't arrive at SQL errors such as
   * `WARNING: there is already a transaction in progress` which may cause result inconsistencies.
   * @param callback - Callback with a scoped SQL client
   * @param readOnly - If a `BEGIN` transaction should be marked as `READ ONLY`
   * @returns Transaction results
   */
  async sqlTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>,
    readOnly = true
  ): Promise<UnwrapPromiseArray<T>> {
    // Do we have a scoped client already? Use it directly.
    const sqlContext = sqlTransactionContext.getStore();
    if (sqlContext) {
      return callback(sqlContext.sql) as UnwrapPromiseArray<T>;
    }
    // Otherwise, start a transaction and store the scoped connection in the current async context.
    const usageName = this._sql.options.connection.application_name ?? '';
    return this._sql.begin(readOnly ? 'read only' : 'read write', sql => {
      return sqlTransactionContext.run({ usageName, sql }, () => callback(sql));
    });
  }

  /**
   * Start a SQL write transaction. See `sqlTransaction`.
   * @param callback - Callback with a scoped SQL client
   * @returns Transaction results
   */
  async sqlWriteTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>
  ): Promise<UnwrapPromiseArray<T>> {
    return this.sqlTransaction(callback, false);
  }

  /**
   * Refreshes a materialized view concurrently depending on the current environment.
   * @param viewName - Materialized view name
   */
  async refreshMaterializedView(viewName: string): Promise<void> {
    await this.sql`REFRESH MATERIALIZED VIEW ${
      isProdEnv ? this.sql`CONCURRENTLY` : this.sql``
    } ${this.sql(viewName)}`;
  }
}

/**
 * Base module that extends PgStore functionality and allows organizing queries in separate files.
 */
export abstract class BasePgStoreModule {
  private readonly parent: BasePgStore;

  constructor(db: BasePgStore) {
    this.parent = db;
  }

  protected get sql(): PgSqlClient {
    return this.parent.sql;
  }

  async sqlTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>,
    readOnly = true
  ): Promise<UnwrapPromiseArray<T>> {
    return this.parent.sqlTransaction(callback, readOnly);
  }
  async sqlWriteTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>
  ): Promise<UnwrapPromiseArray<T>> {
    return this.sqlTransaction(callback, false);
  }
  async refreshMaterializedView(viewName: string): Promise<void> {
    return this.parent.refreshMaterializedView(viewName);
  }
}
