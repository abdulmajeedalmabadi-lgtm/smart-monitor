ALTER TABLE devices ADD COLUMN alarm_armed INTEGER NOT NULL DEFAULT 1 CHECK(alarm_armed IN (0,1));
ALTER TABLE devices ADD COLUMN input_source TEXT NOT NULL DEFAULT 'simulation' CHECK(input_source IN ('simulation','wokwi','esp32'));

CREATE TABLE telemetry (
  sample_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  source TEXT NOT NULL CHECK(source IN ('wokwi','esp32')),
  water_detected INTEGER NOT NULL CHECK(water_detected IN (0,1)),
  battery_percent REAL NOT NULL CHECK(battery_percent BETWEEN 0 AND 100),
  rssi INTEGER NOT NULL CHECK(rssi BETWEEN -120 AND 0),
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
) STRICT;
CREATE INDEX telemetry_device_time ON telemetry(device_id, observed_at DESC, received_at DESC);

CREATE TABLE alerts_next (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  pool_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('simulation','legacy_import','wokwi','esp32')),
  occurred_at TEXT NOT NULL,
  acknowledged_at TEXT,
  CHECK(acknowledged_at IS NULL OR acknowledged_at >= occurred_at)
) STRICT;
INSERT INTO alerts_next SELECT * FROM alerts;
DROP TABLE alerts;
ALTER TABLE alerts_next RENAME TO alerts;
CREATE INDEX alerts_device_time ON alerts(device_id, occurred_at DESC);
CREATE UNIQUE INDEX alerts_one_active ON alerts(device_id) WHERE acknowledged_at IS NULL;
