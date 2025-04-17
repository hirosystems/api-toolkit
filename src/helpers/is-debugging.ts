/*
 * Reliable way to check if we are debugging. Supports ts-node and other tools unlike some other
 * approaches that check argv or env vars. It also lazy-loads the `node:inspector` module to avoid
 * unnecessary overhead in production environments where this function might not be called.
 */
export function isDebugging() {
  type NodeInspectorType = typeof import('node:inspector');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const inspector = require('node:inspector') as NodeInspectorType;
  const url = inspector.url();
  return url !== undefined;
}
