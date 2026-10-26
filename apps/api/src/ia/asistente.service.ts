import { BadGatewayException, BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { Tenant, TenantDb } from '../database/database.module';
import { EstadisticasService, GRUPOS, Grupo } from '../estadisticas/estadisticas.service';
import { AlertasService } from '../alertas/alertas.service';
import { Herramienta, IaService, Mensaje } from './ia.service';

export const Pregunta = z.object({ pregunta: z.string().trim().min(3).max(500) }).strict();
const MAX_VUELTAS = 6;
const MAX_RESULTADO = 6000;
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)));
const Rango = z.object({ desde: Fecha, hasta: Fecha }).strict().refine((r) => r.hasta >= r.desde && (Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000 <= 92, { message: 'El período debe tener entre 1 y 92 días.' });
const RangoGrupo = z.object({ desde: Fecha, hasta: Fecha, grupo: z.enum(GRUPOS) }).strict().refine((r) => r.hasta >= r.desde && (Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000 <= 92, { message: 'El período debe tener entre 1 y 92 días.' });
const Nada = z.object({}).strict();

const rango = { type: 'object', properties: { desde: { type: 'string', description: 'Fecha AAAA-MM-DD' }, hasta: { type: 'string', description: 'Fecha AAAA-MM-DD' } }, required: ['desde', 'hasta'] };
export const HERRAMIENTAS: Herramienta[] = [
  { name: 'resumen_periodo', description: 'Ingresos, pedidos, ticket promedio, costo de alimentos, merma y minutos de preparación de un período, con la variación contra el período anterior y la serie diaria.', input_schema: rango },
  { name: 'ventas_agrupadas', description: 'Ventas de un período agrupadas por hora, dia_semana, plato, categoria, mesero, canal o tipo de pedido.', input_schema: { ...rango, properties: { ...rango.properties, grupo: { type: 'string', enum: [...GRUPOS] } }, required: ['desde', 'hasta', 'grupo'] } },
  { name: 'ingenieria_menu', description: 'Platos vendidos en el período con unidades, ventas, costo por porción, margen y clase (estrella, caballo, puzzle, perro, sin_receta).', input_schema: rango },
  { name: 'estado_de_resultados', description: 'Ingresos, costos, gastos y resultado contable del período, por cuenta.', input_schema: rango },
  { name: 'alertas_abiertas', description: 'Alertas abiertas ahora (demoras de cocina, merma, margen bajo, caída de ventas, stock, precios) con su explicación.', input_schema: { type: 'object', properties: {} } },
  { name: 'stock_bajo', description: 'Insumos por debajo de su stock mínimo, con el stock actual.', input_schema: { type: 'object', properties: {} } },
  { name: 'cuentas', description: 'Totales por cobrar a clientes y por pagar a proveedores, cuánto está vencido y de cuántas cuentas se trata (sin nombres de personas).', input_schema: { type: 'object', properties: {} } },
  { name: 'proyeccion', description: 'Proyección de ingresos de las próximas 4 semanas con banda de confianza (o «datos insuficientes» si hay poca historia).', input_schema: { type: 'object', properties: {} } },
];

/**
 * Asistente de gestión: el dueño pregunta en lenguaje natural y Claude responde consultando herramientas de SOLO LECTURA, ejecutadas con la
 * sucursal fijada (RLS). No hay SQL libre ni escritura; cada respuesta lista sus fuentes. Los datos que salen son agregados, sin nombres de personas.
 */
@Injectable()
export class AsistenteService {
  constructor(
    @Inject(IaService) private readonly ia: IaService, @Inject(TenantDb) private readonly db: TenantDb, @Inject(EstadisticasService) private readonly est: EstadisticasService,
    @Inject(AlertasService) private readonly alertas: AlertasService, @Inject(ContabilidadService) private readonly conta: ContabilidadService,
  ) {}

  private async ejecutar(t: Tenant, nombre: string, entrada: unknown): Promise<unknown> {
    switch (nombre) {
      case 'resumen_periodo': { const r = Rango.parse(entrada); return this.est.resumen(t, r.desde, r.hasta); }
      case 'ventas_agrupadas': { const r = RangoGrupo.parse(entrada); return this.est.ventas(t, r.grupo as Grupo, r.desde, r.hasta); }
      case 'ingenieria_menu': { const r = Rango.parse(entrada); return this.est.menu(t, r.desde, r.hasta); }
      case 'estado_de_resultados': { const r = Rango.parse(entrada); return this.conta.estadoDeResultados(t, r); }
      case 'alertas_abiertas': Nada.parse(entrada ?? {}); return (await this.alertas.lista(t, { estado: 'abiertas' })).map((a) => ({ tipo: a.tipo, severidad: a.severidad, mensaje: a.mensaje, desde: a.creada }));
      case 'stock_bajo': Nada.parse(entrada ?? {}); return this.db.run(t, async (tx) => (await tx.execute(sql`SELECT i.name AS insumo, i.unit_code AS unidad, i.min_stock::text AS minimo, COALESCE(SUM(s.qty), 0)::text AS stock FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id
        WHERE i.restaurant_id = ${t.restaurantId} AND i.active AND i.min_stock > 0 GROUP BY i.id HAVING COALESCE(SUM(s.qty), 0) < i.min_stock ORDER BY i.name LIMIT 50`)).rows);
      case 'cuentas': Nada.parse(entrada ?? {}); return this.db.run(t, async (tx) => (await tx.execute(sql`SELECT direction, count(*) FILTER (WHERE paid < amount)::int AS cuentas, COALESCE(SUM(amount - paid) FILTER (WHERE paid < amount), 0)::numeric(14,2)::text AS saldo,
          COALESCE(SUM(amount - paid) FILTER (WHERE paid < amount AND due_on < (now() AT TIME ZONE 'America/La_Paz')::date), 0)::numeric(14,2)::text AS vencido FROM payables_receivables WHERE restaurant_id = ${t.restaurantId} AND voided_at IS NULL GROUP BY direction`)).rows);
      case 'proyeccion': Nada.parse(entrada ?? {}); return this.est.proyeccion(t, 4);
      default: throw new BadRequestException(`Herramienta desconocida: ${nombre}`);
    }
  }

  async preguntar(t: Tenant, por: string, pregunta: string) {
    const hoy = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
    const sistema = `Eres el asistente de gestión de un restaurante en Bolivia (moneda: bolivianos, Bs). Hoy es ${hoy}. Respondes las preguntas del dueño usando SOLO las herramientas de consulta: nunca inventes cifras; si las herramientas no devuelven datos suficientes, dilo con claridad. Responde en español, breve y concreto, con una tabla en Markdown cuando ayude a comparar. Termina con una línea «Fuente:» que nombre las herramientas y los períodos que usaste. No puedes modificar nada en el sistema. Si te piden algo fuera de la gestión del restaurante, di amablemente que no puedes ayudar con eso.`;
    const mensajes: Mensaje[] = [{ role: 'user', content: pregunta }];
    const fuentes: { herramienta: string; parametros: unknown }[] = []; let tokens = 0; let modelo = '';
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const r = await this.ia.enviar('asistente', 'asistente', { sistema, mensajes, herramientas: HERRAMIENTAS, maxTokens: 1024 }, t);
      tokens += r.entrada + r.salida; modelo = r.modelo;
      if (r.parada !== 'tool_use') {
        const respuesta = r.bloques.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
        await this.ia.auditar(t, por, 'asistente.pregunta', { herramientas: fuentes.map((f) => f.herramienta), tokens });
        return { respuesta: respuesta || 'No pude armar una respuesta con los datos disponibles.', fuentes, modelo, tokens };
      }
      mensajes.push({ role: 'assistant', content: r.bloques });
      const resultados = [];
      for (const b of r.bloques.filter((x) => x.type === 'tool_use')) {
        fuentes.push({ herramienta: b.name ?? '', parametros: b.input ?? {} });
        let contenido: string;
        try { contenido = JSON.stringify(await this.ejecutar(t, b.name ?? '', b.input)).slice(0, MAX_RESULTADO); }
        catch (e) { contenido = JSON.stringify({ error: (e as { message?: string }).message ?? 'No se pudo consultar', ayuda: 'Revisa los parámetros (fechas AAAA-MM-DD, máximo 92 días).' }); }
        resultados.push({ type: 'tool_result', tool_use_id: b.id ?? '', content: contenido });
      }
      mensajes.push({ role: 'user', content: resultados });
    }
    throw new BadGatewayException('La consulta necesitó demasiados pasos. Intenta con una pregunta más concreta.');
  }
}
