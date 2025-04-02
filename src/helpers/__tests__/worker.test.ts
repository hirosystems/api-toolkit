import { addKnownErrorConstructor } from '../serialize-error';
import { WorkerManager } from '../worker-threads';
import { MyCustomError } from './my-worker-errors';
import workerModule from './my-worker-export-default';
import * as starWorkerModule from './my-worker-export-inline';

describe('Worker tests - default import', () => {
  beforeAll(() => {
    addKnownErrorConstructor(MyCustomError);
  });

  test('worker debugging', async () => {
    // worker module as a default import
    const workerManager1 = await WorkerManager.init(workerModule);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        return workerManager1.exec(i);
      })
    ).finally(() => void workerManager1.close());
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => i.toString()));

    // worker module as a star import
    const workerManager2 = await WorkerManager.init(starWorkerModule);
    const results2 = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        return workerManager2.exec(i);
      })
    ).finally(() => void workerManager2.close());
    expect(results2).toEqual(Array.from({ length: 10 }, (_, i) => i.toString()));

    // Ensure running the worker directly has the same results
    const resultsDirect = Array.from({ length: 10 }, (_, i) => workerModule.processTask(i));
    expect(resultsDirect).toEqual(Array.from({ length: 10 }, (_, i) => i.toString()));
  }, 30_000);

  test('worker error deser', async () => {
    const workerManager1 = await WorkerManager.init(workerModule);
    // job req of 555 throws an error
    try {
      await workerManager1.exec(555);
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MyCustomError);
      expect(error).toMatchObject({
        name: 'MyCustomError',
        code: 123,
        deep: { foo: 'bar', baz: 123 },
      });
    } finally {
      await workerManager1.close();
    }

    // worker module as a star import
    const workerManager2 = await WorkerManager.init(starWorkerModule);
    try {
      await workerManager2.exec(555);
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MyCustomError);
      expect(error).toMatchObject({
        name: 'MyCustomError',
        code: 123,
        deep: { foo: 'bar', baz: 123 },
      });
    } finally {
      await workerManager2.close();
    }

    // Ensure running the worker directly has the same results
    try {
      workerModule.processTask(555);
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MyCustomError);
      expect(error).toMatchObject({
        name: 'MyCustomError',
        code: 123,
        deep: { foo: 'bar', baz: 123 },
      });
    }
  }, 30_000);
});
