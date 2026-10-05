# ESP32 pool monitor simulation

Start with the complete instructions in [DEPLOYMENT.md](../DEPLOYMENT.md), section 7. Deploy the backend before attempting network telemetry.

Files: `sketch.ino`, `diagram.json`, `libraries.txt`, `config.example.h`, `root_ca.h`.
Copy the example to a private `config.h`; set the **full public HTTPS telemetry URL**, dedicated IoT key and `SM-001`. Generate `root_ca.h` with `npm run iot:certificate -- https://YOUR-SERVICE.onrender.com`. The placeholder CA intentionally prevents sending until configured. TLS certificates are verified; secrets are never printed to Serial.

| Simulated input | ESP32 pin | Behavior |
|---|---|---|
| Wave switch | GPIO18, INPUT_PULLUP | Right connects to GND: detection |
| Confirmation switch | GPIO19, INPUT_PULLUP | Right connects to GND: confirmation |
| Battery potentiometer | GPIO34 ADC | Maps ADC range to 0–100% |
| Red LED via 220 ohm resistor | GPIO23 | Both sensors active and monitoring enabled in last API reply |

Both switches must be right for `waterDetected=true`. These switches model digital sensor decisions; they are not a validated physical drowning detector. The potentiometer simulates battery level.

Wi-Fi: `Wokwi-GUEST`, empty password, channel 6. Public Gateway is sufficient; no private gateway or Windows service is used. The sketch waits for NTP before producing UTC timestamps and verifying TLS. Packets contain `deviceId`, `sampleId`, `source`, `waterDetected`, `batteryPercent`, `rssi`, `timestamp`.

Samples are sent every 20 seconds or on changed detection. A pending request is retried unchanged every 10 seconds after failure; successful retries are deduplicated by the server. Network operations block while connecting/sending, so hold simulated switch states until the serial monitor confirms acceptance. Brief changes during a network stall can be missed; there is no durable offline queue. After 24 hours an expired pending sample is discarded when the server rejects its timestamp. Stopping simulation loses its pending request.

Test sequence: both left → accepted dry sample → both right → accepted alert → view on phone → acknowledge → one left → accepted dry sample → both right → new alert. Keeping both high after acknowledgement does not create repeated alerts. Disable monitoring in the dashboard (after acknowledging active alerts) to test suppressed alerts; incoming samples still update battery/connection. The LED reflects monitoring status from the most recent successful API response.

Do not save real dashboard passwords or database tokens in Wokwi. A shared simulator can expose its device key; rotate a dedicated demo key after sharing. The website remains hosted when your PC is off, but a Wokwi browser session must be running somewhere to generate new measurements.
