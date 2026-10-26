-- F4a: reservas. La sucursal decide si recibe reservas web y con qué reglas; cada reserva tiene un código para que el cliente la cancele.
ALTER TABLE restaurants ADD COLUMN reservations_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE restaurants ADD COLUMN reservation_minutes INT NOT NULL DEFAULT 90 CHECK (reservation_minutes BETWEEN 30 AND 360);
ALTER TABLE restaurants ADD COLUMN reservation_open TIME NOT NULL DEFAULT '11:00';
ALTER TABLE restaurants ADD COLUMN reservation_close TIME NOT NULL DEFAULT '22:00';
ALTER TABLE restaurants ADD COLUMN reservation_auto_confirm BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE restaurants ADD COLUMN reservation_max_party INT NOT NULL DEFAULT 12 CHECK (reservation_max_party BETWEEN 1 AND 100);

ALTER TABLE reservations ADD COLUMN code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex');
ALTER TABLE reservations ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE reservations ADD COLUMN created_by UUID REFERENCES users(id);
CREATE INDEX reservations_dia ON reservations(restaurant_id, starts_at);
