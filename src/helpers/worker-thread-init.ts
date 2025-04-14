import * as WorkerThreads from 'node:worker_threads';
import type {
  WorkerDataInterface,
  WorkerPoolModuleInterface,
  WorkerReqMsg,
  WorkerRespMsg,
} from './worker-thread-manager';
import { isErrorLike, serializeError } from './serialize-error';

// Minimal worker thread initialization code. This file is the entry point for worker threads
// and is responsible for setting up the worker environment and handling messages from the main thread.
// Imports should be kept to a minimum to avoid in worker thread init overhead and memory usage.

export const filename = __filename;

/**
 * Invokes a function that may return a value or a promise, and passes the result
 * to a callback in a consistent format. Handles both synchronous and asynchronous cases,
 * ensuring type safety and avoiding unnecessary async transitions for sync functions.
 */
function getMaybePromiseResult<T>(
  fn: () => T | Promise<T>,
  cb: (result: { ok: T; err?: null } | { ok?: null; err: unknown }) => void
): void {
  try {
    const maybePromise = fn();
    if (maybePromise instanceof Promise) {
      maybePromise.then(
        ok => cb({ ok }),
        (err: unknown) => cb({ err })
      );
    } else {
      cb({ ok: maybePromise });
    }
  } catch (err: unknown) {
    cb({ err });
  }
}

// Check if this file is being run in a worker thread. If so, it will set up the worker environment.
if (!WorkerThreads.isMainThread && (WorkerThreads.workerData as WorkerDataInterface)?.workerFile) {
  const { workerFile } = WorkerThreads.workerData as WorkerDataInterface;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const workerModule = require(workerFile) as WorkerPoolModuleInterface<unknown[], unknown>;
  const parentPort = WorkerThreads.parentPort as WorkerThreads.MessagePort;
  // Determine if the worker module `processTask` function is a default export or a named export.
  const processTask =
    'default' in workerModule ? workerModule.default.processTask : workerModule.processTask;
  parentPort.on('messageerror', err => {
    console.error(`Worker thread message error`, err);
  });
  parentPort.on('message', (message: unknown) => {
    const msg = message as WorkerReqMsg<unknown[]>;
    getMaybePromiseResult(
      () => processTask(...msg.req),
      result => {
        try {
          let reply: WorkerRespMsg<unknown, unknown>;
          if (result.ok) {
            reply = {
              msgId: msg.msgId,
              resp: result.ok,
            };
          } else {
            const error = isErrorLike(result.err) ? serializeError(result.err) : result.err;
            reply = {
              msgId: msg.msgId,
              error,
            };
          }
          parentPort.postMessage(reply);
        } catch (err: unknown) {
          console.error(`Critical bug in work task processing`, err);
        }
      }
    );
  });
  parentPort.postMessage('ready');
}
