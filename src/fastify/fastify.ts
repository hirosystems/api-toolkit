import FastifyCors from '@fastify/cors';
import Fastify, { FastifyInstance } from 'fastify';
import FastifyMetrics, { IFastifyMetrics } from 'fastify-metrics';
import { PINO_LOGGER_CONFIG } from '../logger';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { isProdEnv } from '../helpers/values';

/**
 * Creates a Fastify server that handles Prometheus metrics and CORS headers automatically.
 * @returns Fastify instance
 */
export async function buildFastifyApiServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
  }).withTypeProvider<TypeBoxTypeProvider>();
  if (isProdEnv) {
    await fastify.register(FastifyMetrics, { endpoint: null });
  }
  await fastify.register(FastifyCors);
  return fastify;
}

/**
 * Creates a Fastify server that serves a `/metrics` endpoint with metrics taken from
 * `FastifyMetrics`.
 * @param args - Fastify instance metrics decorator
 * @returns Fastify instance
 */
export async function buildPrometheusServer(args: {
  metrics: IFastifyMetrics;
}): Promise<FastifyInstance> {
  const promServer = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
  });
  promServer.route({
    url: '/metrics',
    method: 'GET',
    logLevel: 'info',
    handler: async (_, reply) => {
      await reply.type('text/plain').send(await args.metrics.client.register.metrics());
    },
  });
  return promServer;
}
