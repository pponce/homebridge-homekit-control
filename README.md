<div align="center">

<a href="https://github.com/minamoanes/homebridge-homekit-control">
    <img src="https://github.com/minamoanes/homebridge-homekit-control/blob/master/homebridge-homekit-control.png" width="250" />
</a>

# Homebridge HomeKit Control

## This fork

This fork adds connection recovery, independent controls for repeated services,
standard thermostat support, and a pairing/diagnostics screen. See [CHANGELOG.md](CHANGELOG.md).

**Koogeek O1US and Mysa INF-V1-0 have not yet been tested on physical hardware.**
Automated tests cover a three-outlet accessory and a heat-only thermostat. Your device's
reported services and firmware determine which controls are available.

## Pair from the settings screen

1. Install the plugin and open its settings in Homebridge UI.
2. Keep the accessory on Wi-Fi. If it is already paired directly with Apple Home,
   remove that pairing first. This is a migration: existing rooms/scenes/automations
   may need to be updated after it is exposed through Homebridge.
3. Click **Discover devices**, select an available accessory, enter its HomeKit code,
   and choose **Pair and save device**.
4. Restart Homebridge. Use **Connection status**, **Test connection**, or
   **Download diagnostics** to check the result.

If pairing succeeds but saving configuration fails, reopen settings and use
**Add saved device**. Do not pair it a second time. Pairing credentials are saved
immediately to a private file in `<Homebridge storage>/homekit-control/pairings/`.
Back up that folder with your Homebridge configuration. The PIN is not saved.
Existing configurations containing `pairingData` remain supported.

The schema form remains available under **Show device settings**. Settings changes
require **Save settings** and a Homebridge restart. Removing a configuration entry
does not unpair the physical accessory or delete its saved keys. To return it to direct
Apple Home pairing, use the manufacturer's HomeKit reset procedure.

## Identity and migration

Existing cached accessories are adopted using their old configured name, and their
UUIDs are retained. **Keep the name and prefix unchanged for the first restart after
upgrading.** After migration, changing the name retains identity. If you already
changed the name before upgrading, enter the old name in **Previous configured name**.
Keep **Prefix** unchanged; it is part of the device's namespace.

New accessories are keyed by physical device ID and accessory ID. Repeated services
use service IDs instead of names. Existing unambiguous service subtypes are retained
so rooms and automations survive normal upgrades. Duplicate services previously lost
by the old plugin appear as new controls and need their own Home assignments.

## Reliability and diagnostics

HomeKit writes wait for the device's protocol response. A failed or timed-out write
returns an error, and is not automatically replayed. A response acknowledges a protocol
write, not a separate physical measurement of the load or heating element.

Devices unavailable at startup remain cached and are retried automatically. Reads
refresh after reconnect, and event subscriptions are restored. Retry delays increase
up to one minute; after six failed recovery attempts a probe runs every five minutes.
Readable state is refreshed every 30 seconds to detect silent outages. Recovery also
uses mDNS to find changed IP addresses or HAP ports by device ID. If mDNS is unavailable
(for example across isolated VLANs), the last known/configured endpoint is retried.

Runtime status reports the actual plugin process's Node and Homebridge versions.
**Test connection** opens a separate connection; success does not prove that the
running plugin's subscriptions are healthy. Exports include device names/IDs, service
and characteristic IDs/types/constraints, runtime versions, and connection timestamps.
They exclude pairing credentials, PINs, arbitrary characteristic values and vendor data.

Thermostats retain their native supported modes and temperature limits. No heating
control algorithm is moved into Homebridge. Manufacturer features not exposed over
HomeKit (such as special floor-sensor settings or energy reporting) are not added.
BLE HomeKit and Matter are not supported by this plugin.

## Testing and compatibility

See [docs/VALIDATION.md](docs/VALIDATION.md) for automated checks and hardware acceptance
steps. The existing supported-version declarations are unchanged. The CI baseline
uses locked Homebridge 1.9.0 on Node 18, 20 and 22; this is compatibility testing, not a
recommendation to install an end-of-life Node release. Newer Node or Homebridge releases
need their own test results before being advertised as supported.


[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://badgen.net/npm/v/homebridge-homekit-control)](https://www.npmjs.com/package/homebridge-homekit-control)
[![downloads](https://badgen.net/npm/dt/homebridge-homekit-control)](https://www.npmjs.com/package/homebridge-homekit-control)
[![donate](https://badgen.net/badge/PayPal/donate/003087?icon=https://simpleicons.now.sh/paypal/fff)](https://paypal.me/MinaMoanes)

</div>

**HomeKit Control** lets you control <img src="https://github.com/minamoanes/homebridge-homekit-control/blob/master/icons/homekit-icon.svg" width="15" /> Apple HomeKit Exclusive accessories through Homebridge, This is especially useful to gain all the benefits of Homebridge alongside controlling them using other services and plugins through Homebridge, such as:

- <img src="https://github.com/minamoanes/homebridge-homekit-control/blob/master/icons/google-assistant-icon.svg" width="15" /> Google Assistant (using `homebridge-gsh` plugin)
- <img src="https://github.com/minamoanes/homebridge-homekit-control/blob/master/icons/alexa-icon.svg" width="15" /> Amazon Alexa (using `homebridge-alexa` plugin)
- and many more...

## Supported Devices

The Plugin currently supports the following Services provided by WLAN-based HomeKit enabled devices:

- Switch
- Outlet (including multiple outlet services)
- Thermostat (device-reported modes and limits)
- Motion Sensors
- Temperatur Sensors
- Humidity Sensors
- CO2 Sensors
- Carbon Monoxid Sensors
- Air Quality Sensors
- Ambient Light Sensors
- Light Bulbs
- Battery/Charging State
- Garage Door Opener (Thanks to vmummer)

Please note that BLE is currently not supported, as it seems to be unstable when multiple BLE-enabled Plugins are installed. All supported sensors on any configured device are automatically discovered and added when Homebridge starts up.

## Install this development fork

The changes in this fork are not published to the upstream npm package. To build a
package for testing with your Homebridge installation:

```sh
git clone --branch reliability-pairing-thermostats https://github.com/pponce/homebridge-homekit-control.git
cd homebridge-homekit-control
npm ci
npm pack
```

Use the resulting `.tgz` with the installation method appropriate to your Homebridge
host/container. Keep a backup of the existing configuration, cached accessories and
pairing store. Installing `homebridge-homekit-control` from the npm registry still
installs the upstream release, not this branch.

## Legacy command-line pairing

To pair your devices with Homebridge HomeKit Control, follow these steps:

1.  Discover Devices:
    ```
    homekitPair
    ```
    - You could also: `homekitPair [network] [interface]`, for example: `homekitPair -i wlan0`
2.  Select the device you want to pair, and enter the pairing code (including `-`, example `123-45-678`).
3.  Enter a filename to save pairing information in JSON format.
4.  In the JSON file, you'll find the following information:

    ```
    {
        "id": "device id",
        "name": "device name",
        "address": "device ip",
        "port": device-port,
        "pairingData": {
            "AccessoryPairingID": "xxx",
            "AccessoryLTPK": "xxx",
            "iOSDevicePairingID": "xxx",
            "iOSDeviceLTSK": "xxx",
            "iOSDeviceLTPK": "xxx"
        },
        "accessories": {
            "accessories": [...]
        }
    }
    ```

5.  Note down the `"id"`, `"name"`, `"address"`, `"port"` and `"pairingData"` from the JSON file.
6.  Go to **Plugins** page and Click on the **SETTINGS** button under **Homebridge Homekit Control** and fille out the information we noted from the JSON file in the previous steps
    - For further information, please refer to the [Config](#config) section for details.

## Config

This Plugin supports the Configuration Interface in Homebridge UI (homebridge-config-ui-x). Simply add a new Device and paste the values you obtained above.

Here are some additional configuration parameters, not obtained by the Device Pairing:

- `services.enableHistory` (_boolean_): **true** will enable fakeGato for compatible Sensors. This will allow you to view a history in the EVE-App
- `services.historyInterval` (optional, _numeric_): Determins the Interval used to take readings. The valus range is **[30, 600]**. The default value is **600**
- `services.proxyAll`(optional, _boolean_): By default we proxy the explicitly registered services and characteristics. When this mode is enabled, all available services and characteristics are proxied. Be carefull when activating, this may cause damage to your devices. The default value is **false**
- `services.uniquePrefix`(optional, _string_): When a device is added to multiple HomeBridge instances in the same network, you will need to provide a unique prefix. Otherwise Eve-App will get confused.

#### Example

```
{
    "platforms": [
        {
            "platform": "HomekitControl",
            "services": [
                {
                    "id": "device id",
                    "name": "device name",
                    "address": "device ip",
                    "port": "device port",
                    "enableHistory": false,
                    "pairingData": {
                        "AccessoryPairingID": "xxx",
                        "AccessoryLTPK": "xxx",
                        "iOSDevicePairingID": "xxx",
                        "iOSDeviceLTSK": "xxx",
                        "iOSDeviceLTPK": "xxx"
                    }
                }
            ]
        }
    ]
}
```

## Pairing unavailable: `M2: Error: 6`

`M2` is the accessory's first reply during Pair Setup. Error `6` is HomeKit's
**Unavailable** response: the accessory is refusing this pairing method. A common
cause is that it is already paired. This is different from an incorrect setup code
(authentication error `2`). The plugin cannot bypass the accessory's pairing state.

- If this plugin already has saved credentials, reuse them; do not pair again.
- If the accessory is currently in Apple Home, remove its direct pairing **while it
  is online**, then click **Discover devices** again in plugin settings. Pair only
  when it advertises itself as available. Re-adding through Homebridge can require
  updating rooms, scenes and automations.
- If the accessory is new and already connected to Wi-Fi and available to pair,
  pair directly in the plugin. There is no need to add it to Apple Home first.
- Some accessories need Apple Home or their manufacturer's setup flow to join Wi-Fi.
  Adding to Apple Home and then removing it is a workaround for that initial setup,
  not a mandatory pairing sequence. Whether Wi-Fi is retained depends on the device.
- If it still reports unavailable, use the manufacturer's HomeKit pairing/reset
  procedure. A full factory reset can also remove Wi-Fi settings.

The settings page disables pairing for devices advertised as already paired, enforces
that check on the server, and explains error 6 if the device rejects the request.
Discovery can become stale, so it cannot prevent every refusal. It does not reset or
unpair devices automatically, or repeatedly retry pairing codes. Manual JSON copying
is unnecessary with the settings page; `homekitPair` remains an optional legacy tool.

Protocol reference: [HAP-NodeJS pairing handler and error codes](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/HAPServer.ts).

## Tested Accesories

(!!! Use at your own risk !!!)

- Quingping Air Monitor Lite (Cleargrass Luftdetektor Lite, Cleargrass Air Monitor Lite)
- Nanoleaf Aurora / Light Panels
- Gardena Smart Control Hub
  - Gardena Smart Irrigation Control
  - Gardena Smart Sensor II

Please let me know if you use this plugin and got it to work with a new HomeKit-Accesory that is not listed above

## Building for developers

The project was converted to the build system from https://github.com/homebridge/homebridge-plugin-template. Visual Studio Code is set up to lint on save.

Using `npm run dev` will launch the develop environment, where your code is automatically compiled on save and the local homebridge server is automatically restarted.

The command `npm rund build` will trigger the compilation of your project manually.
