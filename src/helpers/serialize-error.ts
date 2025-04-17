/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

const errorConstructors = new Map(
  [
    // Native ES errors https://262.ecma-international.org/12.0/#sec-well-known-intrinsic-objects
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
    AggregateError,

    // Built-in errors
    globalThis.DOMException,

    // Node-specific errors https://nodejs.org/api/errors.html
    (globalThis as any).AssertionError as Error,
    (globalThis as any).SystemError as Error,
  ]
    // Non-native Errors are used with `globalThis` because they might be missing. This filter drops them when undefined.
    .filter(Boolean)
    .map(constructor => [constructor.name, constructor as ErrorConstructor] as const)
);

/**
 * Custom errors can only be deserialized correctly if they are registered here.
 */
export function addKnownErrorConstructor(
  constructor: new (message?: string, ..._arguments: unknown[]) => Error
) {
  try {
    new constructor();
  } catch (error) {
    throw new Error(`The error constructor "${constructor.name}" is not compatible`, {
      cause: error,
    });
  }
  errorConstructors.set(constructor.name, constructor as ErrorConstructor);
}

const commonProperties: [name: string, enumerable: boolean][] = [
  ['message', false],
  ['stack', false],
  ['code', true],
  ['cause', false],
  ['errors', false],
];

export type SerializedError = {
  name: string;
  message: string;
  stack: string;
  [key: string]: any;
};

export function isErrorLike(value: unknown): value is Error & { stack: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'message' in value &&
    'stack' in value &&
    typeof (value as Error).name === 'string' &&
    typeof (value as Error).message === 'string' &&
    typeof (value as Error).stack === 'string'
  );
}

export function serializeError(subject: Error): SerializedError {
  if (!isErrorLike(subject)) {
    // If the subject is not an error, for example `throw "boom", then we throw.
    // This function should only be passed error objects, callers can use `isErrorLike`.
    throw new TypeError('Failed to serialize error, expected an error object');
  }

  const data: Record<string, any> = {
    name: 'Error',
    message: '',
    stack: '',
  };

  for (const [name] of commonProperties) {
    if (name in subject) {
      data[name] = deepSerialize((subject as any)[name]);
    }
  }

  // Include any other enumerable own properties
  for (const key of Object.keys(subject)) {
    if (!(key in data)) {
      data[key] = deepSerialize((subject as any)[key]);
    }
  }

  if (globalThis.DOMException && subject instanceof globalThis.DOMException) {
    data.name = 'DOMException';
  } else {
    data.name = subject.constructor.name;
  }
  return data as SerializedError;
}

export function deserializeError(subject: SerializedError): Error {
  if (!isErrorLike(subject)) {
    // If the subject is not an error, for example `throw "boom", then we throw.
    // This function should only be passed error objects, callers can use `isErrorLike`.
    throw new TypeError('Failed to desserialize error, expected an error object');
  }

  let con = errorConstructors.get(subject.name);
  if (!con) {
    // If the constructor is not found, use the generic Error constructor
    con = Error;
    console.error(
      `Error constructor "${subject.name}" not found during worker error deserialization, using generic Error constructor`
    );
  }
  const output = Object.create(con.prototype) as Error;

  for (const [name, enumerable] of commonProperties) {
    if (name in subject) {
      Object.defineProperty(output, name, {
        enumerable,
        configurable: true,
        writable: true,
        value: deepDeserialize((subject as any)[name]),
      });
    }
  }

  // Add any other properties (custom props not in commonProperties)
  for (const key of Object.keys(subject)) {
    if (!commonProperties.some(([name]) => name === key)) {
      (output as any)[key] = deepDeserialize((subject as any)[key]);
    }
  }

  return output;
}

function deepSerialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSerialize);
  } else if (isErrorLike(value)) {
    return serializeError(value);
  } else if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepSerialize(v);
    }
    return result;
  }
  return value;
}

function deepDeserialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepDeserialize);
  } else if (isErrorLike(value)) {
    return deserializeError(value);
  } else if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepDeserialize(v);
    }
    return result;
  }
  return value;
}
