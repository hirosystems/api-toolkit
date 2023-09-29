export const isDevEnv = process.env.NODE_ENV === 'development';
export const isTestEnv = process.env.NODE_ENV === 'test';
export const isProdEnv =
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'prod' ||
  !process.env.NODE_ENV ||
  (!isTestEnv && !isDevEnv);
