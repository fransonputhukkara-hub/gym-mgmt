import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createPool, migrate, type Pool } from './db.js';
import { registerApiRoutes } from './routes/api.js';
import { registerDeviceRoutes } from './routes/device.js';
import { pruneHeartbeats, sweep } from './services/device.js';

export interface App { fastify: FastifyInstance; pool: Pool; close: () => Promise<void> }

export async function buildApp(cfg: Config, opts: { logger?: boolean; background?: boolean } = {}): Promise<App> {
  const fastify = Fastify({
    logger: opts.logger === false ? false : {
      level: cfg.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,           // behind nginx; req.ip = real device IP from X-Forwarded-For
    bodyLimit: 2 * 1024 * 1024,
  });
  // Devices send text/plain, octet-stream or form types. Accept everything as an untouched string.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const pool = createPool(cfg.databaseUrl, fastify.log);
  await pool.query('SELECT now() AT TIME ZONE $1', [cfg.deviceTimezone]); // fail fast on bad DEVICE_TIMEZONE / DB
  await migrate(pool, cfg.migrationsDir);

  registerApiRoutes(fastify, pool, cfg);
  registerDeviceRoutes(fastify, pool, cfg);

  const timers: NodeJS.Timeout[] = [];
  if (opts.background !== false) {
    timers.push(setInterval(() => { sweep(pool, cfg).catch((err) => fastify.log.error({ err }, 'sweep failed')); }, 30_000));
    timers.push(setInterval(() => { pruneHeartbeats(pool, cfg).catch((err) => fastify.log.error({ err }, 'prune failed')); }, 6 * 3600_000));
    timers.forEach((t) => t.unref());
  }

  await fastify.ready();
  return {
    fastify, pool,
    close: async () => { timers.forEach(clearInterval); await fastify.close(); await pool.end(); },
  };
}
