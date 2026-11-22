import { boolean, date, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const cms = pgSchema("cms");

const id = () => uuid("id").primaryKey().defaultRandom();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const pages = cms.table("pages", {
  id: id(),
  key: text("key").notNull(), // home, about, privacy, terms, cookies, cancellation
  title: text("title").notNull(),
  body: jsonb("body").notNull().default({}),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  version: integer("version").notNull().default(1), // legal pages are versioned (WEB-09)
  updatedBy: uuid("updated_by"),
  updatedAt: updated(),
}, (t) => [uniqueIndex("pages_key_version_uq").on(t.key, t.version)]);

export const faqs = cms.table("faqs", {
  id: id(),
  category: text("category").notNull().default("General"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const reviews = cms.table("reviews", {
  id: id(),
  authorName: text("author_name").notNull(),
  rating: integer("rating").notNull(),
  text: text("text").notNull(),
  reviewDate: date("review_date"),
  source: text("source").notNull().default("google"),
  active: boolean("active").notNull().default(false), // off until Medical Council guidance checked
  sortOrder: integer("sort_order").notNull().default(0),
});

export const announcements = cms.table("announcements", {
  id: id(),
  text: text("text").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

// Small admin-uploaded images stored in the database (no storage bill at launch)
export const media = cms.table("media", {
  id: id(),
  key: text("key").notNull(),
  contentType: text("content_type").notNull(),
  data: text("data").notNull(), // base64, resized WebP <= 200 KB
  alt: text("alt"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("media_key_uq").on(t.key)]);
