-- F4c: turnos y asistencia. El choque de horarios de una misma persona ya lo impide la restricción de exclusión de `shifts`.
ALTER TABLE shifts ADD COLUMN notes TEXT;
ALTER TABLE shifts ADD COLUMN created_by UUID REFERENCES users(id);
CREATE INDEX shifts_fecha ON shifts(restaurant_id, starts_at);
CREATE INDEX shifts_evento ON shifts(event_id) WHERE event_id IS NOT NULL;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_costos_validos CHECK ((hourly_cost IS NULL OR hourly_cost >= 0) AND (monthly_salary IS NULL OR monthly_salary >= 0));
