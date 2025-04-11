import * as WorkerThreads from 'node:worker_threads';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { waiter, Waiter } from './time';
import { deserializeError, isErrorLike, serializeError } from './serialize-error';

type WorkerPoolModuleInterface<TArgs extends unknown[], TResp> =
  | {
      workerModule: NodeJS.Module;
      processTask: (...args: TArgs) => Promise<TResp> | TResp;
    }
  | {
      default: {
        workerModule: NodeJS.Module;
        processTask: (...args: TArgs) => Promise<TResp> | TResp;
      };
    };

type WorkerDataInterface = {
  workerFile: string;
};

type WorkerReqMsg<TArgs extends unknown[]> = {
  msgId: number;
  req: TArgs;
};

type WorkerRespMsg<TResp, TErr> = {
  msgId: number;
} & (
  | {
      resp: TResp;
      error?: null;
    }
  | {
      resp?: null;
      error: TErr;
    }
);

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
export class WorkerManager<TArgs extends unknown[], TResp> {
  private readonly workers = new Set<WorkerThreads.Worker>();
  private readonly idleWorkers: WorkerThreads.Worker[] = [];

  private readonly jobQueue: WorkerReqMsg<TArgs>[] = [];
  private readonly msgRequests: Map<number, Waiter<TResp>> = new Map();
  private lastMsgId = 0;

  readonly workerCount: number;
  readonly workerFile: string;

  readonly events = new EventEmitter<{
    workersReady: [];
  }>();

  get idleWorkerCount() {
    return this.idleWorkers.length;
  }

  get busyWorkerCount() {
    return this.workerCount - this.idleWorkers.length;
  }

  get queuedJobCount() {
    return this.jobQueue.length;
  }

  public static init<TArgs extends unknown[], TResp>(
    workerModule: WorkerPoolModuleInterface<TArgs, TResp>,
    opts: { workerCount?: number } = {}
  ) {
    const workerManager = new WorkerManager(workerModule, opts);
    return new Promise<WorkerManager<TArgs, TResp>>(resolve => {
      workerManager.events.once('workersReady', () => {
        resolve(workerManager);
      });
    });
  }

  constructor(
    workerModule: WorkerPoolModuleInterface<TArgs, TResp>,
    opts: { workerCount?: number } = {}
  ) {
    if (!WorkerThreads.isMainThread) {
      throw new Error(`${this.constructor.name} must be instantiated in the main thread`);
    }

    if ('default' in workerModule) {
      this.workerFile = workerModule.default.workerModule.filename;
    } else {
      this.workerFile = workerModule.workerModule.filename;
    }
    this.workerCount = opts.workerCount ?? os.cpus().length;
    this.createWorkerPool();
  }

  exec(...args: TArgs): Promise<TResp> {
    if (this.lastMsgId >= Number.MAX_SAFE_INTEGER) {
      this.lastMsgId = 0;
    }
    const msgId = this.lastMsgId++;
    const replyWaiter = waiter<TResp>();
    this.msgRequests.set(msgId, replyWaiter);
    const reqMsg: WorkerReqMsg<TArgs> = {
      msgId,
      req: args,
    };
    this.jobQueue.push(reqMsg);
    this.assignJobs();
    return replyWaiter;
  }

  createWorkerPool() {
    let workersReady = 0;
    for (let i = 0; i < this.workerCount; i++) {
      const workerData: WorkerDataInterface = {
        workerFile: this.workerFile,
      };
      const workerOpt: WorkerThreads.WorkerOptions = {
        workerData,
      };
      if (path.extname(__filename) === '.ts') {
        if (process.env.NODE_ENV !== 'test') {
          throw new Error(
            'Worker threads are being created with ts-node outside of a test environment'
          );
        }
        workerOpt.execArgv = ['-r', 'ts-node/register/transpile-only'];
      }
      const worker = new WorkerThreads.Worker(__filename, workerOpt);
      worker.unref();
      this.workers.add(worker);
      worker.on('error', err => {
        console.error(`Worker error`, err);
      });
      worker.on('messageerror', err => {
        console.error(`Worker message error`, err);
      });
      worker.once('message', (message: unknown) => {
        if (message !== 'ready') {
          throw new Error(`Unexpected first msg from worker thread: ${JSON.stringify(message)}`);
        }
        this.setupWorkerHandler(worker);
        this.idleWorkers.push(worker);
        this.assignJobs();
        workersReady++;
        if (workersReady === this.workerCount) {
          this.events.emit('workersReady');
        }
      });
    }
  }

  private setupWorkerHandler(worker: WorkerThreads.Worker) {
    worker.on('message', (message: unknown) => {
      this.idleWorkers.push(worker);
      this.assignJobs();
      const msg = message as WorkerRespMsg<TResp, unknown>;
      const replyWaiter = this.msgRequests.get(msg.msgId);
      if (replyWaiter) {
        if (msg.error) {
          const error = isErrorLike(msg.error) ? deserializeError(msg.error) : msg.error;
          replyWaiter.reject(error as Error);
        } else if (msg.resp) {
          replyWaiter.resolve(msg.resp);
        }
        this.msgRequests.delete(msg.msgId);
      } else {
        console.error('Received unexpected message from worker', msg);
      }
    });
  }

  private assignJobs() {
    while (this.idleWorkers.length > 0 && this.jobQueue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const worker = this.idleWorkers.shift()!;
      const job = this.jobQueue.shift();
      worker.postMessage(job);
    }
  }

  async close() {
    await Promise.all([...this.workers].map(worker => worker.terminate()));
    this.workers.clear();
  }
}

if (!WorkerThreads.isMainThread && (WorkerThreads.workerData as WorkerDataInterface)?.workerFile) {
  const { workerFile } = WorkerThreads.workerData as WorkerDataInterface;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const workerModule = require(workerFile) as WorkerPoolModuleInterface<unknown[], unknown>;
  const parentPort = WorkerThreads.parentPort as WorkerThreads.MessagePort;
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
