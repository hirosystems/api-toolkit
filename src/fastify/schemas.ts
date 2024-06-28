import { TSchema, Type } from '@sinclair/typebox';

export const Nullable = <T extends TSchema>(type: T) => Type.Union([type, Type.Null()]);
export const Optional = <T extends TSchema>(type: T) => Type.Optional(type);

export const PaginatedResponse = <T extends TSchema>(type: T, title: string) =>
  Type.Object(
    {
      limit: Type.Integer({ examples: [20] }),
      offset: Type.Integer({ examples: [0] }),
      total: Type.Integer({ examples: [1] }),
      results: Type.Array(type),
    },
    { title }
  );
