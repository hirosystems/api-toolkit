import pino from 'pino';

export const PINO_LOGGER_CONFIG = {
  name: process.env.APPLICATION_NAME ?? 'api',
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string, number: number) => ({ level: label }),
  },
};
export const logger = pino(PINO_LOGGER_CONFIG);
