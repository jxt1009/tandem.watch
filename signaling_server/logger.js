import pino from 'pino';
import config from './config.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: config.environment === 'development' 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: false,
        }
      }
    : undefined,
});

export default logger;
