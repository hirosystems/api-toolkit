import { createHash } from 'node:crypto';
import { isArrayBufferView } from 'node:util/types';

export const isDevEnv = process.env.NODE_ENV === 'development';
export const isTestEnv = process.env.NODE_ENV === 'test';
export const isProdEnv =
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'prod' ||
  !process.env.NODE_ENV ||
  (!isTestEnv && !isDevEnv);

/**
 * Digests a string value into a SHA256 hash.
 * @param content - String input
 * @returns Hashed value
 */
export function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Parses a boolean string using conventions from CLI arguments, URL query params, and environmental
 * variables. If the input is defined but empty string then true is returned. If the input is
 * undefined or null than false is returned. For example, if the input comes from a CLI arg like
 * `--enable_thing` or URL query param like `?enable_thing`, then this function expects to receive a
 * defined but empty string, and returns true. Otherwise, it checks or values like `true`, `1`,
 * `on`, `yes` (and the inverses). Throws if an unexpected input value is provided.
 */
export function parseBoolean(val: string | undefined | null): boolean {
  if (typeof val === 'undefined' || val === null) {
    return false;
  }
  switch (val.trim().toLowerCase()) {
    case '':
    case 'true':
    case '1':
    case 'on':
    case 'yes':
      return true;
    case 'false':
    case '0':
    case 'off':
    case 'no':
      return false;
    default:
      throw new Error(`Cannot parse boolean`);
  }
}

/**
 * Encodes a buffer as a `0x` prefixed lower-case hex string. Returns an empty string if the buffer
 * is zero length.
 */
export function bufferToHex(buff: Buffer, prefix: boolean = true): string {
  return buff.length === 0 ? '' : (prefix ? '0x' : '') + buff.toString('hex');
}

/**
 * Decodes a `0x` prefixed hex string to a buffer.
 * @param hex - A hex string with a `0x` prefix.
 */
export function hexToBuffer(hex: string): Buffer {
  if (hex.length === 0) {
    return Buffer.alloc(0);
  }
  if (!hex.startsWith('0x')) {
    throw new Error(`Hex string is missing the "0x" prefix`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string is an odd number of digits`);
  }
  return Buffer.from(hex.substring(2), 'hex');
}

/**
 * Decodes a hex string to a Buffer, trims the 0x-prefix if exists.
 * If already a buffer, returns the input immediately.
 */
export function coerceToBuffer(hex: string | Buffer | ArrayBufferView): Buffer {
  if (typeof hex === 'string') {
    if (hex.startsWith('0x')) {
      hex = hex.substring(2);
    }
    if (hex.length % 2 !== 0) {
      throw new Error(`Hex string is an odd number of characters`);
    }
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error(`Hex string contains non-hexadecimal characters`);
    }
    return Buffer.from(hex, 'hex');
  } else if (Buffer.isBuffer(hex)) {
    return hex;
  } else if (isArrayBufferView(hex)) {
    return Buffer.from(hex.buffer, hex.byteOffset, hex.byteLength);
  } else {
    throw new Error(`Cannot convert to Buffer, unexpected type: ${hex.constructor.name}`);
  }
}

/**
 * Converts a hex string into a UTF-8 string.
 * @param hex - Hex string
 * @returns UTF-8 string
 */
export function hexToUtf8String(hex: string): string {
  const buffer = hexToBuffer(hex);
  return buffer.toString('utf8');
}

/**
 * Converts a number to a hex string.
 * @param number - Number
 * @param paddingBytes - Padding bytes
 * @returns Hex string
 */
export function numberToHex(number: number, paddingBytes: number = 4): string {
  let result = number.toString(16);
  if (result.length % 2 > 0) {
    result = '0' + result;
  }
  if (paddingBytes && result.length / 2 < paddingBytes) {
    result = '00'.repeat(paddingBytes - result.length / 2) + result;
  }
  return '0x' + result;
}

/**
 * Checks if a string has `0x` prefix.
 * @param val - Hex string
 * @returns Boolean
 */
export const has0xPrefix = (val: string) => val.substring(0, 2).toLowerCase() === '0x';

/**
 * Converts a string to an enum value.
 * @param enumType - The enum type
 * @param value - The string value to convert
 * @returns Enum item or undefined
 */
export function toEnumValue<T>(enm: { [s: string]: T }, value: string): T | undefined {
  return (Object.values(enm) as unknown as string[]).includes(value)
    ? (value as unknown as T)
    : undefined;
}
