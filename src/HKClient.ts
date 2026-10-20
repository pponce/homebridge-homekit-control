import { PlatformAccessory, Service, Characteristic, CharacteristicProps, WithUUID, APIEvent, HAPStatus } from "homebridge";
import { AcceessoryDescription, CharacteristicDescription, ExtendedCharacteristic, FakeGatoProvider, HKServiceConfig, HttpClientCharacteristic, IHKClient, IHKPlatform, ServiceDescription, HKPlatformAccessory } from "./Interfaces";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings";
import { HttpWrapper, CharacteristicStatusError } from "./HttpWrapper";
const storage = require("../shared/storage");

interface FakeGatoData { interval: number; timer: ReturnType<typeof setInterval> | undefined; }
function copyProps(source: HttpClientCharacteristic, char: ExtendedCharacteristic) {
  const props: Partial<CharacteristicProps> = {};
  for (const key of ["minValue", "maxValue", "minStep", "format", "perms", "unit", "description", "maxLen", "maxDataLen", "validValues", "validValueRanges", "adminOnlyAccess"]) {
    if (source[key] !== undefined) props[key] = source[key];
  }
  // HAP JSON uses hyphenated names; do not advertise unsupported thermostat modes.
  if (source["valid-values"] !== undefined) props.validValues = source["valid-values"];
  if (source["valid-values-range"] !== undefined) props.validValueRanges = source["valid-values-range"];
  char.setProps(props);
}

export class HKClient implements IHKClient {
  readonly name: string;
  public didFinishStartup = false;
  private readonly deviceID: string;
  private readonly root: string;
  private readonly key: string;
  private client?: HttpWrapper;
  private supportedAccessories: AcceessoryDescription[] = [];
  private fakeGato: FakeGatoData;
  private stopped = false;
  private initialized = false;
  private online = false;
  private recovering = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private descriptorSignature = "";
  private diagnostics: any = {};
  private endpoint: { address: string; port: number };
  private configured = new Set<HKPlatformAccessory>();

  constructor(private readonly serviceConfig: HKServiceConfig, private readonly parent: IHKPlatform,
    private readonly discover: () => Promise<any[]> = () => require("../shared/controller").discover(undefined, 3)) {
    this.endpoint = { address: serviceConfig.address, port: serviceConfig.port };
    this.name = serviceConfig.name || "Unnamed Accessory";
    this.deviceID = serviceConfig.id.toUpperCase();
    this.root = parent.api.user.storagePath();
    this.key = `${serviceConfig.uniquePrefix || ""}:${this.deviceID}`;
    this.fakeGato = { interval: serviceConfig.enableHistory ? Math.max(30, Math.min(600, serviceConfig.historyInterval || 600)) : 0, timer: undefined };
    parent.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.claimCachedAccessories();
      void this.recover();
    });
  }
  con(): HttpWrapper { if (!this.client) throw new Error("Device not connected"); return this.client; }
  private legacyUuid() {
    const name = this.serviceConfig.legacyName || this.name;
    return this.parent.api.hap.uuid.generate(this.serviceConfig.uniquePrefix ? `${this.serviceConfig.uniquePrefix}.${name}` : name);
  }
  private claimCachedAccessories() {
    for (const a of this.parent.accessories) {
      if (a.context.homekitControl?.key === this.key || (!a.context.homekitControl && a.UUID === this.legacyUuid())) {
        a._wasUsed = true;
        this.configured.add(a);
        // Until a successful read, cached values must not look live.
        for (const s of a.services) for (const c of s.characteristics) {
          if (s.UUID === this.parent.api.hap.Service.AccessoryInformation.UUID) continue;
          if (c.props.perms?.includes("pr" as any)) c.onGet(() => { throw new this.parent.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE); });
          if (c.props.perms?.includes("pw" as any)) c.onSet(() => { throw new this.parent.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE); });
        }
      }
    }
  }
  private status(state: string) {
    this.diagnostics = { ...this.diagnostics, state, updatedAt: new Date().toISOString(), nodeVersion: process.version,
      homebridgeVersion: this.parent.api.serverVersion, pluginVersion: require("../package.json").version,
      address: this.endpoint.address, port: this.endpoint.port, queueLength: this.client?.queueLength || 0, subscriptions: this.client?.subscriptionCount || 0, failures: this.failures };
    try { storage.write(this.root, "status", this.key, this.diagnostics); }
    catch { this.parent.log.warn(`${this.name}: Could not save connection diagnostics`); }
  }
  private disconnected() {
    if (this.stopped) return;
    this.online = false;
    this.status("offline");
    for (const a of this.configured) for (const s of a.services) for (const c of s.characteristics) {
      if (s.UUID !== this.parent.api.hap.Service.AccessoryInformation.UUID && c.props.perms?.includes("pr" as any)) {
        c.updateValue(new this.parent.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE));
      }
    }
    if (this.heartbeat) clearTimeout(this.heartbeat);
    if (!this.recovering) this.scheduleRecovery();
  }
  private scheduleRecovery() {
    if (this.retry || this.stopped) return;
    // Bounded rapid retries, then a low-frequency probe so a long outage heals automatically.
    const delay = this.failures >= 6 ? 300000 : Math.min(60000, 2000 * 2 ** this.failures);
    this.diagnostics.nextRetryAt = new Date(Date.now() + delay).toISOString();
    this.status("offline");
    this.retry = setTimeout(() => { this.retry = undefined; void this.recover(); }, delay);
    this.retry.unref?.();
  }
  private async recover() {
    if (this.stopped || this.recovering) return;
    this.recovering = true;
    this.online = false;
    this.status("connecting");
    try {
      if (this.failures || this.initialized) {
        // mDNS IDs stay stable when DHCP addresses or the accessory's HAP port change.
        const devices = await this.discover().catch(() => []);
        if (this.stopped) return;
        const discovered = devices.find(d => typeof d.id === "string" && d.id.toUpperCase() === this.deviceID);
        if (discovered && typeof discovered.address === "string" && Number.isInteger(discovered.port) && discovered.port > 0 && discovered.port <= 65535) {
          this.endpoint = { address: discovered.address, port: discovered.port };
          this.client?.updateEndpoint(this.endpoint.address, this.endpoint.port);
        }
      }
      if (!this.client) {
        const pairing = storage.resolvePairing(this.root, this.serviceConfig);
        this.client = new HttpWrapper(this.parent.log, this.serviceConfig.id, this.endpoint.address, this.endpoint.port, pairing);
        this.client.on("disconnected", () => this.disconnected());
      }
      const data = await this.client.getAccessories();
      if (this.stopped) return;
      if (!Array.isArray(data.accessories) || !data.accessories.length) throw new Error("Empty accessory database");
      this.diagnostics.services = storage.servicesForExport(data);
      const signature = JSON.stringify(this.diagnostics.services);
      if (!this.initialized || signature !== this.descriptorSignature) {
        // Drop old subscriptions before rebinding a changed accessory database.
        await this.client.unsubscribeAll();
        this.client.clearWatchers();
        this._loadDevices(data);
        if (this.fakeGato.interval) this.amendFakeGato();
        this.supportedAccessories.forEach((a, i) => this.loadOrCreate(a, i === 0));
        this.parent.api.updatePlatformAccessories([...this.configured]);
        this.descriptorSignature = signature;
        this.initialized = true;
      }
      await this.refreshState();
      const notify = this.supportedAccessories.flatMap(a => a.services.flatMap(s => s.characteristics))
        .filter(c => c.connect && c.allowValueUpdates && c.source.perms?.includes("ev")).map(c => c.cname);
      await this.client.subscribeCharacteristics(notify);
      if (this.stopped) return;
      this.online = true;
      this.failures = 0;
      delete this.diagnostics.nextRetryAt;
      this.diagnostics.lastConnectedAt = new Date().toISOString();
      this.status("online");
      this.parent.log.info(`${this.name}: Connected (${notify.length} event subscriptions)`);
      this.scheduleHeartbeat();
      if (this.fakeGato.interval && !this.fakeGato.timer) {
        this.fakeGato.timer = setInterval(() => { if (this.online) this.fakegatoEvent(); }, this.fakeGato.interval * 1000);
        this.fakeGato.timer.unref?.();
      }
    } catch {
      if (!this.stopped) {
        this.failures++;
        this.disconnected();
        this.parent.log.warn(`${this.name}: Connection unavailable; retrying automatically`);
      }
    } finally {
      this.recovering = false;
      if (!this.didFinishStartup && !this.stopped) { this.didFinishStartup = true; this.parent.clientFinishedLaunching(this); }
      if (!this.online && !this.stopped) this.scheduleRecovery();
    }
  }
  private scheduleHeartbeat() {
    if (this.stopped) return;
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(async () => {
      try { await this.refreshState(); if (!this.stopped && this.online) { this.status("online"); this.scheduleHeartbeat(); } }
      catch { this.disconnected(); }
    }, 30000);
    this.heartbeat.unref?.();
  }
  private async refreshState() {
    const chars = this.supportedAccessories.flatMap(a => a.services.flatMap(s => s.characteristics))
      .filter(c => c.connect && c.allowValueUpdates && c.source.perms?.includes("pr"));
    for (let i = 0; i < chars.length; i += 40) {
      const batch = chars.slice(i, i + 40);
      const result = await this.con().getCharacteristics(batch.map(c => c.cname));
      if (this.stopped) return;
      for (const c of batch) {
        const value = result.characteristics?.find(v => `${v.aid}.${v.iid}` === c.cname);
        if (!value || value.value === null || value.value === undefined) throw new Error("Missing characteristic value");
        this.updateValue(c, value.value);
      }
    }
    this.diagnostics.lastRefreshAt = new Date().toISOString();
  }
  _loadDevices(data: any) {
    this.supportedAccessories = data.accessories.map(acc => ({
      aid: acc.aid, fakeGato: { room: {}, motion: {}, history: [] },
      services: acc.services.map(s => {
        const create = this.parent.supported.classForService(s.type, this.serviceConfig.proxyAll ? s : undefined);
        const name = s.characteristics.find(c => this.parent.supported.isID(c.type, this.parent.api.hap.Characteristic.Name.UUID))?.value;
        return { create, uuid: create?.UUID || s.type, displayName: typeof name === "string" ? name : `c-${s.iid}`,
          uname: `${this.key}.${acc.aid}.${s.iid}`, iid: s.iid, source: s,
          characteristics: s.characteristics.map(c => {
            const cls = this.parent.supported.classForChar(c.type, this.serviceConfig.proxyAll ? c : undefined);
            return { create: cls, uuid: cls?.UUID || c.type, iid: c.iid, uname: `${this.key}.${acc.aid}.${s.iid}.${c.iid}`,
              cname: `${acc.aid}.${c.iid}`, value: c.value, source: c, allowValueUpdates: true };
          }).filter(c => c.create),
        };
      }),
    }));
    if (this.serviceConfig.logFoundServices) this.parent.log.info(JSON.stringify(storage.servicesForExport(data)));
  }
  private updateValue(c: CharacteristicDescription, value: any) {
    if (value === undefined || value === null || this.stopped) return;
    c.value = value;
    c.connect?.updateValue(value);
    if (c.connect?.chain && c.connect.chainValue) c.connect.chain.updateValue(c.connect.chainValue());
  }
  private async _updateCharacteristicValue(_char: ExtendedCharacteristic, c: CharacteristicDescription) {
    if (!this.online || !c.allowValueUpdates) return;
    try {
      const result = await this.con().getCharacteristics([c.cname]);
      this.updateValue(c, result.characteristics?.find(v => `${v.aid}.${v.iid}` === c.cname)?.value);
    } catch { this.disconnected(); }
  }
  private initAccessoryService(sData: ServiceDescription, service: Service) {
    for (const c of sData.characteristics) {
      if (!c.create) continue;
      const char = service.getCharacteristic(c.create as any) as ExtendedCharacteristic;
      char.removeAllListeners("get"); char.removeAllListeners("set"); char.removeOnGet(); char.removeOnSet();
      copyProps(c.source, char);
      c.connect = char;
      const isInfo = sData.uuid === this.parent.api.hap.Service.AccessoryInformation.UUID;
      if (isInfo && c.uuid === this.parent.api.hap.Characteristic.Name.UUID) {
        c.allowValueUpdates = false; c.value = this.name;
      }
      if (isInfo && c.uuid === this.parent.api.hap.Characteristic.SerialNumber.UUID && this.serviceConfig.uniquePrefix) {
        c.allowValueUpdates = false; c.value = `${this.serviceConfig.uniquePrefix}-${c.value}`;
      }
      if (c.value !== null && c.value !== undefined) char.updateValue(c.value);
      if (c.source.perms?.includes("pr")) char.onGet(async () => {
        if (!c.allowValueUpdates) return c.value;
        if (!this.online) throw new this.parent.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        try {
          const response = await this.con().getCharacteristics([c.cname]);
          const result = response.characteristics?.find(v => `${v.aid}.${v.iid}` === c.cname);
          if (result?.value === undefined || result?.value === null) throw new Error("Missing value");
          this.updateValue(c, result.value); return c.value;
        } catch (e) { throw this.hapError(e); }
      });
      if (c.source.perms?.includes("pw")) char.onSet(async value => {
        if (!this.online) throw new this.parent.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        // Preserve native constraints, including heat-only validValues. Never invent a target.
        if (typeof value === "number" && (!Number.isFinite(value) ||
          (char.props.minValue !== undefined && value < char.props.minValue) ||
          (char.props.maxValue !== undefined && value > char.props.maxValue) ||
          (char.props.validValues && !char.props.validValues.includes(value)))) throw new this.parent.api.hap.HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST);
        try {
          await this.con().setCharacteristics({ [c.cname]: value });
          this.updateValue(c, value);
        } catch (e) { throw this.hapError(e); }
      });
      if (c.allowValueUpdates && c.source.perms?.includes("ev")) this.con().watch(c, data => this.updateValue(c, data.value));
    }
  }
  private hapError(e: unknown) {
    return new this.parent.api.hap.HapStatusError(e instanceof CharacteristicStatusError ? e.status : HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
  private loadOrCreate(data: AcceessoryDescription, first: boolean) {
    let accessory = this.parent.accessories.find(a => a.context.homekitControl?.key === this.key && a.context.homekitControl.aid === data.aid);
    if (!accessory && first) accessory = this.parent.accessories.find(a => !a.context.homekitControl && a.UUID === this.legacyUuid());
    const fresh = !accessory;
    if (!accessory) accessory = new this.parent.api.platformAccessory(this.name, this.parent.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.key}:${data.aid}`)) as HKPlatformAccessory;
    const a = accessory;
    a._wasUsed = true;
    a.displayName = this.name;
    const context = a.context.homekitControl || { key: this.key, aid: data.aid, services: {} };
    const subtypes: Record<string, string | undefined> = context.services || {};
    const used = new Set<Service>();
    for (const s of data.services) {
      if (!s.create) continue;
      let service: Service | undefined;
      const sid = String(s.iid);
      if (Object.prototype.hasOwnProperty.call(subtypes, sid)) service = a.services.find(x => x.UUID === s.uuid && x.subtype === subtypes[sid]);
      // Adopt a legacy subtype without changing HomeKit's service identity.
      if (!service) service = a.services.find(x => !used.has(x) && x.UUID === s.uuid && x.subtype === s.displayName);
      if (!service && (s.uuid === this.parent.api.hap.Service.AccessoryInformation.UUID || data.services.filter(x => x.uuid === s.uuid).length === 1)) {
        service = a.services.find(x => !used.has(x) && x.UUID === s.uuid && !x.subtype);
      }
      if (!service) service = a.addService(new s.create(s.displayName, `hap-${data.aid}-${s.iid}`));
      used.add(service);
      // JSON cannot preserve undefined; AccessoryInformation is matched specially on restoration.
      subtypes[sid] = service.subtype;
      service.displayName = s.displayName || this.name;
      this.initAccessoryService(s, service);
    }
    // Only remove services previously managed by us, never unrelated history services.
    for (const old of a.services.slice()) {
      if (!used.has(old) && Object.values(context.services || {}).includes(old.subtype)) a.removeService(old);
    }
    a.context.homekitControl = { key: this.key, deviceId: this.deviceID, aid: data.aid,
      services: Object.fromEntries(data.services.filter(s => s.create).map(s => [s.iid, subtypes[String(s.iid)]])) };
    this.configured.add(a);
    this.addAditionalServices(data, a);
    if (fresh) { this.parent.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [a]); this.parent.accessories.push(a); }
  }
  async shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.online = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    if (this.fakeGato.timer) clearInterval(this.fakeGato.timer);
    await this.client?.shutdown();
    this.status("stopped");
  }
  protected addAditionalServices(accessoryServices: AcceessoryDescription, accesory: PlatformAccessory) {
    this.addFakeGatoService(accessoryServices.fakeGato, accesory);
  }

  private _findTempService(has: (type: WithUUID<new () => Service>, cType: WithUUID<new () => Characteristic>) => CharacteristicDescription | undefined): CharacteristicDescription | undefined {
    return has(this.parent.api.hap.Service.TemperatureSensor, this.parent.api.hap.Characteristic.CurrentTemperature);
  }

  private _findHumidityService(has: (type: WithUUID<new () => Service>, cType: WithUUID<new () => Characteristic>) => CharacteristicDescription | undefined): CharacteristicDescription | undefined {
    return has(this.parent.api.hap.Service.HumiditySensor, this.parent.api.hap.Characteristic.CurrentRelativeHumidity);
  }

  private _findPPMService(has: (type: WithUUID<new () => Service>, cType: WithUUID<new () => Characteristic>) => CharacteristicDescription | undefined): CharacteristicDescription | undefined {
    return [
      has(this.parent.api.hap.Service.CarbonDioxideSensor, this.parent.api.hap.Characteristic.CarbonDioxideLevel),
      has(this.parent.api.hap.Service.AirQualitySensor, this.parent.api.hap.Characteristic.PM2_5Density),
      has(this.parent.api.hap.Service.AirQualitySensor, this.parent.api.hap.Characteristic.PM10Density),
      has(this.parent.api.hap.Service.CarbonMonoxideSensor, this.parent.api.hap.Characteristic.CarbonMonoxideLevel),
    ].find((i) => i !== undefined);
  }

  private _findMotionService(has: (type: WithUUID<new () => Service>, cType: WithUUID<new () => Characteristic>) => CharacteristicDescription | undefined): CharacteristicDescription | undefined {
    return has(this.parent.api.hap.Service.MotionSensor, this.parent.api.hap.Characteristic.MotionDetected);
  }

  amendFakeGato() {
    const self = this;
    if (this.fakeGato.interval <= 0) {
      return;
    }
    //console.log('COUNT', this.supportedAccessories.length)
    this.supportedAccessories.forEach((acc: AcceessoryDescription) => {
      //console.log('ACC', idx)
      const has = function (type: WithUUID<new () => Service>, cType: WithUUID<new () => Characteristic>) {
        const s = acc.services.find((s: ServiceDescription) => s.create && s.create.UUID === type.UUID);
        if (s === undefined) {
          return undefined;
        }
        return s.characteristics.find((c) => c.create && c.create.UUID == cType.UUID);
      };

      //find fitting services
      acc.fakeGato = {
        room: {
          temp: self._findTempService(has),
          humidity: self._findHumidityService(has),
          ppm: self._findPPMService(has),
        },
        motion: {
          status: self._findMotionService(has),
        },
        history: [],
      };
      //console.log(idx, acc.fakeGato)

      //Add history Providers
      acc.fakeGato.history = [];
      if (acc.fakeGato.room.temp && acc.fakeGato.room.humidity && acc.fakeGato.room.ppm) {
        acc.fakeGato.history.push({ type: "room", data: acc.fakeGato.room, logService: undefined });
      } else if (acc.fakeGato.room.temp && acc.fakeGato.room.humidity) {
        acc.fakeGato.history.push({ type: "weather", data: { temp: acc.fakeGato.room.temp, humidity: acc.fakeGato.room.humidity }, logService: undefined });
      } else if (acc.fakeGato.motion.status) {
        acc.fakeGato.history.push({ type: "motion", data: acc.fakeGato.motion, logService: undefined });
      }
    });
  }

  addFakeGatoService(fakeGato: FakeGatoProvider, accessory: PlatformAccessory) {
    //add the fakeGato service if needed
    if (fakeGato && this.fakeGato.interval > 0) {
      const _accessory: any = accessory as any;
      _accessory.log = this.parent.log;
      fakeGato.history.forEach((h) => {
        const airQualityService = accessory.getService(this.parent.api.hap.Service.AirQualitySensor);

        if (airQualityService && h.type === "room" && h.data.ppm) {
          let airQualityC: Characteristic = airQualityService.getCharacteristic(this.parent.supported.EveAirQuality);

          const valueGetter = () => {
            if (h.data.ppm) {
              if (h.data.ppm.connect?.UUID === this.parent.api.hap.Characteristic.PM2_5Density.UUID || h.data.ppm.connect?.UUID === this.parent.api.hap.Characteristic.PM10Density.UUID) {
                //sems to be ug/m3 not ppm => convert like https://github.com/simont77/fakegato-history/issues/107
                return Math.max(450, h.data.ppm.value / 4.57);
              } else {
                return Math.max(450, h.data.ppm.value);
              }
            }

            return 0;
          };
          if (airQualityC === undefined) {
            this.parent.log.debug(`Adding Eve PPM Characteristic to '${this.name}', ${this.deviceID}, ${this.serviceConfig.uniquePrefix ? this.serviceConfig.uniquePrefix : ""} = ${valueGetter()}`);
            airQualityService.setCharacteristic(this.parent.supported.EveAirQuality, valueGetter());
            airQualityC = airQualityService.getCharacteristic(this.parent.supported.EveAirQuality);
          } else {
            this.parent.log.debug(`Updating initial value for Eve PPM Characteristic to ${valueGetter()}`);
            airQualityC.updateValue(valueGetter());
          }

          if (h.data.ppm.connect) {
            h.data.ppm.connect.chain = airQualityC;
            h.data.ppm.connect.chainValue = valueGetter;
          }
        }

        h.logService = accessory.getService(this.parent.supported.FakeGatoService.UUID);
        if (h.logService === undefined) {
          this.parent.log.debug(`Adding FakeGatoService '${h.type}' to '${this.name}', ${this.deviceID}, ${this.serviceConfig.uniquePrefix ? this.serviceConfig.uniquePrefix : ""}`);
          h.logService = new (this.parent.supported.FakeGatoService as any)(h.type, accessory, { size: 4000, disableTimer: true });
        }
      });
    }
  }

  fakegatoEvent() {
    const self = this;
    this.parent.log.debug("History refresh", this.name);

    this.supportedAccessories
      .filter((acc: AcceessoryDescription) => acc.fakeGato && acc.fakeGato.history.length > 0)
      .forEach((acc: AcceessoryDescription) => {
        acc.fakeGato.history.forEach((h) => {
          const data = {
            time: Math.round(new Date().valueOf() / 1000),
          };
          Object.keys(h.data).forEach((k) => {
            const c = h.data[k];

            if (c) {
              if (k === "ppm") {
                data[k] = Math.max(450, c.value);
              } else {
                data[k] = c.value;
              }

              //no auto updates, so trigger manual reads
              //if (c.source.perms && (c.source.perms.indexOf('ev')<0))
              if (c.connect) {
                this.parent.log.debug("History read", c.cname);

                self._updateCharacteristicValue(c.connect, c);
              }
            }
          });

          this.parent.log.debug("Writing history", h.type);
          h.logService.addEntry(data);
        });
      });
  }
}
