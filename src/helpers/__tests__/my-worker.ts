/** Block the thread for `ms` milliseconds */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function processTask(req: number, cpuWaitTimeMs: number) {
  if (req === 2222) {
    throw createError();
  }
  if (req === 3333) {
    throw 'boom';
  }
  if (req == 4444) {
    throw createAggregateError();
  }
  sleepSync(cpuWaitTimeMs);
  return req.toString();
}

export class MyCustomError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

function createError() {
  const error = new MyCustomError(`Error at req`);
  Object.assign(error, { code: 123 });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (error as any).randoProp = {
    foo: 'bar',
    baz: 123,
    aggregate: [
      Object.assign(new Error('Error in aggregate 1'), { inner1code: 123 }),
      new MyCustomError('Error in aggregate 2'),
    ],
    sourceError: Object.assign(new MyCustomError('Source error'), {
      sourceErrorInfo: { code: 44 },
    }),
  };
  return error;
}

function createAggregateError() {
  const error1 = new Error('Error1 in aggregate 1');
  Object.assign(error1, { inner1code: 123 });
  const error2 = new TypeError('Error2 in aggregate 2');
  return new AggregateError([error1, error2], 'My aggregate error message', { cause: 'foo' });
}

export const workerModule = module;
