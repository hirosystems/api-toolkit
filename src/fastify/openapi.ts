import Fastify, { FastifyPluginAsync, FastifyPluginCallback } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { SwaggerOptions } from '@fastify/swagger';
import FastifySwagger from '@fastify/swagger';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

export interface OpenApiGeneratorOptions {
  apiDefinition: FastifyPluginAsync | FastifyPluginCallback;
  swaggerOptions?: SwaggerOptions;
  prefix?: string;
  outputDirectory?: string;
}

/**
 * Generates OpenAPI JSON and YAML spec documents based on a given Fastify API plugin with optional
 * Swagger definitions.
 */
export async function generateOpenApiSpec(options: OpenApiGeneratorOptions) {
  const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  await fastify.register(FastifySwagger, options.swaggerOptions);
  await fastify.register(options.apiDefinition, { prefix: options.prefix });
  await fastify.ready();

  const directory = options.outputDirectory ?? './tmp';
  if (!existsSync(directory)) mkdirSync(directory);
  writeFileSync(`${directory}/openapi.yaml`, fastify.swagger({ yaml: true }));
  writeFileSync(`${directory}/openapi.json`, JSON.stringify(fastify.swagger(), null, 2));

  await fastify.close();
}
