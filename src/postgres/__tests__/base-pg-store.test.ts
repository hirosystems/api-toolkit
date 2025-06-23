import { BasePgStore, sqlTransactionContext } from '../base-pg-store';
import { connectPostgres } from '../connection';

class TestPgStore extends BasePgStore {
  static async connect(): Promise<TestPgStore> {
    const sql = await connectPostgres({ usageName: 'test' });
    return new TestPgStore(sql);
  }
}

describe('BasePgStore', () => {
  let db: TestPgStore;

  beforeEach(async () => {
    db = await TestPgStore.connect();
  });

  afterEach(async () => {
    await db.close();
  });

  test('bytea column serialization', async () => {
    const vectors = [
      {
        from: '0x0001',
        to: '0x0001',
      },
      {
        from: '0X0002',
        to: '0x0002',
      },
      {
        from: '0xFfF3',
        to: '0xfff3',
      },
      {
        from: Buffer.from('0004', 'hex'),
        to: '0x0004',
      },
      {
        from: new Uint16Array(new Uint8Array([0x00, 0x05]).buffer),
        to: '0x0005',
      },
      {
        from: '\\x0006',
        to: '0x0006',
      },
      {
        from: '\\xfFf7',
        to: '0xfff7',
      },
      {
        from: '\\x',
        to: '0x',
      },
      {
        from: '',
        to: '0x',
      },
      {
        from: Buffer.alloc(0),
        to: '0x',
      },
    ];
    await db.sqlWriteTransaction(async sql => {
      await sql`
        CREATE TEMPORARY TABLE bytea_testing(
          value bytea NOT NULL
        ) ON COMMIT DROP
      `;
      for (const v of vectors) {
        const query = await sql<{ value: string }[]>`
          insert into bytea_testing (value) values (${v.from})
          returning value
        `;
        expect(query[0].value).toBe(v.to);
      }
    });
    const badInputs = ['0x123', '1234', '0xnoop', new Date(), 1234];
    for (const input of badInputs) {
      const query = async () =>
        db.sql.begin(async sql => {
          await sql`
          CREATE TEMPORARY TABLE bytea_testing(
            value bytea NOT NULL
          ) ON COMMIT DROP
        `;
          return await sql`insert into bytea_testing (value) values (${input})`;
        });
      await expect(query()).rejects.toThrow();
    }
  });

  test('postgres transaction connection integrity', async () => {
    const obj = db.sql;
    const dbName = obj.options.database;

    expect(sqlTransactionContext.getStore()).toBeUndefined();
    await db.sqlTransaction(async sql => {
      // New connection object.
      const newObj = sql;
      expect(obj).not.toEqual(newObj);
      expect(sqlTransactionContext.getStore()?.[dbName]).toEqual(newObj);

      // Nested tx uses the same connection object.
      await db.sqlTransaction(sql => {
        expect(newObj).toEqual(sql);
      });

      // Getter returns the same connection object too.
      expect(db.sql).toEqual(newObj);
    });

    // Back to normal.
    expect(sqlTransactionContext.getStore()).toBeUndefined();
    expect(db.sql).toEqual(obj);
  });
});
