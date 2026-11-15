import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const app = await buildApp(cfg);
const stop = async (sig: string) => {
  app.fastify.log.info({ sig }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
await app.fastify.listen({ port: cfg.port, host: cfg.host });
