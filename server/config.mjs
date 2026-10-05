import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const originValue = env.PUBLIC_ORIGIN || (production ? env.RENDER_EXTERNAL_URL : '');
  let publicOrigin = '';
  if (originValue) {
    const url = new URL(originValue);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('PUBLIC_ORIGIN must be an origin without a path, query or credentials');
    if (production && (url.protocol !== 'https:' || /^(localhost$|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/.test(url.hostname))) throw new Error('Production requires a public HTTPS origin');
    publicOrigin = url.origin;
  }
  if (production && !publicOrigin) throw new Error('Set PUBLIC_ORIGIN or use Render RENDER_EXTERNAL_URL');
  if (production && (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN)) throw new Error('Production requires persistent Turso storage. Local SQLite is not allowed.');
  if (env.TURSO_DATABASE_URL && !/^(libsql|https):\/\/[^/]+/.test(env.TURSO_DATABASE_URL)) throw new Error('Use a libsql:// or https:// Turso URL, never a local file');
  for (const [name, min] of [['IOT_API_KEY',32]]) {
    if ((production || env[name]) && (!env[name] || env[name].length < min)) throw new Error(`${name} must contain at least ${min} characters`);
  }
  if (env.IOT_DEVICE_ID && env.IOT_DEVICE_ID !== 'SM-001') throw new Error('This single-device MVP uses IOT_DEVICE_ID=SM-001');
  if (env.TURSO_DATABASE_URL && !env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL');
  if (env.PORT && (!/^\d+$/.test(env.PORT) || Number(env.PORT)<1 || Number(env.PORT)>65535)) throw new Error('PORT must be between 1 and 65535');
  return {
    production, publicOrigin,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    port: Number(env.PORT || (production ? 10000 : 5173)),
    databasePath: resolve(env.SMART_MONITOR_DB || 'data/monitor.sqlite'),
    databaseUrl: env.TURSO_DATABASE_URL || '', databaseToken: env.TURSO_AUTH_TOKEN || '',
    iotKey: env.IOT_API_KEY || '', deviceId: env.IOT_DEVICE_ID || 'SM-001',
  };
}
