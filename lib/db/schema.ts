// Uses the global `crypto` (available in Node 19+ and the Edge runtime) to
// generate UUIDs app-side. We can't depend on Postgres' gen_random_uuid()
// because the deployed PG is 12 and we don't have CREATE EXTENSION rights.
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  date,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const SCHEMA_NAME = process.env.DATABASE_SCHEMA ?? 'standardization';
export const app = pgSchema(SCHEMA_NAME);

export const users = app.table('users', {
  id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const emailVerificationTokens = app.table('email_verification_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const passwordResetTokens = app.table('password_reset_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const odkCredentials = app.table('odk_credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  baseUrl: text('base_url').notNull(),
  email: text('email').notNull(),
  encryptedToken: text('encrypted_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const testInstances = app.table('test_instances', {
  id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  name: text('name').notNull(),
  odkProjectId: integer('odk_project_id').notNull(),
  odkFormId: text('odk_form_id').notNull(),
  pullFromDate: date('pull_from_date').notNull(),
  supervisorEnumeratorId: integer('supervisor_enumerator_id').notNull().default(0),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const testGroups = app.table(
  'test_groups',
  {
    id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
    instanceId: uuid('instance_id').notNull().references(() => testInstances.id, { onDelete: 'cascade' }),
    groupNumber: integer('group_number').notNull(),
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    instanceGroupUnique: uniqueIndex('test_groups_instance_group_uniq').on(t.instanceId, t.groupNumber),
  }),
);

export const enumerators = app.table(
  'enumerators',
  {
    id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
    groupId: uuid('group_id').notNull().references(() => testGroups.id, { onDelete: 'cascade' }),
    enumeratorId: integer('enumerator_id').notNull(),
    displayName: text('display_name'),
    measuresMuac: boolean('measures_muac').notNull().default(true),
    measuresWeight: boolean('measures_weight').notNull().default(true),
    measuresHeight: boolean('measures_height').notNull().default(true),
  },
  (t) => ({
    groupEnumUnique: uniqueIndex('enumerators_group_enum_uniq').on(t.groupId, t.enumeratorId),
  }),
);

export const submissionOverrides = app.table(
  'submission_overrides',
  {
    id: uuid('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
    instanceId: uuid('instance_id').notNull().references(() => testInstances.id, { onDelete: 'cascade' }),
    submissionUuid: text('submission_uuid').notNull(),
    fieldName: text('field_name').notNull(),
    originalValue: text('original_value'),
    newValue: text('new_value').notNull(),
    setByUserId: uuid('set_by_user_id').notNull().references(() => users.id),
    setAt: timestamp('set_at', { withTimezone: true }).defaultNow().notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => ({
    instanceUuidIdx: index('overrides_instance_uuid_idx').on(t.instanceId, t.submissionUuid),
  }),
);

export const groupCompletionMarks = app.table(
  'group_completion_marks',
  {
    groupId: uuid('group_id').notNull().references(() => testGroups.id, { onDelete: 'cascade' }),
    enumeratorId: integer('enumerator_id').notNull(),
    markedCompleteBy: uuid('marked_complete_by').notNull().references(() => users.id),
    markedCompleteAt: timestamp('marked_complete_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.enumeratorId] }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TestInstance = typeof testInstances.$inferSelect;
export type TestGroup = typeof testGroups.$inferSelect;
export type Enumerator = typeof enumerators.$inferSelect;
export type SubmissionOverride = typeof submissionOverrides.$inferSelect;
