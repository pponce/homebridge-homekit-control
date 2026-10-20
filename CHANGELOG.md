# Changes in 0.3.0-beta.4

- Support multiple same-type services (including three-outlet strips) using device/accessory/service IDs, with migration of existing cached UUIDs and service subtypes.
- Add standard thermostat services and characteristics. Preserve the source device's temperature constraints and operating modes.
- Await device writes and propagate per-characteristic HAP errors to HomeKit. Never automatically replay a timed-out write.
- Replace the shared timeout/retry queue with independently bounded requests; ignore late responses after timeout or shutdown.
- Retry devices offline during startup, restore notifications after disconnects, and refresh readable state every 30 seconds. Retry delays are capped; prolonged outages fall back to five-minute probes.
- Keep migrated accessory identity when the configured name changes; new accessories use device identity rather than their names.
- Unsubscribe correctly and await bounded shutdown. Clear reconnect and history timers.
- Add a custom settings page for discovery, pairing, saving and recovering saved pairings, connection checks, and secret-free service diagnostics.
- Store UI-created pairing keys privately under Homebridge storage. Keep legacy inline pairingData working. Stop printing PINs and private pairing data in the CLI.
- Add regression tests and CI for the existing Node 18/20/22 and locked Homebridge 1.9.0 baseline. No compatibility range is widened.

Hardware validation is still required for Koogeek O1US and Mysa INF-V1-0. These models are candidates, not certified/tested device claims.

- Rediscover changed IP addresses and HAP ports during recovery.
- Reset the transport after rejected subscriptions and unsubscribe to work around stale subscription state in the controller dependency.
