import { EventEmitter } from "events";
import HttpClient from "hap-controller/lib/transport/ip/http-client";
import { Logging } from "homebridge";
import { GetCharacteristicsOptions } from "hap-controller/lib/transport/ip/http-client";
import { CharacteristicDescription, PairingData } from "./Interfaces";

export class RequestTimeoutError extends Error {}

/** Each operation owns its timer. Late responses cannot advance or cancel another operation. */
export class Sequencer {
  private queue: Array<{ run: () => Promise<any>; resolve: (v: any) => void; reject: (e: Error) => void }> = [];
  private active?: { finish: (e?: Error, value?: any) => void };
  private stopped = false;
  constructor(private readonly timeout = 5000, private readonly onTimeout: () => void = () => {}) {}
  get length(): number { return this.queue.length; }
  get busy(): boolean { return !!this.active; }
  push<T>(run: () => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Connection closed"));
    return new Promise<T>((resolve, reject) => { this.queue.push({ run, resolve, reject }); this.next(); });
  }
  abort(error = new Error("Connection interrupted")) {
    const pending = this.queue.splice(0);
    pending.forEach(item => item.reject(error));
    this.active?.finish(error);
  }
  close() { this.stopped = true; this.abort(new Error("Connection closed")); }
  private next() {
    if (this.stopped || this.active || !this.queue.length) return;
    const item = this.queue.shift()!;
    let settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.active = undefined;
      if (error) item.reject(error); else item.resolve(value);
      // Let timeout recovery close the old transport before another request starts.
      queueMicrotask(() => this.next());
    };
    const timer = setTimeout(() => {
      finish(new RequestTimeoutError("HomeKit request timed out"));
      this.onTimeout();
    }, this.timeout);
    this.active = { finish };
    Promise.resolve().then(item.run).then(value => finish(undefined, value), e => finish(e instanceof Error ? e : new Error("HomeKit request failed")));
  }
}

/** A device command was rejected by HAP; the transport itself may still be healthy. */
export class CharacteristicStatusError extends Error {
  constructor(readonly status: number) { super(`HomeKit accessory returned status ${status}`); }
}
export function checkStatus(response: any) {
  const failed = response?.characteristics?.find(c => c.status !== undefined && c.status !== 0);
  if (failed) throw new CharacteristicStatusError(failed.status);
  return response;
}

export class HttpWrapper extends EventEmitter {
  public client: HttpClient;
  private readonly list: Sequencer;
  private listeners = new Map<string, (data: any) => void>();
  private subscriptions = new Set<string>();
  private stopped = false;
  private generation = 0;
  constructor(private readonly log: Logging, private readonly deviceId: string, private address: string, private port: number,
    private readonly pairingData?: PairingData, timeout = 5000, private readonly factory: typeof HttpClient = HttpClient) {
    super();
    this.client = this.createClient();
    this.list = new Sequencer(timeout, () => this.disconnect());
  }
  private createClient(): HttpClient {
    const generation = this.generation;
    const client = new this.factory(this.deviceId, this.address, this.port, this.pairingData);
    client.on("event", (event: any) => {
      if (generation !== this.generation || this.stopped) return;
      for (const c of event.characteristics || []) this.listeners.get(`${c.aid}.${c.iid}`)?.(c);
    });
    client.on("event-disconnect", () => {
      // The library clears its subscription state after emitting this event.
      queueMicrotask(() => { if (generation === this.generation && !this.stopped) this.disconnect(); });
    });
    return client;
  }
  private disconnect() {
    if (this.stopped) return;
    this.generation++;
    const old = this.client;
    old.removeAllListeners();
    void old.close().catch(() => {});
    this.subscriptions.clear();
    this.client = this.createClient();
    this.list.abort();
    this.emit("disconnected");
  }
  private request<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    return this.list.push(async () => {
      if (generation !== this.generation) throw new Error("Connection interrupted");
      return operation();
    }).catch(e => {
      if (!(e instanceof CharacteristicStatusError) && !(e instanceof RequestTimeoutError) && generation === this.generation && !this.stopped) this.disconnect();
      throw e;
    });
  }
  get queueLength() { return this.list.length; }
  get subscriptionCount() { return this.subscriptions.size; }
  identify() { return this.request(() => this.client.identify()); }
  getAccessories(): Promise<any> { return this.request(() => this.client.getAccessories()); }
  getCharacteristics(ids: string[], options?: GetCharacteristicsOptions): Promise<any> {
    return this.request(async () => checkStatus(await this.client.getCharacteristics(ids, options)));
  }
  setCharacteristics(values: Record<string, unknown>): Promise<any> {
    // Never replay writes after a timeout: delivery may already have occurred.
    return this.request(async () => checkStatus(await this.client.setCharacteristics(values)));
  }
  subscribeCharacteristics(ids: string[]): Promise<any> {
    if (!ids.length) return Promise.resolve();
    return this.request(async () => {
      const result = checkStatus(await this.client.subscribeCharacteristics(ids));
      ids.forEach(id => this.subscriptions.add(id));
      return result;
    });
  }
  watch(c: CharacteristicDescription, listener: (data: any) => void) { this.listeners.set(c.cname, listener); }
  clearWatchers() { this.listeners.clear(); }
  async unsubscribeAll() {
    if (this.subscriptions.size) {
      await this.request(async () => checkStatus(await this.client.unsubscribeCharacteristics([...this.subscriptions])));
      this.subscriptions.clear();
    }
  }
  async shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    this.client.removeAllListeners();
    this.list.close();
    this.listeners.clear();
    // Bound teardown even when the accessory vanished mid-command.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.unsubscribeCharacteristics([...this.subscriptions]).catch(() => {}),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.subscriptions.clear();
      await this.client.close();
    }
  }
}
