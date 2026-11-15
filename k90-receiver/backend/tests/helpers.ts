import pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/k90test';
export const TOKEN = 'test-token-0123456789abcdef';

export function testConfig(over: Partial<Config> = {}): Config {
  return loadConfig({ DATABASE_URL: TEST_DB, DASHBOARD_TOKEN: TOKEN, DEVICE_TIMEZONE: 'Asia/Kolkata' } as NodeJS.ProcessEnv,
    { migrationsDir: new URL('../migrations', import.meta.url).pathname, ...over });
}

export async function resetDb() {
  const p = new pg.Pool({ connectionString: TEST_DB });
  await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await p.end();
}

export async function startApp(over: Partial<Config> = {}): Promise<App> {
  return buildApp(testConfig(over), { logger: false, background: false });
}

export const auth = { authorization: `Bearer ${TOKEN}` };

/** Wrap fastify.inject so the simulator can be used in-process. */
export function injectFetch(app: App): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const res = await app.fastify.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST', url: u.pathname + u.search,
      headers: (init?.headers ?? {}) as Record<string, string>, payload: init?.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode });
  }) as unknown as typeof fetch;
}
