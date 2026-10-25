import { sql } from 'drizzle-orm';

/** Arreglo uuid[] como un solo parámetro (Drizzle expande un arreglo de JS en una lista de valores, no en un arreglo de Postgres). Solo acepta UUID: no hay forma de inyectar texto. */
export const uuidArray = (ids: string[]) => {
  for (const id of ids) if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('uuid inválido');
  return sql`${'{' + ids.join(',') + '}'}::uuid[]`;
};
