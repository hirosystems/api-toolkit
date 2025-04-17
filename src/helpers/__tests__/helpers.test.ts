import * as events from 'node:events';
import { timeout, waiter } from '../time';

describe('Helper tests', () => {
  test('timeout function should not cause memory leak by accumulating abort listeners on abort', async () => {
    const controller = new AbortController();
    const { signal } = controller;

    const countListeners = () => events.getEventListeners(signal, 'abort').length;

    // Ensure the initial listener count is zero
    expect(countListeners()).toBe(0);

    // Run enough iterations to detect a pattern
    for (let i = 0; i < 100; i++) {
      try {
        const sleepPromise = timeout(1000, signal);
        controller.abort(); // Abort immediately
        await sleepPromise;
      } catch (err: any) {
        expect(err.toString()).toMatch(/aborted/i);
      }

      // Assert that listener count does not increase
      expect(countListeners()).toBeLessThanOrEqual(1); // 1 listener may temporarily be added and removed
    }

    // Final check to confirm listeners are cleaned up
    expect(countListeners()).toBe(0);
  });

  test('timeout function should not cause memory leak by accumulating abort listeners on successful completion', async () => {
    const controller = new AbortController();
    const { signal } = controller;

    const countListeners = () => events.getEventListeners(signal, 'abort').length;

    // Ensure the initial listener count is zero
    expect(countListeners()).toBe(0);

    // Run enough iterations to detect a pattern
    for (let i = 0; i < 100; i++) {
      await timeout(2, signal); // Complete sleep without abort

      // Assert that listener count does not increase
      expect(countListeners()).toBe(0); // No listeners should remain after successful sleep completion
    }

    // Final check to confirm listeners are cleaned up
    expect(countListeners()).toBe(0);
  });

  test('waiter is resolved', async () => {
    const myWaiter = waiter();
    myWaiter.resolve();
    await myWaiter;
    expect(myWaiter.isFinished).toBe(true);
    expect(myWaiter.isRejected).toBe(false);
    expect(myWaiter.isResolved).toBe(true);
  });

  test('waiter is resolved with value', async () => {
    const myWaiter = waiter<string>();
    const value = 'my resolve result';
    myWaiter.resolve(value);
    const result = await myWaiter;
    expect(result).toBe(value);
    expect(myWaiter.isFinished).toBe(true);
    expect(myWaiter.isRejected).toBe(false);
    expect(myWaiter.isResolved).toBe(true);
  });

  test('waiter is finished (ensure finish alias works)', async () => {
    const myWaiter = waiter();
    myWaiter.finish();
    await myWaiter;
    expect(myWaiter.isFinished).toBe(true);
    expect(myWaiter.isRejected).toBe(false);
    expect(myWaiter.isResolved).toBe(true);
  });

  test('waiter is rejected', async () => {
    const myWaiter = waiter();
    const error = new Error('Waiter was rejected');
    myWaiter.reject(error);
    await expect(myWaiter).rejects.toThrow(error);
    expect(myWaiter.isFinished).toBe(true);
    expect(myWaiter.isRejected).toBe(true);
    expect(myWaiter.isResolved).toBe(false);
  });

  test('waiter is rejected with error type', async () => {
    class MyError extends Error {
      readonly name = 'MyError';
    }
    const myWaiter = waiter<void, MyError>();
    const error = new MyError('MyError test instance');
    myWaiter.reject(error);
    await expect(myWaiter).rejects.toThrow(error);
    expect(myWaiter.isFinished).toBe(true);
    expect(myWaiter.isRejected).toBe(true);
    expect(myWaiter.isResolved).toBe(false);

    // Expect other error types to cause a typescript error
    class OtherError extends Error {
      readonly name = 'OtherError';
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    myWaiter.reject(new OtherError('OtherError test instance'));
  });
});
