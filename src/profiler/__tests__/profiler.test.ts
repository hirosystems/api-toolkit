import { FastifyInstance } from 'fastify';
import { buildProfilerServer } from '../server';
import { timeout } from '../../helpers';

describe('CPU profiler', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = await buildProfilerServer();
  });

  test('CPU profiler snapshot bad duration', async () => {
    const query1 = await fastify.inject({
      method: 'GET',
      url: `/profile/cpu?duration=-100`,
    });
    expect(query1.statusCode).toBe(400);
  });

  test('generate CPU profiler snapshot', async () => {
    const duration = 0.25; // 250 milliseconds
    const query1 = await fastify.inject({
      method: 'GET',
      url: `/profile/cpu?duration=${duration}`,
    });
    expect(query1.statusCode).toBe(200);
    expect(query1.headers['content-type']).toBe('application/json; charset=utf-8');
    let cpuProfileBody: any;
    // Ensure entire profile result was streamed/returned
    expect(() => {
      cpuProfileBody = query1.json();
    }).not.toThrow();
    // Cursory check for the expected JSON format of a `.cpuprofile` file
    expect(cpuProfileBody).toEqual(
      expect.objectContaining({
        nodes: expect.any(Array),
        samples: expect.any(Array),
        timeDeltas: expect.any(Array),
        startTime: expect.any(Number),
        endTime: expect.any(Number),
      })
    );
  });

  test('cancel CPU profiler snapshot', async () => {
    const duration = 150; // 150 seconds
    // init a cpu profile request, hold on to the promise for reading the request response
    const promise = fastify.inject({
      method: 'GET',
      url: `/profile/cpu?duration=${duration}`,
    });
    await timeout(200);
    // perform a request to cancel the previous profile session
    const endQuery = await fastify.inject({
      method: 'GET',
      url: `/profile/cancel`,
    });
    expect(endQuery.statusCode).toBe(200);
    // ensure the initial request failed
    const result = await promise;
    expect(result.statusCode).toBe(500);
  });

  afterAll(async () => {
    await fastify.close();
  });
});
