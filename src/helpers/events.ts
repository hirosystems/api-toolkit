import { EventEmitter, addAbortListener } from 'node:events';

// This is a workaround for Node.js versions that do not support Symbol.dispose
const DisposeSymbol: typeof Symbol.dispose = Symbol.dispose ?? Symbol.for('nodejs.dispose');

/**
 * Creates a Promise that resolves when the specified `eventName` is emitted by the `EventEmitter`
 * and the provided predicate returns `true` for the emitted arguments.
 *
 * Similar to [`events.once`](https://nodejs.org/api/events.html#eventsonceemitter-name-options),
 * but includes support for a predicate function to filter events. Only events for which
 * the predicate returns `true` will cause the Promise to resolve.
 *
 * The resolved value is an array of the arguments emitted with the event.
 *
 * Supports typed `EventEmitter`s and optional cancellation via `AbortSignal`.
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'node:events';
 *
 * const emitter = new EventEmitter<{
 *   myEvent: [id: number, msg: string];
 * }>();
 *
 * setTimeout(() => {
 *   for (let i = 0; i <= 5; i++) {
 *     emitter.emit('myEvent', i, `Message ${i}`);
 *   }
 * }, 100);
 *
 * const [id, msg] = await onceWhen(emitter, 'myEvent', (id, msg) => id === 3);
 *
 * // outputs: "Received event with id: 3, message: Message 3"
 * console.log(`Received event with id: ${id}, message: ${msg}`);
 * ```
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'node:events';
 *
 * const emitter = new EventEmitter<{ myEvent: [id: number, msg: string] }>();
 *
 * const signal = AbortSignal.timeout(10);
 *
 * setTimeout(() => emitter.emit('myEvent', 1, 'Hello'), 1000);
 *
 * const whenPromise = onceWhen(emitter, 'myEvent', id => id === 1, { signal });
 *
 * // This rejects because the signal is aborted before the event is emitted
 * await expect(whenPromise).rejects.toThrow(signal.reason);
 * ```
 */
export function onceWhen<
  EventMap extends Record<string, any[]> = Record<string, any[]>,
  K extends Extract<keyof EventMap, string> = Extract<keyof EventMap, string>
>(
  emitter: EventEmitter<EventMap>,
  eventName: K,
  predicate: (...args: EventMap[K]) => boolean,
  options?: { signal?: AbortSignal }
): Promise<EventMap[K]> {
  return new Promise((resolve, reject) => {
    // Immediate abort check
    if (options?.signal?.aborted) {
      reject((options.signal.reason as Error) ?? new Error('Aborted'));
      return;
    }

    // Cleanup helper: remove both the event listener and the abort listener
    const cleanup = () => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      (emitter as EventEmitter).off(eventName, listener);
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      disposable?.[DisposeSymbol]();
    };

    // Abort handler
    const onAbort = () => {
      cleanup();
      reject((options?.signal?.reason as Error) ?? new Error('Aborted'));
    };

    // Our event listener that checks the predicate
    const listener = (...args: EventMap[K]) => {
      try {
        if (predicate(...args)) {
          cleanup();
          resolve(args);
        }
      } catch (err) {
        cleanup();
        reject(err as Error);
        return;
      }
    };

    // Install the AbortSignal listener via Node’s helper
    const disposable = options?.signal ? addAbortListener(options.signal, onAbort) : undefined;

    (emitter as EventEmitter).on(eventName, listener);
  });
}
