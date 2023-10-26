import { getPostgres } from '../connection';

function setTestEnvVars(
  envVars: Record<string, string | undefined>,
  use: () => Promise<void>
): Promise<void>;
function setTestEnvVars(envVars: Record<string, string | undefined>, use: () => void): void;
function setTestEnvVars(
  envVars: Record<string, string | undefined>,
  use: () => void | Promise<void>
): void | Promise<void> {
  const existing = Object.fromEntries(
    Object.keys(envVars)
      .filter(k => k in process.env)
      .map(k => [k, process.env[k]])
  );
  const added = Object.keys(envVars).filter(k => !(k in process.env));
  Object.entries(envVars).forEach(([k, v]) => {
    process.env[k] = v;
    if (v === undefined) {
      delete process.env[k];
    }
  });
  const restoreEnvVars = () => {
    added.forEach(k => delete process.env[k]);
    Object.entries(existing).forEach(([k, v]) => (process.env[k] = v));
  };
  let runFn: void | Promise<void> | undefined;
  try {
    runFn = use();
    if (runFn instanceof Promise) {
      return runFn.finally(() => restoreEnvVars());
    }
  } finally {
    if (!(runFn instanceof Promise)) {
      restoreEnvVars();
    }
  }
}

describe('postgres connection', () => {
  test('postgres env var config', () => {
    setTestEnvVars(
      {
        PGDATABASE: 'pg_db_db1',
        PGUSER: 'pg_user_user1',
        PGPASSWORD: 'pg_password_password1',
        PGHOST: 'pg_host_host1',
        PGPORT: '9876',
        PGSSLMODE: 'allow',
        PGAPPNAME: 'test-env-vars',
      },
      () => {
        const sql = getPostgres({ usageName: 'tests' });
        expect(sql.options.database).toBe('pg_db_db1');
        expect(sql.options.user).toBe('pg_user_user1');
        expect(sql.options.pass).toBe('pg_password_password1');
        expect(sql.options.host).toStrictEqual(['pg_host_host1']);
        expect(sql.options.port).toStrictEqual([9876]);
        expect(sql.options.ssl).toBe('allow');
        expect(sql.options.connection.application_name).toBe('test-env-vars:tests');
      }
    );
  });

  test('postgres uri config', () => {
    const uri =
      'postgresql://test_user:secret_password@database.server.com:3211/test_db?ssl=true&search_path=test_schema&application_name=test-conn-str';
    const sql = getPostgres({ usageName: 'tests', connectionArgs: uri });
    expect(sql.options.database).toBe('test_db');
    expect(sql.options.user).toBe('test_user');
    expect(sql.options.pass).toBe('secret_password');
    expect(sql.options.host).toStrictEqual(['database.server.com']);
    expect(sql.options.port).toStrictEqual([3211]);
    expect(sql.options.ssl).toBe('true');
    expect(sql.options.connection.search_path).toBe('test_schema');
    expect(sql.options.connection.application_name).toBe('test-conn-str:tests');
  });
});
