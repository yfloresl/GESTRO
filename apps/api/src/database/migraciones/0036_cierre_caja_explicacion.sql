-- GST-C03: el cierre de caja con diferencia guarda la explicación del cajero (opcional en la API, la pide la pantalla). Aditiva y reversible.
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS difference_note TEXT;
