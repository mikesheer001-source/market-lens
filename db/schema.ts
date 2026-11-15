import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
export const marketCache = sqliteTable("market_cache", {
  owner: text("owner").notNull(), symbol: text("symbol").notNull(),
  payload: text("payload").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.symbol] })]);
export const preferences = sqliteTable("preferences", {
  owner: text("owner").primaryKey(), payload: text("payload").notNull(), updatedAt: integer("updated_at").notNull(),
});
export const connections = sqliteTable("connections", {
  owner: text("owner").primaryKey(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
