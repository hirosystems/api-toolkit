import * as inspector from 'inspector';
import { once } from 'events';
import { Server } from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { startProfiler, stopProfiler } from 'stacks-encoding-native-js';
import { pipelineAsync, timeout } from '../helpers';
import { logger, PINO_LOGGER_CONFIG } from '../logger';
import Fastify, { FastifyInstance, FastifyPluginCallback, FastifyReply } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { initCpuProfiling, initHeapSnapshot, ProfilerInstance } from './inspector-util';

const DurationSchema = Type.Number({ minimum: 0 });
const SamplingIntervalSchema = Type.Optional(Type.Number({ minimum: 0 }));

const CpuProfiler: FastifyPluginCallback<Record<never, never>, Server, TypeBoxTypeProvider> = (
  fastify,
  options,
  done
) => {
  let existingSession: { instance: ProfilerInstance<unknown>; response: FastifyReply } | undefined;

  fastify.get(
    '/profile/cpu',
    {
      schema: {
        querystring: Type.Object({
          duration: DurationSchema,
          sampling_interval: SamplingIntervalSchema,
        }),
      },
    },
    async (req, res) => {
      if (existingSession) {
        await res.status(409).send({ error: 'Profile session already in progress' });
        return;
      }
      const seconds = req.query.duration;
      const samplingInterval = req.query.sampling_interval;
      const cpuProfiler = initCpuProfiling(samplingInterval);
      existingSession = { instance: cpuProfiler, response: res };
      try {
        const filename = `cpu_${Math.round(Date.now() / 1000)}_${seconds}-seconds.cpuprofile`;
        await cpuProfiler.start();
        const ac = new AbortController();
        const timeoutPromise = timeout(seconds * 1000, ac);
        await Promise.race([timeoutPromise, once(res.raw, 'close')]);
        if (res.raw.writableEnded || res.raw.destroyed) {
          // session was cancelled
          ac.abort();
          return;
        }
        const result = await cpuProfiler.stop();
        const resultString = JSON.stringify(result);
        logger.info(
          `[CpuProfiler] Completed, total profile report JSON string length: ${resultString.length}`
        );
        await res
          .headers({
            'Cache-Control': 'no-store',
            'Transfer-Encoding': 'chunked',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': 'application/json; charset=utf-8',
          })
          .send(resultString);
      } finally {
        const session = existingSession;
        existingSession = undefined;
        await session?.instance.dispose().catch();
      }
    }
  );

  let neonProfilerRunning: boolean = false;

  fastify.get(
    '/profile/cpu/start',
    {
      schema: {
        querystring: Type.Object({
          sampling_interval: SamplingIntervalSchema,
        }),
      },
    },
    async (req, res) => {
      if (existingSession) {
        await res.status(409).send({ error: 'Profile session already in progress' });
        return;
      }
      const samplingInterval = req.query.sampling_interval;
      const cpuProfiler = initCpuProfiling(samplingInterval);
      existingSession = { instance: cpuProfiler, response: res };
      await cpuProfiler.start();
      const profilerRunningLogger = setInterval(() => {
        if (existingSession) {
          logger.error(`CPU profiler has been enabled for a long time`);
        } else {
          clearInterval(profilerRunningLogger);
        }
      }, 10_000).unref();
      await res.send('CPU profiler started');
    }
  );

  fastify.get('/profile/native/cpu/start', async (req, res) => {
    if (neonProfilerRunning) {
      await res.status(500).send('error: profiler already started');
      return;
    }
    neonProfilerRunning = true;
    try {
      const startResponse = startProfiler();
      logger.info(startResponse);
      await res.send(startResponse);
    } catch (error) {
      logger.error(error);
      await res.status(500).send(error);
    }
  });

  fastify.get('/profile/native/cpu/stop', async (req, res) => {
    if (!neonProfilerRunning) {
      await res.status(500).send('error: no profiler running');
      return;
    }
    neonProfilerRunning = false;
    let profilerResults: Buffer;
    try {
      profilerResults = stopProfiler();
    } catch (error: any) {
      logger.error(error);
      await res.status(500).send(error);
      return;
    }
    const fileName = `profile-${Date.now()}.svg`;
    await res
      .status(200)
      .headers({
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': 'image/svg+xml',
      })
      .send(profilerResults);
  });

  fastify.get('/profile/cpu/stop', async (req, res) => {
    if (!existingSession) {
      await res.status(409).send({ error: 'No profile session in progress' });
      return;
    }
    if (existingSession.instance.sessionType !== 'cpu') {
      await res.status(409).send({ error: 'No CPU profile session in progress' });
      return;
    }
    try {
      const elapsedSeconds = existingSession.instance.stopwatch.getElapsedSeconds();
      const timestampSeconds = Math.round(Date.now() / 1000);
      const filename = `cpu_${timestampSeconds}_${elapsedSeconds}-seconds.cpuprofile`;
      const result = await (
        existingSession.instance as ProfilerInstance<inspector.Profiler.Profile>
      ).stop();
      const resultString = JSON.stringify(result);
      logger.info(
        `[CpuProfiler] Completed, total profile report JSON string length: ${resultString.length}`
      );
      await res
        .headers({
          'Cache-Control': 'no-store',
          'Transfer-Encoding': 'chunked',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/json; charset=utf-8',
        })
        .send(resultString);
    } finally {
      const session = existingSession;
      existingSession = undefined;
      await session?.instance.dispose().catch();
    }
  });

  fastify.get('/profile/heap_snapshot', async (req, res) => {
    if (existingSession) {
      await res.status(409).send({ error: 'Profile session already in progress' });
      return;
    }
    const filename = `heap_${Math.round(Date.now() / 1000)}.heapsnapshot`;
    const tmpFile = path.join(os.tmpdir(), filename);
    const fileWriteStream = fs.createWriteStream(tmpFile);
    const heapProfiler = initHeapSnapshot(fileWriteStream);
    existingSession = { instance: heapProfiler, response: res };
    try {
      // Taking a heap snapshot (with current implementation) is a one-shot process ran to get the
      // applications current heap memory usage, rather than something done over time. So start and
      // stop without waiting.
      await heapProfiler.start();
      const result = await heapProfiler.stop();
      logger.info(
        `[HeapProfiler] Completed, total snapshot byte size: ${result.totalSnapshotByteSize}`
      );
      await res.headers({
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/json; charset=utf-8',
      });
      await pipelineAsync(fs.createReadStream(tmpFile), res.raw);
    } finally {
      const session = existingSession;
      existingSession = undefined;
      await session?.instance.dispose().catch();
      try {
        fileWriteStream.destroy();
      } catch (_) {}
      try {
        logger.info(`[HeapProfiler] Cleaning up tmp file ${tmpFile}`);
        fs.unlinkSync(tmpFile);
      } catch (_) {}
    }
  });

  fastify.get('/profile/cancel', async (req, res) => {
    if (!existingSession) {
      await res.status(409).send({ error: 'No existing profile session is exists to cancel' });
      return;
    }
    const session = existingSession;
    await session.instance.stop().catch();
    await session.instance.dispose().catch();
    await session.response.status(500).send('cancelled');
    existingSession = undefined;
    await Promise.resolve();
    await res.send({ ok: 'existing profile session stopped' });
  });

  done();
};

/**
 * Creates a Fastify server that controls a CPU profiler.
 * @returns Fastify instance
 */
export async function buildProfilerServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
  }).withTypeProvider<TypeBoxTypeProvider>();
  await fastify.register(CpuProfiler);
  return fastify;
}
