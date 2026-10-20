# Validation

## Automated checks

Run `npm ci`, `npm run lint`, and `npm test`. GitHub Actions tests the existing Node
18/20/22 declarations against the locked Homebridge 1.9.0 dependency. An additional
job installs the reported Node 24.22.0 / npm 11.19.1 / Homebridge 2.4.0 stack and tests
against its own HAP library (2.2.2), rather than a separate older HAP dependency.
Tests cover:

- Three identical outlet names with independent characteristic writes.
- Legacy accessory/service identity migration and a subsequent rename.
- Heat-only thermostat modes, target limits and step size.
- Fan and Fanv2 power/speed/direction, independent fan/light writes, optional controls,
  native constraints and permissions, device errors, notifications, and cached restart/recovery.
- Waiting for write acknowledgement and reporting device errors.
- Late request completion, timeout, queue cancellation and no write replay.
- Event connection loss, new transport, rejected/late subscriptions, and restored notifications.
- Changed IP/port rediscovery and state refresh after recovery.
- Browser pairing UI: discovery, pairing, save failure recovery, and credential omission.
- Offline initial startup, recovery and state refresh.
- Private storage permissions and diagnostics without arbitrary values/secrets.

These checks use real HAP service definitions and simulated transport responses.
They do not establish radio/network interoperability with a Koogeek, Mysa, or fan.

## Actual host version check

Open plugin settings after a restart and download diagnostics. The runtime field
contains the Node version and Homebridge server version used by the plugin, rather
than a possibly different Node installation in your SSH shell. The reported host is
Linux Mint 22.3 x64, Homebridge 2.4.0, Homebridge UI 5.29.0, Node 24.22.0 and npm
11.19.1. CI reproduces the Node/npm/Homebridge versions on Ubuntu; it does not run
on the live Linux Mint host or test the complete Homebridge UI 5.29.0 application.
The custom UI has browser-flow and server-IPC tests. Physical pairing and network
interoperability still require the acceptance checks below.

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

## Fan acceptance (including Hunter)

1. Export the service structure and verify which Fan or Fanv2 controls are reported.
   Keep Proxy all disabled to test explicit support. For an already paired device,
   restart Homebridge after upgrading; do not pair again.
2. Confirm fan and light controls both appear if the device exposes a light. Change
   each independently and verify commands reach the intended function.
3. Set several supported fan speeds and check the reported range and step size.
4. Test direction, mode, and swing only if present. Follow the manufacturer's
   instructions for reversing direction, including stopping the fan first if required.
5. Change speed/power with the manufacturer's app or remote and confirm Home updates.
6. Restart Homebridge and check that accessory/service identities and assignments remain.
7. Interrupt Wi-Fi, then restore it. Confirm errors are reported, old commands are not
   replayed, current state is refreshed, and external changes reach Home again.

## Pairing UI acceptance

- Discover on the correct network; paired devices must not offer a new pairing.
- Enter an incorrect PIN: no credentials should be logged, and a retry is possible.
- Pair correctly, save and restart. Confirm the plugin loads keys from its private store.
- If configuration saving fails after pairing, recover via Add saved device.
- Download diagnostics and verify no keys, PINs or raw characteristic values appear.
- Back up both Homebridge configuration and the homekit-control directory before migration.
