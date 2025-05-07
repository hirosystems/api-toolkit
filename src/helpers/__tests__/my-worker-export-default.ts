import * as myWorker from './my-worker';
export default {
  workerModule: myWorker.workerModule,
  processTask: myWorker.processTask,
};
