import { PromocionesService } from '../promociones/promociones.service';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { menuCategories, menuItems, restaurants } from '../database/esquema';
import { StorageService } from '../storage/storage.service';

export const MAX_FOTO_BYTES = 3 * 1024 * 1024;
const ALERGENOS = ['gluten', 'lacteos', 'huevo', 'pescado', 'mariscos', 'mani', 'frutos_secos', 'soya', 'apio', 'mostaza', 'sesamo', 'sulfitos'] as const;

export const Categoria = z.object({ nombre: z.string().trim().min(1).max(80), orden: z.number().int().min(0).max(9999).optional() }).strict();
/** Los precios se reciben con máximo 2 decimales y se guardan como NUMERIC: nunca float. */
const Precio = z.number().min(0).max(100000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');
export const Plato = z.object({
  categoriaId: z.string().uuid().nullable().optional(),
  nombre: z.string().trim().min(1).max(120),
  descripcion: z.string().trim().max(500).nullable().optional(),
  precio: Precio,
  alergenos: z.array(z.enum(ALERGENOS)).max(12).optional(),
  minutosPreparacion: z.number().int().min(0).max(600).nullable().optional(),
  disponible: z.boolean().optional(),
}).strict();
export const PlatoParcial = Plato.partial();

@Injectable()
export class MenuService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(BD) private readonly bd: Bd,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(PromocionesService) private readonly promos: PromocionesService,
  ) {}

  private vista(i: typeof menuItems.$inferSelect, promo?: { precio: string; promo: string | null }) {
    return { id: i.id, categoriaId: i.categoryId, nombre: i.name, descripcion: i.description, precio: i.price, precioVigente: promo?.precio ?? i.price, promocion: promo?.promo ?? null, alergenos: i.allergens, minutosPreparacion: i.prepMinutes, disponible: i.available, tieneFoto: !!i.photoKey };
  }

  categorias(t: Tenant) {
    return this.db.run(t, (tx) => tx.select().from(menuCategories).where(eq(menuCategories.restaurantId, t.restaurantId)).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
      .then((r) => r.map((c) => ({ id: c.id, nombre: c.name, orden: c.sortOrder }))));
  }

  crearCategoria(t: Tenant, por: string, d: z.infer<typeof Categoria>) {
    return this.db.run(t, async (tx) => {
      const [c] = await tx.insert(menuCategories).values({ restaurantId: t.restaurantId, name: d.nombre, sortOrder: d.orden ?? 0 }).returning();
      await auditar(tx, t.restaurantId, por, 'menu.categoria_creada', 'menu_category', c.id, d);
      return { id: c.id, nombre: c.name, orden: c.sortOrder };
    });
  }

  cambiarCategoria(t: Tenant, por: string, id: string, d: z.infer<typeof Categoria>) {
    return this.db.run(t, async (tx) => {
      const r = await tx.update(menuCategories).set({ name: d.nombre, ...(d.orden !== undefined && { sortOrder: d.orden }) }).where(and(eq(menuCategories.id, id), eq(menuCategories.restaurantId, t.restaurantId))).returning({ id: menuCategories.id });
      if (!r.length) throw new NotFoundException('Categoría no encontrada.');
      await auditar(tx, t.restaurantId, por, 'menu.categoria_cambiada', 'menu_category', id, d);
      return { ok: true };
    });
  }

  borrarCategoria(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const en = await tx.select({ id: menuItems.id }).from(menuItems).where(and(eq(menuItems.categoryId, id), eq(menuItems.restaurantId, t.restaurantId))).limit(1);
      if (en.length) throw new BadRequestException('La categoría tiene platos: muévelos o bórralos primero.');
      await tx.delete(menuCategories).where(and(eq(menuCategories.id, id), eq(menuCategories.restaurantId, t.restaurantId)));
      await auditar(tx, t.restaurantId, por, 'menu.categoria_borrada', 'menu_category', id);
      return { ok: true };
    });
  }

  platos(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = await tx.select().from(menuItems).where(eq(menuItems.restaurantId, t.restaurantId)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      const precios = await this.promos.precios(tx, t, r.map((i) => ({ id: i.id, precio: i.price })));
      return r.map((i) => this.vista(i, precios.get(i.id)));
    });
  }

  private async categoriaValida(tx: Bd, t: Tenant, id: string | null | undefined) {
    if (!id) return;
    const [c] = await tx.select({ id: menuCategories.id }).from(menuCategories).where(and(eq(menuCategories.id, id), eq(menuCategories.restaurantId, t.restaurantId)));
    if (!c) throw new BadRequestException('La categoría no existe en esta sucursal.');
  }

  crearPlato(t: Tenant, por: string, d: z.infer<typeof Plato>) {
    return this.db.run(t, async (tx) => {
      await this.categoriaValida(tx, t, d.categoriaId);
      const [i] = await tx.insert(menuItems).values({
        restaurantId: t.restaurantId, categoryId: d.categoriaId ?? null, name: d.nombre, description: d.descripcion ?? null, price: d.precio.toFixed(2),
        allergens: d.alergenos ?? [], prepMinutes: d.minutosPreparacion ?? null, available: d.disponible ?? true,
      }).returning();
      await auditar(tx, t.restaurantId, por, 'menu.plato_creado', 'menu_item', i.id, d);
      return this.vista(i);
    });
  }

  cambiarPlato(t: Tenant, por: string, id: string, d: z.infer<typeof PlatoParcial>) {
    return this.db.run(t, async (tx) => {
      await this.categoriaValida(tx, t, d.categoriaId);
      const cambios = {
        ...(d.categoriaId !== undefined && { categoryId: d.categoriaId }), ...(d.nombre !== undefined && { name: d.nombre }),
        ...(d.descripcion !== undefined && { description: d.descripcion }), ...(d.precio !== undefined && { price: d.precio.toFixed(2) }),
        ...(d.alergenos !== undefined && { allergens: d.alergenos }), ...(d.minutosPreparacion !== undefined && { prepMinutes: d.minutosPreparacion }),
        ...(d.disponible !== undefined && { available: d.disponible }),
      };
      if (!Object.keys(cambios).length) throw new BadRequestException('Nada que cambiar.');
      const [i] = await tx.update(menuItems).set(cambios).where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, t.restaurantId))).returning();
      if (!i) throw new NotFoundException('Plato no encontrado.');
      // El precio es dato sensible: queda quién lo cambió y a cuánto.
      await auditar(tx, t.restaurantId, por, d.precio !== undefined ? 'menu.precio_cambiado' : 'menu.plato_cambiado', 'menu_item', id, d);
      return this.vista(i);
    });
  }

  borrarPlato(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const usado = await tx.execute(sql`SELECT 1 FROM order_items WHERE menu_item_id = ${id} LIMIT 1`);
      if (usado.rows.length) throw new ConflictException('Este plato ya tiene pedidos: márcalo como agotado en vez de borrarlo.');
      const [i] = await tx.delete(menuItems).where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, t.restaurantId))).returning({ foto: menuItems.photoKey });
      if (!i) throw new NotFoundException('Plato no encontrado.');
      if (i.foto) await this.storage.borrar(i.foto);
      await auditar(tx, t.restaurantId, por, 'menu.plato_borrado', 'menu_item', id);
      return { ok: true };
    });
  }

  fotoDePlato(t: Tenant, por: string, id: string, datos: Buffer) {
    return this.db.run(t, async (tx) => {
      const [i] = await tx.select().from(menuItems).where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, t.restaurantId)));
      if (!i) throw new NotFoundException('Plato no encontrado.');
      const clave = await this.storage.guardarImagen(t.restaurantId, 'menu', datos, MAX_FOTO_BYTES);
      await tx.update(menuItems).set({ photoKey: clave }).where(eq(menuItems.id, id));
      if (i.photoKey) await this.storage.borrar(i.photoKey);
      await auditar(tx, t.restaurantId, por, 'menu.foto_cambiada', 'menu_item', id);
      return { ok: true };
    });
  }

  /** Menú público por slug: sin sesión. El slug se resuelve con la conexión de plataforma; el resto, ya con la sucursal fijada. */
  async publico(slug: string) {
    const [r] = await this.bd.select({ id: restaurants.id, nombre: restaurants.name, estado: restaurants.status, pedidosQr: restaurants.qrOrderingEnabled }).from(restaurants).where(eq(restaurants.slug, slug));
    if (!r || r.estado !== 'activo') throw new NotFoundException('Restaurante no encontrado.');
    const t: Tenant = { restaurantId: r.id, restaurantIds: [] };
    return this.db.run(t, async (tx) => {
      const cats = await tx.select().from(menuCategories).where(eq(menuCategories.restaurantId, r.id)).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
      const items = await tx.select().from(menuItems).where(eq(menuItems.restaurantId, r.id)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      const precios = await this.promos.precios(tx, t, items.map((i) => ({ id: i.id, precio: i.price })));
      const plato = (i: typeof items[number]) => ({
        id: i.id, nombre: i.name, descripcion: i.description, precio: i.price, precioVigente: precios.get(i.id)!.precio, promocion: precios.get(i.id)!.promo, alergenos: i.allergens, disponible: i.available,
        minutosPreparacion: i.prepMinutes, foto: i.photoKey ? `/api/v1/public/${slug}/foto/${i.id}` : null,
      });
      return {
        restaurante: { nombre: r.nombre, slug, pedidosQr: r.pedidosQr },
        categorias: [
          ...cats.map((c) => ({ id: c.id, nombre: c.name, platos: items.filter((i) => i.categoryId === c.id).map(plato) })),
          ...(items.some((i) => !i.categoryId) ? [{ id: null, nombre: 'Otros', platos: items.filter((i) => !i.categoryId).map(plato) }] : []),
        ].filter((c) => c.platos.length),
      };
    });
  }

  async fotoPublica(slug: string, itemId: string): Promise<{ datos: Buffer; clave: string }> {
    const [r] = await this.bd.select({ id: restaurants.id }).from(restaurants).where(and(eq(restaurants.slug, slug), eq(restaurants.status, 'activo')));
    if (!r) throw new NotFoundException();
    const [i] = await this.db.run({ restaurantId: r.id, restaurantIds: [] }, (tx) => tx.select({ k: menuItems.photoKey }).from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, r.id))));
    if (!i?.k) throw new NotFoundException();
    return { datos: await this.storage.leer(i.k), clave: i.k };
  }
}
