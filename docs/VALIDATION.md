# Validation

## Automated checks

Run `npm ci`, `npm run lint`, and `npm test`. GitHub Actions tests the existing Node
18/20/22 declarations against the locked Homebridge 1.9.0 dependency. Tests cover:

- Three identical outlet names with independent characteristic writes.
- Legacy accessory/service identity migration and a subsequent rename.
- Heat-only thermostat modes, target limits and step size.
- Waiting for write acknowledgement and reporting device errors.
- Late request completion, timeout, queue cancellation and no write replay.
- Event connection loss, new transport, rejected/late subscriptions, and restored notifications.
- Changed IP/port rediscovery and state refresh after recovery.
- Browser pairing UI: discovery, pairing, save failure recovery, and credential omission.
- Offline initial startup, recovery and state refresh.
- Private storage permissions and diagnostics without arbitrary values/secrets.

These checks use real HAP service definitions and simulated transport responses.
They do not establish radio/network interoperability with a Koogeek or Mysa.

## Actual host version check

Open plugin settings after a restart and download diagnostics. The runtime field
contains the Node version and Homebridge server version used by the plugin, rather
than a possibly different Node installation in your SSH shell. No access to Pedro's
live host was available during development. Do not broaden compatibility claims
until the actual runtime is checked.

## Koogeek O1US acceptance

1. Test one strip, preferably with ordinary lamps on its three sockets.
2. Confirm three controls. Toggle each independently; verify only its load changes.
3. Press each physical button and check that Apple Home updates without reopening the tile.
4. Restart Homebridge. Confirm all three controls and their assignments remain.
5. Rename the plugin's device after the first successful migration; restart and check
   that the accessory and outlet controls retain their assignments.
6. Disconnect the strip, then start Homebridge. Reconnect it and wait for automatic
   recovery (up to five minutes after a prolonged outage).
7. Interrupt Wi-Fi during operation. Confirm failures are reported, no delayed writes
   are replayed, and physical-button changes are received after recovery.

## Mysa INF-V1-0 acceptance

1. Export its service structure and verify supported modes/temperature range.
2. Read current and target temperatures and heating/idle state.
3. Change the target by one supported step and verify the device accepts it.
4. Change the target at the thermostat; check that Apple Home updates.
5. Verify Off/Heat only if the device reports those modes. Do not assume cooling.
6. Repeat restart and brief network-outage recovery checks.

## Pairing UI acceptance

- Discover on the correct network; paired devices must not offer a new pairing.
- Enter an incorrect PIN: no credentials should be logged, and a retry is possible.
- Pair correctly, save and restart. Confirm the plugin loads keys from its private store.
- If configuration saving fails after pairing, recover via Add saved device.
- Download diagnostics and verify no keys, PINs or raw characteristic values appear.
- Back up both Homebridge configuration and the homekit-control directory before migration.
