import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

/**
 * Wait a set amount of milliseconds or until the timer is aborted.
 * @param ms - Number of milliseconds to wait
 * @param abort - Abort controller
 * @returns Promise
 */
export function timeout(ms: number, abort?: AbortController | AbortSignal): Promise<void> {
  const signal = abort && (abort instanceof AbortSignal ? abort : abort.signal);
  return setTimeoutAsync(ms, undefined, { signal });
}

/**
 * Time the execution of an async function.
 * @param fn - Async function
 * @param onFinish - Callback with elapsed milliseconds
 * @returns Promise
 */
export async function time<T>(
  fn: () => Promise<T>,
  onFinish: (elapsedMs: number) => void
): Promise<T> {
  const watch = stopwatch();
  try {
    return await fn();
  } finally {
    onFinish(watch.getElapsed());
  }
}

/**
 * Set an execution time limit for a promise.
 * @param promise - The promise being capped to `timeoutMs` max execution time
 * @param timeoutMs - Timeout limit in milliseconds
 * @param wait - If we should wait another `timeoutMs` period for `promise` to resolve
 * @param waitHandler - If `wait` is `true`, this closure will be executed before waiting another
 * `timeoutMs` cycle
 * @returns `true` if `promise` ended gracefully, `false` if timeout was reached
 */
export async function resolveOrTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  wait: boolean = false,
  waitHandler?: () => void
) {
  let timer: NodeJS.Timeout;
  const result = await Promise.race([
    new Promise((resolve, reject) => {
      promise
        .then(() => resolve(true))
        .catch(error => reject(error))
        .finally(() => clearTimeout(timer));
    }),
    new Promise((resolve, _) => {
      timer = setInterval(() => {
        if (!wait) {
          clearTimeout(timer);
          resolve(false);
          return;
        }
        if (waitHandler) {
          waitHandler();
        }
      }, timeoutMs);
    }),
  ]);
  return result;
}

export interface Stopwatch {
  /** Milliseconds since stopwatch was created. */
  getElapsed: () => number;
  /** Seconds since stopwatch was created. */
  getElapsedSeconds: () => number;
  getElapsedAndRestart: () => number;
  restart(): void;
}

/**
 * Start a `Stopwatch` that measures elapsed time based on `process.hrtime`.
 * @returns Stopwatch
 */
export function stopwatch(): Stopwatch {
  let start = process.hrtime.bigint();
  const result: Stopwatch = {
    getElapsedSeconds: () => {
      const elapsedMs = result.getElapsed();
      return elapsedMs / 1000;
    },
    getElapsed: () => {
      const end = process.hrtime.bigint();
      return Number((end - start) / 1_000_000n);
    },
    getElapsedAndRestart: () => {
      const end = process.hrtime.bigint();
      const result = Number((end - start) / 1_000_000n);
      start = process.hrtime.bigint();
      return result;
    },
    restart: () => {
      start = process.hrtime.bigint();
    },
  };
  return result;
}

export type Waiter<T = void, E = Error> = Promise<T> & {
  /** Alias for `resolve` */
  finish: (result: T) => void;
  resolve: (result: T) => void;
  reject: (error: E) => void;
  /** True if the promise is resolved or rejected */
  isFinished: boolean;
  /** True only if the promise is resolved */
  isResolved: boolean;
  /** True only if the promise is rejected */
  isRejected: boolean;
};

/**
 * Creates a `Waiter` promise that can be resolved or rejected at a later time.
 * @returns Waiter
 */
export function waiter<T = void, E = Error>(): Waiter<T, E> {
  let resolveFn: (result: T) => void;
  let rejectFn: (error: E) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const completer = {
    finish: (result: T) => completer.resolve(result),
    resolve: (result: T) => {
      void Object.assign(promise, { isFinished: true, isResolved: true });
      resolveFn(result);
    },
    reject: (error: E) => {
      void Object.assign(promise, { isFinished: true, isRejected: true });
      rejectFn(error);
    },
    isFinished: false,
    isResolved: false,
    isRejected: false,
  };
  return Object.assign(promise, completer);
}
