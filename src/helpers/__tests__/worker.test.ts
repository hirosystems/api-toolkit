import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import { WorkerThreadManager } from '../worker-thread-manager';
import * as workerModule from './my-worker';
import workerModuleDefaultExport from './my-worker-export-default';
import { MyCustomError } from './my-worker';
import { addKnownErrorConstructor } from '../serialize-error';
import { stopwatch } from '../time';

test('worker module with default exports', async () => {
  const workerManager = await WorkerThreadManager.init(workerModuleDefaultExport, {
    workerCount: 2,
  });
  const res = await workerManager.exec(1, 1);
  expect(res).toBe('1');
  await workerManager.close();
});

describe('Worker tests', () => {
  let workerManager: Awaited<ReturnType<typeof initWorkerManager>>;
  const workerCount = Math.min(4, os.cpus().length);
  const cpuPeggedTimeMs = 500;

  function initWorkerManager() {
    return WorkerThreadManager.init(workerModule, { workerCount });
  }

  beforeAll(async () => {
    addKnownErrorConstructor(MyCustomError);
    console.time('worker manager init');
    const manager = await initWorkerManager();
    console.timeEnd('worker manager init');
    workerManager = manager;
  });

  afterAll(async () => {
    await workerManager.close();
  });

  test('run tasks with workers', async () => {
    const watch = stopwatch();
    const taskPromises = Array.from({ length: workerCount }, async (_, i) => {
      console.time(`task ${i}`);
      const res = await workerManager.exec(i, cpuPeggedTimeMs);
      console.timeEnd(`task ${i}`);
      return res;
    });

    // Ensure all workers were assigned a task
    expect(workerManager.busyWorkerCount).toBe(workerCount);
    expect(workerManager.idleWorkerCount).toBe(0);

    const results = await Promise.allSettled(taskPromises);

    // All tasks should complete roughly within the time in takes for one task to complete
    // because the tasks are run in parallel on different threads.
    expect(watch.getElapsed()).toBeLessThan(cpuPeggedTimeMs * 1.75);

    // Ensure tasks returned in expected order:
    for (let i = 0; i < workerCount; i++) {
      const result = results[i];
      assert(result.status === 'fulfilled');
      expect(result.value).toBe(i.toString());
    }
  });

  test('worker task throws with non-Error value', async () => {
    const [res] = await Promise.allSettled([
      // The worker will throw a non-error value when it receives this specific req value
      workerManager.exec(3333, 1),
    ]);
    assert(res.status === 'rejected');
    expect(res.reason).toBe('boom');
  });

  test('worker task throws error', async () => {
    // Test that error de/ser across worker thread boundary works as expected
    const [res] = await Promise.allSettled([
      // The worker will throw an error when it receives this specific req value
      workerManager.exec(2222, 1),
    ]);
    assert(res.status === 'rejected');
    expect(res.reason).toBeInstanceOf(MyCustomError);
    expect(res.reason).toMatchObject({
      name: 'MyCustomError',
      message: 'Error at req',
      code: 123,
      stack: expect.any(String),
      randoProp: {
        foo: 'bar',
        baz: 123,
        aggregate: [
          {
            name: 'Error',
            message: 'Error in aggregate 1',
            inner1code: 123,
            stack: expect.any(String),
          },
          {
            name: 'MyCustomError',
            message: 'Error in aggregate 2',
            stack: expect.any(String),
          },
        ],
        sourceError: {
          name: 'MyCustomError',
          message: 'Source error',
          sourceErrorInfo: {
            code: 44,
          },
          stack: expect.any(String),
        },
      },
    });
  });

  test('run tasks on main thread', async () => {
    const watch = stopwatch();
    const results = await Promise.allSettled(
      Array.from({ length: workerCount }, (_, i) => {
        return Promise.resolve().then(() => workerModule.processTask(i, cpuPeggedTimeMs));
      })
    );

    // All tasks should take at least as long as taskCount * cpuPeggedTimeMs because
    // they are run synchronously on the main thread.
    expect(watch.getElapsed()).toBeGreaterThanOrEqual(workerCount * cpuPeggedTimeMs);

    // Ensure tasks returned in expected order:
    for (let i = 0; i < workerCount; i++) {
      const result = results[i];
      assert(result.status === 'fulfilled');
      expect(result.value).toBe(i.toString());
    }
  });
});
