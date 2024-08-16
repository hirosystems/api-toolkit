import { logger } from '../logger';
import { isDevEnv } from './values';

/**
 * Iterate over an array, yielding multiple items at a time. If the size of the given array
 * is not divisible by the given batch size, then the length of the last items returned will
 * be smaller than the given batch size, i.e.:
 * ```typescript
 * items.length % batchSize
 * ```
 * @param items - The array to iterate over.
 * @param batchSize - Maximum number of items to return at a time.
 * @param printBenchmark - If we should print benchmark of items per second
 */
export function* batchIterate<T>(
  items: T[],
  batchSize: number,
  printBenchmark = isDevEnv
): Generator<T[]> {
  if (items.length === 0) return;
  const startTime = Date.now();
  for (let i = 0; i < items.length; ) {
    const itemsRemaining = items.length - i;
    const sliceSize = Math.min(batchSize, itemsRemaining);
    yield items.slice(i, i + sliceSize);
    i += sliceSize;
  }
  if (printBenchmark) {
    const itemsPerSecond = Math.round((items.length / (Date.now() - startTime)) * 1000);
    const caller = new Error().stack?.split('at ')[3].trim();
    logger.debug(`Iterated ${itemsPerSecond} items/second at ${caller}`);
  }
}

/**
 * Iterate over an `AsyncIterable`, yielding multiple items at a time. If the size of the given
 * array is not divisible by the given batch size, then the length of the last items returned will
 * be smaller than the given batch size.
 *
 * @param items - AsyncIterable
 * @param batchSize - Batch size
 * @param printBenchmark - If we should print benchmark of items per second
 */
export async function* asyncBatchIterate<T>(
  items: AsyncIterable<T>,
  batchSize: number,
  printBenchmark = isDevEnv
): AsyncGenerator<T[], void, unknown> {
  const startTime = Date.now();
  let itemCount = 0;
  let itemBatch: T[] = [];
  for await (const item of items) {
    itemBatch.push(item);
    itemCount++;
    if (itemBatch.length >= batchSize) {
      yield itemBatch;
      itemBatch = [];
      if (printBenchmark) {
        const itemsPerSecond = Math.round((itemCount / (Date.now() - startTime)) * 1000);
        const caller = new Error().stack?.split('at ')[3].trim();
        logger.debug(`Iterated ${itemsPerSecond} items/second at ${caller}`);
      }
    }
  }
  if (itemBatch.length > 0) {
    yield itemBatch;
  }
}

/**
 * Convert an `AsyncIterable` to a generator
 * @param iter - AsyncIterable
 */
export async function* asyncIterableToGenerator<T>(iter: AsyncIterable<T>) {
  for await (const entry of iter) {
    yield entry;
  }
}
