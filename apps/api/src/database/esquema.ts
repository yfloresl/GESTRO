import { bigint, boolean, date, inet, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Solo las tablas que F0 usa. El resto del DDL (66 tablas) se modela aquí al construir cada módulo.
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  nit: text('nit'),
  ownerEmail: text('owner_email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const restaurants = pgTable('restaurants', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  isBranch: boolean('is_branch').notNull().default(false),
  billingMode: text('billing_mode').notNull().default('recibo'),
  qrOrderingEnabled: boolean('qr_ordering_enabled').notNull().default(true),
  qrAutoSend: boolean('qr_auto_send').notNull().default(false),
  paidUntil: text('paid_until'),
  status: text('status').notNull().default('activo'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id'),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  description: text('description'),
});

export const userRoles = pgTable('user_roles', {
  restaurantId: uuid('restaurant_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.restaurantId, t.userId, t.roleId] }) }));

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  familyId: uuid('family_id').notNull().defaultRandom(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ip: inet('ip'),
  kyrosSub: text('kyros_sub'),
});

export const appConfig = pgTable('app_config', {
  clave: text('clave').primaryKey(),
  valorCifrado: text('valor_cifrado').notNull(),
  actualizadoPor: uuid('actualizado_por'),
  actualizado: timestamp('actualizado', { withTimezone: true }).notNull().defaultNow(),
});

export const kyrosLinks = pgTable('kyros_links', {
  issuer: text('issuer').notNull(),
  sub: text('sub').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.issuer, t.sub] }) }));

export const kyrosUsedTokens = pgTable('kyros_used_tokens', {
  jti: text('jti').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const userInvitations = pgTable('user_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdBy: uuid('created_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const auditLog = pgTable('audit_log', {
  restaurantId: uuid('restaurant_id'),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  after: jsonb('after'),
  ip: inet('ip'),
});

export const staffMembers = pgTable('staff_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  userId: uuid('user_id'),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  kind: text('kind').notNull().default('regular'),
  active: boolean('active').notNull().default(true),
});

export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  name: text('name').notNull(),
  managerStaffId: uuid('manager_staff_id'),
});

export const restaurantTables = pgTable('restaurant_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  areaId: uuid('area_id'),
  number: text('number').notNull(),
  seats: integer('seats').notNull(),
  qrToken: text('qr_token').notNull(),
  posX: integer('pos_x'),
  posY: integer('pos_y'),
  active: boolean('active').notNull().default(true),
});

export const serviceRequests = pgTable('service_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  tableId: uuid('table_id').notNull(),
  kind: text('kind').notNull(),
  comment: text('comment'),
  status: text('status').notNull().default('pendiente'),
  assignedWaiterId: uuid('assigned_waiter_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  attendedAt: timestamp('attended_at', { withTimezone: true }),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
});

export const menuCategories = pgTable('menu_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  categoryId: uuid('category_id'),
  name: text('name').notNull(),
  description: text('description'),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  photoKey: text('photo_key'),
  allergens: text('allergens').array().notNull().default([]),
  prepMinutes: integer('prep_minutes'),
  available: boolean('available').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  tableId: uuid('table_id'),
  waiterId: uuid('waiter_id'),
  channel: text('channel').notNull().default('mesero'),
  orderType: text('order_type').notNull().default('mesa'),
  ticketNumber: integer('ticket_number'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  deliveryAddress: text('delivery_address'),
  pickupAt: timestamp('pickup_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  status: text('status').notNull().default('borrador'),
  customerComment: text('customer_comment'),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const orderCounters = pgTable('order_counters', {
  restaurantId: uuid('restaurant_id').notNull(),
  day: date('day').notNull(),
  lastNumber: integer('last_number').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.restaurantId, t.day] }) }));

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  menuItemId: uuid('menu_item_id').notNull(),
  qty: numeric('qty', { precision: 8, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  note: text('note'),
  modifiers: jsonb('modifiers').notNull().default([]),
  course: smallint('course').notNull().default(1),
  status: text('status').notNull().default('enviado'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  voidReason: text('void_reason'),
  fromQr: boolean('from_qr').notNull().default(false),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

export const cashSessions = pgTable('cash_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  cashierId: uuid('cashier_id').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  openingAmount: numeric('opening_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  countedAmount: numeric('counted_amount', { precision: 12, scale: 2 }),
});

export const salesPayments = pgTable('sales_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  cashSessionId: uuid('cash_session_id'),
  method: text('method').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  document: text('document').notNull().default('recibo'),
  receiptNumber: bigint('receipt_number', { mode: 'number' }),
  customerName: text('customer_name'),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  voidReason: text('void_reason'),
});

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: uuid('restaurant_id').notNull(),
  number: bigint('number', { mode: 'number' }).notNull(),
  orderId: uuid('order_id'),
  customerName: text('customer_name'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});
