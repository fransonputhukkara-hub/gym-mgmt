export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  dashboardToken: string;
  deviceTimezone: string;
  autoRegisterDevices: boolean;
  allowedDeviceSerials: string[];
  onlineThresholdSeconds: number;
  heartbeatRetentionDays: number;
  diskPath: string;
  diskMinFreePercent: number;
  logLevel: string;
  migrationsDir: string;
  /** Config returned to the device on registration. Values are protocol-dependent; see docs/PROTOCOL.md. */
  pollDelaySeconds: number;
  errorDelaySeconds: number;
  /** Echo the last stored ATTLOG Stamp in the registration reply. Off = identical to the proven diagnostic reply (always None). */
  echoAttlogStamp: boolean;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function int(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const dashboardToken = env.DASHBOARD_TOKEN;
  if (!dashboardToken || dashboardToken.length < 16) {
    throw new Error('DASHBOARD_TOKEN is required and must be at least 16 characters');
  }
  const cfg: Config = {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    dashboardToken,
    deviceTimezone: env.DEVICE_TIMEZONE ?? 'Asia/Kolkata',
    autoRegisterDevices: bool(env.AUTO_REGISTER_DEVICES, true),
    allowedDeviceSerials: (env.ALLOWED_DEVICE_SERIALS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    onlineThresholdSeconds: int(env.ONLINE_THRESHOLD_SECONDS, 180),
    heartbeatRetentionDays: int(env.HEARTBEAT_RETENTION_DAYS, 14),
    diskPath: env.DISK_PATH ?? '/',
    diskMinFreePercent: int(env.DISK_MIN_FREE_PERCENT, 10),
    logLevel: env.LOG_LEVEL ?? 'info',
    migrationsDir: env.MIGRATIONS_DIR ?? new URL('../migrations', import.meta.url).pathname,
    pollDelaySeconds: int(env.DEVICE_POLL_DELAY_SECONDS, 10),
    errorDelaySeconds: int(env.DEVICE_ERROR_DELAY_SECONDS, 30),
    echoAttlogStamp: bool(env.ECHO_ATTLOG_STAMP, false),
  };
  return { ...cfg, ...overrides };
}
