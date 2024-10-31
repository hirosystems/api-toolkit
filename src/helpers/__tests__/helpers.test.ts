import * as events from 'node:events';
import { timeout } from '../time';

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
});
