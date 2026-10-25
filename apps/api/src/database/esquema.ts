import { boolean, inet, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
