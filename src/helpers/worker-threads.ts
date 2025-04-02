/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { isMainThread, parentPort, workerData, Worker, WorkerOptions } from 'node:worker_threads';
import { cpus } from 'node:os';
import { EventEmitter } from 'node:events';
import { deserializeError, SerializedError, serializeError } from './serialize-error';
import { waiter, Waiter } from './time';

type WorkerPoolModuleInterface<TReq, TResp> =
  | {
      workerModule: NodeJS.Module;
      processTask: (req: TReq) => Promise<TResp> | TResp;
    }
  | {
      default: {
        workerModule: NodeJS.Module;
        processTask: (req: TReq) => Promise<TResp> | TResp;
      };
    };

type WorkerDataInterface = {
  workerFile: string;
};

type WorkerReqMsg<TReq> = {
  msgId: number;
  req: TReq;
};

type WorkerRespMsg<TResp, TErr = SerializedError> = {
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

export class WorkerManager<TReq, TResp> {
  private readonly workers = new Set<Worker>();
  private readonly idleWorkers: Worker[] = [];

  private readonly jobQueue: WorkerReqMsg<TReq>[] = [];
  private readonly msgRequests: Map<number, Waiter<TResp>> = new Map();
  private lastMsgId = 0;

  private readonly workerCount: number;
  private readonly workerFile: string;

  private readonly events = new EventEmitter<{
    workersReady: [];
  }>();

  public static init<TReq, TResp>(
    workerModule: WorkerPoolModuleInterface<TReq, TResp>,
    opts: { workerCount?: number } = {}
  ) {
    const workerManager = new WorkerManager(workerModule, opts);
    return new Promise<WorkerManager<TReq, TResp>>(resolve => {
      workerManager.events.once('workersReady', () => {
        resolve(workerManager);
      });
    });
  }

  constructor(
    workerModule: WorkerPoolModuleInterface<TReq, TResp>,
    opts: { workerCount?: number } = {}
  ) {
    if (!isMainThread) {
      throw new Error(`${this.constructor.name} must be instantiated in the main thread`);
    }

    if ('default' in workerModule) {
      this.workerFile = workerModule.default.workerModule.filename;
    } else {
      this.workerFile = workerModule.workerModule.filename;
    }
    this.workerCount = opts.workerCount ?? cpus().length;
    this.createWorkerPool();
  }

  exec(req: TReq): Promise<TResp> {
    if (this.lastMsgId >= Number.MAX_SAFE_INTEGER) {
      this.lastMsgId = 0;
    }
    const msgId = this.lastMsgId++;
    const replyWaiter = waiter<TResp>();
    this.msgRequests.set(msgId, replyWaiter);
    const reqMsg: WorkerReqMsg<TReq> = {
      msgId,
      req,
    };
    this.jobQueue.push(reqMsg);
    this.assignJobs();
    return replyWaiter;
  }

  private createWorkerPool() {
    let workersReady = 0;
    for (let i = 0; i < this.workerCount; i++) {
      const workerData: WorkerDataInterface = {
        workerFile: this.workerFile,
      };
      const workerOpt: WorkerOptions = {
        workerData,
      };
      if (__filename.endsWith('.ts')) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(
            'Worker threads are being created with ts-node outside of a test environment.'
          );
        }
        workerOpt.execArgv = ['-r', 'ts-node/register'];
      }
      const worker = new Worker(__filename, workerOpt);
      worker.unref();
      this.workers.add(worker);
      worker.on('error', err => {
        console.error(`Worker error`, err);
      });
      worker.on('messageerror', err => {
        console.error(`Worker message error`, err);
      });
      worker.on('message', (message: unknown) => {
        if (message === 'ready') {
          this.idleWorkers.push(worker);
          this.assignJobs();
          workersReady++;
          if (workersReady === this.workerCount) {
            this.events.emit('workersReady');
          }
        } else {
          this.idleWorkers.push(worker);
          this.assignJobs();
          const msg = message as WorkerRespMsg<TResp>;
          const replyWaiter = this.msgRequests.get(msg.msgId);
          if (replyWaiter) {
            if (msg.error) {
              replyWaiter.reject(deserializeError(msg.error));
            } else if (msg.resp) {
              replyWaiter.resolve(msg.resp);
            }
            this.msgRequests.delete(msg.msgId);
          } else {
            console.error('Received unexpected message from worker', msg);
          }
        }
      });
    }
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

if (!isMainThread && (workerData as WorkerDataInterface)?.workerFile) {
  const { workerFile } = workerData as WorkerDataInterface;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const workerModule = require(workerFile) as WorkerPoolModuleInterface<unknown, unknown>;
  let processTask: (req: unknown) => unknown;
  if ('default' in workerModule) {
    processTask = workerModule.default.processTask;
  } else {
    processTask = workerModule.processTask;
  }
  parentPort!.on('messageerror', err => {
    console.error(`Worker thread message error`, err);
  });
  parentPort!.on('message', (message: unknown) => {
    const msg = message as WorkerReqMsg<unknown>;
    getMaybePromiseResult(
      () => processTask(msg.req),
      result => {
        if (result.ok) {
          const reply: WorkerRespMsg<unknown> = {
            msgId: msg.msgId,
            resp: result.ok,
          };
          parentPort!.postMessage(reply);
        } else {
          const reply: WorkerRespMsg<unknown> = {
            msgId: msg.msgId,
            error: serializeError(result.err as Error),
          };
          parentPort!.postMessage(reply);
        }
      }
    );
  });
  parentPort!.postMessage('ready');
}
