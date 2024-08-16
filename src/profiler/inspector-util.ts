import * as inspector from 'inspector';
import * as stream from 'stream';
import { stopwatch, Stopwatch } from '../helpers';
import { logger } from '../logger';

export type CpuProfileResult = inspector.Profiler.Profile;

export interface ProfilerInstance<TStopResult = void> {
  start: () => Promise<void>;
  stop: () => Promise<TStopResult>;
  dispose: () => Promise<void>;
  session: inspector.Session;
  sessionType: 'cpu' | 'memory';
  stopwatch: Stopwatch;
}

function isInspectorNotConnectedError(error: unknown): boolean {
  const ERR_INSPECTOR_NOT_CONNECTED = 'ERR_INSPECTOR_NOT_CONNECTED';
  const isNodeError = (r: unknown): r is NodeJS.ErrnoException => r instanceof Error && 'code' in r;
  return isNodeError(error) && error.code === ERR_INSPECTOR_NOT_CONNECTED;
}

/**
 * Connects and enables a new `inspector` session, then starts an internal v8 CPU profiling process.
 * @returns A function to stop the profiling, and return the CPU profile result object.
 * The result object can be used to create a `.cpuprofile` file using JSON.stringify.
 * Use VSCode or Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.cpuprofile` file.
 * @param samplingInterval - Optionally set sampling interval in microseconds, default is 1000 microseconds.
 */
export function initCpuProfiling(samplingInterval?: number): ProfilerInstance<CpuProfileResult> {
  const sessionStopwatch = stopwatch();
  const session = new inspector.Session();
  session.connect();
  logger.info(`[CpuProfiler] Connect session took ${sessionStopwatch.getElapsedAndRestart()}ms`);
  const start = async () => {
    const sw = stopwatch();
    logger.info(`[CpuProfiler] Enabling profiling...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('Profiler.enable', error => {
          if (error) {
            logger.error(error, '[CpuProfiler] Error enabling profiling');
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling enabled`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[CpuProfiler] Error enabling profiling');
        reject(error);
      }
    });
    logger.info(`[CpuProfiler] Enable session took ${sw.getElapsedAndRestart()}ms`);

    if (samplingInterval !== undefined) {
      logger.info(`[CpuProfiler] Setting sampling interval to ${samplingInterval} microseconds`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('Profiler.setSamplingInterval', { interval: samplingInterval }, error => {
            if (error) {
              logger.error(error, '[CpuProfiler] Error setting sampling interval');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Set sampling interval`);
              resolve();
            }
          });
        } catch (error) {
          logger.error(error, '[CpuProfiler] Error setting sampling interval');
          reject(error);
        }
      });
      logger.info(`[CpuProfiler] Set sampling interval took ${sw.getElapsedAndRestart()}ms`);
    }

    logger.info(`[CpuProfiler] Profiling starting...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('Profiler.start', error => {
          if (error) {
            logger.error(error, '[CpuProfiler] Error starting profiling');
            reject(error);
          } else {
            sessionStopwatch.restart();
            logger.info(`[CpuProfiler] Profiling started`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[CpuProfiler] Error starting profiling');
        reject(error);
      }
    });
    logger.info(`[CpuProfiler] Start profiler took ${sw.getElapsedAndRestart()}ms`);
  };

  const stop = async () => {
    const sw = stopwatch();
    logger.info(`[CpuProfiler] Profiling stopping...`);
    try {
      return await new Promise<CpuProfileResult>((resolve, reject) => {
        try {
          session.post('Profiler.stop', (error, profileResult) => {
            if (error) {
              logger.error(error, '[CpuProfiler] Error stopping profiling');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Profiling stopped`);
              resolve(profileResult.profile);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    } finally {
      logger.info(`[CpuProfiler] Stop profiler took ${sw.getElapsedAndRestart()}ms`);
    }
  };

  const dispose = async () => {
    const sw = stopwatch();
    try {
      logger.info(`[CpuProfiler] Disabling profiling...`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('Profiler.disable', error => {
            if (error && isInspectorNotConnectedError(error)) {
              logger.info(`[CpuProfiler] Profiler already disconnected`);
              resolve();
            } else if (error) {
              logger.error(error, '[CpuProfiler] Error disabling profiling');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Profiling disabled`);
              resolve();
            }
          });
        } catch (error) {
          if (isInspectorNotConnectedError(error)) {
            logger.info(`[CpuProfiler] Profiler already disconnected`);
            resolve();
          } else {
            reject();
          }
        }
      });
    } finally {
      session.disconnect();
      logger.info(
        `[CpuProfiler] Disable and disconnect profiler took ${sw.getElapsedAndRestart()}ms`
      );
    }
  };

  return { start, stop, dispose, session, sessionType: 'cpu', stopwatch: sessionStopwatch };
}

/**
 * Connects and enables a new `inspector` session, then creates an internal v8 Heap profiler snapshot.
 * @param outputStream - An output stream that heap snapshot chunks are written to.
 * The result stream can be used to create a `.heapsnapshot` file.
 * Use Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.heapsnapshot` file.
 */
export function initHeapSnapshot(
  outputStream: stream.Writable
): ProfilerInstance<{ totalSnapshotByteSize: number }> {
  const sw = stopwatch();
  const session = new inspector.Session();
  session.connect();
  let totalSnapshotByteSize = 0;
  const start = async () => {
    logger.info(`[HeapProfiler] Enabling profiling...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('HeapProfiler.enable', error => {
          if (error) {
            logger.error(error, '[HeapProfiler] Error enabling profiling');
            reject(error);
          } else {
            sw.restart();
            logger.info(`[HeapProfiler] Profiling enabled`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[HeapProfiler] Error enabling profiling');
        reject(error);
      }
    });

    session.on('HeapProfiler.addHeapSnapshotChunk', message => {
      // Note: this doesn't handle stream back-pressure, but we don't have control over the
      // `HeapProfiler.addHeapSnapshotChunk` callback in order to use something like piping.
      // So in theory on a slow `outputStream` (usually an http connection response) this can cause OOM.
      logger.info(
        `[HeapProfiler] Writing heap snapshot chunk of size ${message.params.chunk.length}`
      );
      totalSnapshotByteSize += message.params.chunk.length;
      outputStream.write(message.params.chunk, error => {
        if (error) {
          logger.error(
            error,
            `[HeapProfiler] Error writing heap profile chunk to output stream: ${error.message}`
          );
        }
      });
    });
  };

  const stop = async () => {
    logger.info(`[HeapProfiler] Taking snapshot...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('HeapProfiler.takeHeapSnapshot', undefined, (error: Error | null) => {
          if (error) {
            logger.error(error, '[HeapProfiler] Error taking snapshot');
            reject(error);
          } else {
            logger.info(
              `[HeapProfiler] Taking snapshot completed, ${totalSnapshotByteSize} bytes...`
            );
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[HeapProfiler] Error taking snapshot');
        reject(error);
      }
    });
    logger.info(`[HeapProfiler] Draining snapshot buffer to stream...`);
    const writeFinishedPromise = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', () => resolve());
      outputStream.on('error', error => reject(error));
    });
    outputStream.end();
    await writeFinishedPromise;
    logger.info(`[HeapProfiler] Finished draining snapshot buffer to stream`);
    return { totalSnapshotByteSize };
  };

  const dispose = async () => {
    try {
      logger.info(`[HeapProfiler] Disabling profiling...`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('HeapProfiler.disable', error => {
            if (error && isInspectorNotConnectedError(error)) {
              logger.info(`[HeapProfiler] Profiler already disconnected`);
              resolve();
            } else if (error) {
              logger.error(error, '[HeapProfiler] Error disabling profiling');
              reject(error);
            } else {
              logger.info(`[HeapProfiler] Profiling disabled`);
              resolve();
            }
          });
        } catch (error) {
          if (isInspectorNotConnectedError(error)) {
            logger.info(`[HeapProfiler] Profiler already disconnected`);
            resolve();
          } else {
            reject();
          }
        }
      });
    } finally {
      session.disconnect();
    }
  };

  return { start, stop, dispose, session, sessionType: 'memory', stopwatch: sw };
}
