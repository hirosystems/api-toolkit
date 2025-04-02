import { MyCustomError } from './my-worker-errors';

function processTask(req: number) {
  if (req === 555) {
    const error = new MyCustomError(`Error at req`);
    Object.assign(error, { code: 123, deep: { foo: 'bar', baz: 123 } });
    throw error;
  }
  return req.toString();
}

export default {
  workerModule: module,
  processTask,
};
