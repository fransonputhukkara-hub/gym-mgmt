-- Initial schema: eSSL K90 ADMS receiver.
-- Device PIN is an external identifier only, never an authentication credential.


CREATE TABLE devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number      TEXT NOT NULL,
  model              TEXT,
  firmware_version   TEXT,
  device_name        TEXT,
  location           TEXT,
  ip_address         TEXT,                       -- observed connection address
  status             TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
  last_seen_at       TIMESTAMPTZ,
  registered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attlog_stamp  TEXT,                       -- last ATTLOG Stamp acknowledged (device-defined, opaque)
  is_simulated       BOOLEAN GENERATED ALWAYS AS (serial_number LIKE 'SIM-%') STORED,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT devices_serial_number_key UNIQUE (serial_number)
);

CREATE TABLE employees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_pin     TEXT NOT NULL,
  employee_name  TEXT,
  department     TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_device_pin_key UNIQUE (device_pin)
);

CREATE TABLE raw_device_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         UUID REFERENCES devices(id) ON DELETE SET NULL,
  serial_number     TEXT,                        -- as claimed in the request, even if device was rejected
  request_kind      TEXT NOT NULL DEFAULT 'other',
  endpoint          TEXT NOT NULL,               -- path + query string exactly as received
  http_method       TEXT NOT NULL,
  source_ip         TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  headers_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_body          TEXT NOT NULL DEFAULT '',
  processing_status TEXT NOT NULL DEFAULT 'received'
                    CHECK (processing_status IN ('received','processed','partial','failed','rejected','unhandled')),
  processing_error  TEXT
);
CREATE INDEX raw_requests_received_idx ON raw_device_requests (received_at DESC);
CREATE INDEX raw_requests_device_idx   ON raw_device_requests (device_id, received_at DESC);
CREATE INDEX raw_requests_status_idx   ON raw_device_requests (processing_status, received_at DESC);

CREATE TABLE attendance_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id            UUID NOT NULL REFERENCES devices(id),
  employee_id          UUID REFERENCES employees(id),
  employee_pin         TEXT NOT NULL,
  attendance_timestamp TIMESTAMPTZ NOT NULL,     -- device local time interpreted in DEVICE_TIMEZONE
  attendance_time_raw  TEXT NOT NULL,            -- device time exactly as sent (no timezone)
  server_received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_method  TEXT,                     -- raw device code, unmapped
  punch_status         TEXT,                     -- raw device code, unmapped
  work_code            TEXT,
  device_event_id      TEXT,
  event_fingerprint    TEXT NOT NULL,
  raw_request_id       UUID NOT NULL REFERENCES raw_device_requests(id),
  processing_status    TEXT NOT NULL DEFAULT 'processed',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_events_fingerprint_key UNIQUE (device_id, event_fingerprint)
);
CREATE UNIQUE INDEX attendance_events_device_event_id_key
  ON attendance_events (device_id, device_event_id) WHERE device_event_id IS NOT NULL;
CREATE INDEX attendance_events_ts_idx     ON attendance_events (attendance_timestamp DESC);
CREATE INDEX attendance_events_pin_idx    ON attendance_events (employee_pin, attendance_timestamp DESC);
CREATE INDEX attendance_events_device_idx ON attendance_events (device_id, attendance_timestamp DESC);
CREATE INDEX attendance_events_raw_idx    ON attendance_events (raw_request_id);
CREATE INDEX attendance_events_recv_idx   ON attendance_events (server_received_at DESC);

CREATE TABLE device_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    UUID REFERENCES devices(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  message      TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_logs_device_idx ON device_logs (device_id, created_at DESC);
CREATE INDEX device_logs_created_idx ON device_logs (created_at DESC);
