import { SimDevice } from './sim.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const dev = new SimDevice({ baseUrl: args['base-url'] ?? 'http://localhost:3000', serial: args.serial ?? 'SIM-0001' });
const now = new Date();
const ts = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

console.log('[SIMULATED] register   ', await dev.register());
console.log('[SIMULATED] heartbeat  ', await dev.heartbeat());
console.log('[SIMULATED] punch      ', await dev.punch([['1001', ts(now)]]));
console.log('[SIMULATED] batch      ', await dev.punch([['1002', ts(now)], ['1003', ts(now), '1', '15']]));
console.log('[SIMULATED] duplicate  ', await dev.punch([['1001', ts(now)]]));
console.log('[SIMULATED] invalid    ', await dev.invalid());
console.log('Simulated data uses serial', dev.serial, '- not hardware proof.');
