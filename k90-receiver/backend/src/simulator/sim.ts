/**
 * Protocol SIMULATOR. All simulated devices use a serial starting with "SIM-" so the database flags them
 * (devices.is_simulated) and the dashboard labels them. Simulation proves software behaviour only; it is NOT
 * evidence that the physical eSSL K90 speaks this exact protocol.
 */
export interface SimOptions { baseUrl: string; serial: string; fetchImpl?: typeof fetch }

export class SimDevice {
  readonly serial: string;
  private base: string;
  private f: typeof fetch;
  constructor(o: SimOptions) {
    if (!o.serial.startsWith('SIM-')) throw new Error('simulated serial must start with SIM-');
    this.serial = o.serial; this.base = o.baseUrl.replace(/\/$/, ''); this.f = o.fetchImpl ?? fetch;
  }
  private async call(path: string, init?: RequestInit) {
    const res = await this.f(this.base + path, init);
    return { status: res.status, text: await res.text() };
  }
  register() { return this.call(`/iclock/cdata?SN=${this.serial}&options=all&pushver=2.4.1&language=69`); }
  heartbeat() { return this.call(`/iclock/getrequest?SN=${this.serial}&INFO=Ver%206.60%20SIM,0,0,0,10.0.0.5`); }
  /** lines: [pin, 'YYYY-MM-DD HH:MM:SS', status, verify] */
  punch(lines: Array<[string, string, string?, string?]>, stamp = '9999') {
    const body = lines.map(([pin, t, st = '0', v = '1']) => `${pin}\t${t}\t${st}\t${v}\t0\t0\t0`).join('\n') + '\n';
    return this.post(`/iclock/cdata?SN=${this.serial}&table=ATTLOG&Stamp=${stamp}`, body);
  }
  post(path: string, body: string) {
    return this.call(path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
  }
  invalid() { return this.post(`/iclock/cdata?SN=${this.serial}&table=ATTLOG&Stamp=1`, 'garbage line\nabc\t2024-13-45 99:99:99\t0\t1\n'); }

  /** Retry with backoff, as a real device would after a network outage. */
  async punchWithRetry(lines: Array<[string, string, string?, string?]>, tries = 5, delayMs = 200) {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await this.punch(lines);
        if (r.status === 200 && r.text.startsWith('OK')) return r;
        last = new Error(`status ${r.status}`);
      } catch (e) { last = e; }
      await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
    throw last;
  }
}
