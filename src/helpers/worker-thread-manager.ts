import * as WorkerThreads from 'node:worker_threads';
import * as os from 'node:os';
import { EventEmitter, addAbortListener } from 'node:events';
import { waiter, Waiter } from './time';
import { deserializeError, isErrorLike } from './serialize-error';
import { filename as workerThreadInitFilename } from './worker-thread-init';

export type WorkerDataInterface = {
  workerFile: string;
};

export type WorkerReqMsg<TArgs extends unknown[]> = {
  msgId: number;
  req: TArgs;
};

export type WorkerRespMsg<TResp, TErr> = {
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

export type WorkerPoolModuleInterface<TArgs extends unknown[], TResp> =
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

export class WorkerThreadManager<TArgs extends unknown[], TResp> {
  private readonly workers = new Set<WorkerThreads.Worker>();
  private readonly idleWorkers: WorkerThreads.Worker[] = [];

  private readonly jobQueue: WorkerReqMsg<TArgs>[] = [];
  private readonly msgRequests: Map<number, Waiter<TResp>> = new Map();
  private lastMsgId = 0;

  readonly workerCount: number;
  readonly workerFile: string;

  private readonly abortControlller = new AbortController();

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
    const workerManager = new WorkerThreadManager(workerModule, opts);
    return new Promise<WorkerThreadManager<TArgs, TResp>>(resolve => {
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
    this.abortControlller.signal.throwIfAborted();
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
      const hasTsSource =
        workerThreadInitFilename.endsWith('.ts') || this.workerFile.endsWith('.ts');
      if (hasTsSource) {
        if (process.env.NODE_ENV !== 'test') {
          throw new Error(
            'Worker threads are being created with ts-node outside of a test environment'
          );
        }
        workerOpt.execArgv = ['-r', 'ts-node/register/transpile-only'];
      }
      const worker = new WorkerThreads.Worker(workerThreadInitFilename, workerOpt);
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
    addAbortListener(this.abortControlller.signal, () => {
      for (const replyWaiter of this.msgRequests.values()) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        replyWaiter.reject(this.abortControlller.signal.reason);
      }
      this.msgRequests.clear();
    });
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
    this.abortControlller.abort();
    await Promise.all([...this.workers].map(worker => worker.terminate()));
    this.workers.clear();
  }
}
