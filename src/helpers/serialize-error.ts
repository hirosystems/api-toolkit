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

const commonProperties: {
  name: string;
  descriptor: Partial<PropertyDescriptor>;
  deserialize?: (_: any) => any;
  serialize?: (_: any) => any;
}[] = [
  {
    name: 'message',
    descriptor: {
      enumerable: false,
      configurable: true,
      writable: true,
    },
  },
  {
    name: 'stack',
    descriptor: {
      enumerable: false,
      configurable: true,
      writable: true,
    },
  },
  {
    name: 'code',
    descriptor: {
      enumerable: true,
      configurable: true,
      writable: true,
    },
  },
  {
    name: 'cause',
    descriptor: {
      enumerable: false,
      configurable: true,
      writable: true,
    },
  },
  {
    name: 'errors',
    descriptor: {
      enumerable: false,
      configurable: true,
      writable: true,
    },
    deserialize: (errors: SerializedError[]) => errors.map(error => deserializeError(error)),
    serialize: (errors: Error[]) => errors.map(error => serializeError(error)),
  },
];

export type SerializedError = {
  name: string;
  message: string;
  stack: string;
  code?: string | number;
  cause?: string;
  [key: string]: any;
};

export function serializeError(subject: Error): SerializedError {
  const data: Record<string, any> = {
    name: 'Error',
    message: '',
    stack: '',
  };

  for (const prop of commonProperties) {
    if (!(prop.name in subject)) {
      continue;
    }
    let value = (subject as any)[prop.name];
    if (prop.serialize) {
      value = prop.serialize(value);
    }
    data[prop.name] = value;
  }

  // Include any other enumerable own properties
  for (const key of Object.keys(subject)) {
    if (!(key in data)) {
      data[key] = (subject as any)[key];
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
  const con = errorConstructors.get(subject.name) ?? Error;
  const output = Object.create(con.prototype) as Error;

  for (const prop of commonProperties) {
    if (!(prop.name in subject)) continue;

    let value = subject[prop.name];
    if (prop.deserialize) value = prop.deserialize(value);

    Object.defineProperty(output, prop.name, {
      ...prop.descriptor,
      value: value,
    });
  }

  // Add any other properties (custom props not in commonProperties)
  for (const key of Object.keys(subject)) {
    if (!commonProperties.some(p => p.name === key)) {
      (output as any)[key] = subject[key];
      Object.assign(output, { [key]: subject[key] });
    }
  }

  return output;
}
