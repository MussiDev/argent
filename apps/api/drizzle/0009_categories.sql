CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"default_key" text,
	"name" text,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_owner_kind_unique" UNIQUE("id","owner_id","kind"),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('expense', 'income')),
	CONSTRAINT "categories_default_key_length_check" CHECK ("categories"."default_key" is null or char_length("categories"."default_key") between 1 and 60),
	CONSTRAINT "categories_name_length_check" CHECK ("categories"."name" is null or char_length("categories"."name") between 1 and 50),
	CONSTRAINT "categories_key_or_name_check" CHECK ("categories"."default_key" is not null or "categories"."name" is not null),
	CONSTRAINT "categories_icon_length_check" CHECK (char_length("categories"."icon") between 1 and 40),
	CONSTRAINT "categories_color_length_check" CHECK (char_length("categories"."color") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "category_defaults_seeded" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_owner_kind_fk" FOREIGN KEY ("parent_id","owner_id","kind") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_defaults_seeded" ADD CONSTRAINT "category_defaults_seeded_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_owner_default_key_unique" ON "categories" USING btree ("owner_id","default_key") WHERE "categories"."default_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_owner_name_unique" ON "categories" USING btree ("owner_id","kind",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'),lower("name")) WHERE "categories"."name" is not null;--> statement-breakpoint
CREATE INDEX "categories_owner_kind_parent_idx" ON "categories" USING btree ("owner_id","kind","parent_id");--> statement-breakpoint
CREATE INDEX "categories_owner_created_idx" ON "categories" USING btree ("owner_id","created_at","id");
--> statement-breakpoint
-- backfill default categories
-- Hand-written. Idempotent: only users without a category_defaults_seeded row get the set, and
-- the marker is written in the same statement, so a re-run (or a user who deleted a default) gets
-- nothing back. The list is the shared default catalog as of this migration, frozen here. It runs
-- before the guard trigger exists: rows written by a data-modifying CTE are invisible to a BEFORE
-- row trigger of the same statement (the composite foreign key is still checked).
WITH "defaults" ("key", "kind", "parent_key", "icon", "color") AS (
	VALUES
		('food', 'expense', NULL, 'utensils', 'orange'),
		('food.groceries', 'expense', 'food', 'utensils', 'orange'),
		('food.restaurants', 'expense', 'food', 'utensils', 'orange'),
		('food.delivery', 'expense', 'food', 'utensils', 'orange'),
		('transport', 'expense', NULL, 'car', 'blue'),
		('transport.fuel', 'expense', 'transport', 'car', 'blue'),
		('transport.public-transport', 'expense', 'transport', 'car', 'blue'),
		('transport.ride-hailing', 'expense', 'transport', 'car', 'blue'),
		('transport.parking', 'expense', 'transport', 'car', 'blue'),
		('home', 'expense', NULL, 'home', 'amber'),
		('home.rent', 'expense', 'home', 'home', 'amber'),
		('home.utilities', 'expense', 'home', 'home', 'amber'),
		('home.maintenance', 'expense', 'home', 'home', 'amber'),
		('health', 'expense', NULL, 'heart-pulse', 'red'),
		('health.health-insurance', 'expense', 'health', 'heart-pulse', 'red'),
		('health.pharmacy', 'expense', 'health', 'heart-pulse', 'red'),
		('health.doctor', 'expense', 'health', 'heart-pulse', 'red'),
		('entertainment', 'expense', NULL, 'clapperboard', 'violet'),
		('entertainment.outings', 'expense', 'entertainment', 'clapperboard', 'violet'),
		('entertainment.streaming', 'expense', 'entertainment', 'clapperboard', 'violet'),
		('entertainment.hobbies', 'expense', 'entertainment', 'clapperboard', 'violet'),
		('shopping', 'expense', NULL, 'shopping-bag', 'pink'),
		('shopping.clothing', 'expense', 'shopping', 'shopping-bag', 'pink'),
		('shopping.electronics', 'expense', 'shopping', 'shopping-bag', 'pink'),
		('shopping.gifts', 'expense', 'shopping', 'shopping-bag', 'pink'),
		('education', 'expense', NULL, 'graduation-cap', 'cyan'),
		('taxes', 'expense', NULL, 'receipt', 'slate'),
		('other-expenses', 'expense', NULL, 'ellipsis', 'slate'),
		('salary', 'income', NULL, 'banknote', 'green'),
		('freelance', 'income', NULL, 'laptop', 'teal'),
		('investment-returns', 'income', NULL, 'trending-up', 'lime'),
		('gifts-received', 'income', NULL, 'gift', 'pink'),
		('other-income', 'income', NULL, 'ellipsis', 'slate')
), "new_owners" AS (
	INSERT INTO "category_defaults_seeded" ("owner_id")
	SELECT "u"."id" FROM "users" "u"
	WHERE NOT EXISTS (SELECT 1 FROM "category_defaults_seeded" "s" WHERE "s"."owner_id" = "u"."id")
	RETURNING "owner_id"
), "roots" AS (
	INSERT INTO "categories" ("owner_id", "kind", "default_key", "icon", "color")
	SELECT "o"."owner_id", "d"."kind", "d"."key", "d"."icon", "d"."color"
	FROM "new_owners" "o" CROSS JOIN "defaults" "d"
	WHERE "d"."parent_key" IS NULL
	RETURNING "id", "owner_id", "default_key"
)
INSERT INTO "categories" ("owner_id", "kind", "parent_id", "default_key", "icon", "color")
SELECT "r"."owner_id", "d"."kind", "r"."id", "d"."key", "d"."icon", "d"."color"
FROM "defaults" "d" JOIN "roots" "r" ON "r"."default_key" = "d"."parent_key";
--> statement-breakpoint
-- Hand-written (drizzle-kit does not model triggers): owner, kind, parent and default key are
-- immutable after insert, and a parent cannot itself have a parent (defence in depth, FR-03 and
-- FR-04). The parent is only checked on insert because parent_id can never change afterwards.
CREATE FUNCTION "categories_guard"() RETURNS trigger AS $$
DECLARE
	grandparent_id uuid;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW."owner_id" IS DISTINCT FROM OLD."owner_id"
			OR NEW."kind" IS DISTINCT FROM OLD."kind"
			OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id"
			OR NEW."default_key" IS DISTINCT FROM OLD."default_key" THEN
			RAISE EXCEPTION 'categories.owner_id, kind, parent_id and default_key are immutable'
				USING ERRCODE = 'check_violation';
		END IF;
	ELSIF NEW."parent_id" IS NOT NULL THEN
		SELECT "parent_id" INTO grandparent_id FROM "categories" WHERE "id" = NEW."parent_id";
		IF grandparent_id IS NOT NULL THEN
			RAISE EXCEPTION 'a subcategory cannot have subcategories'
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "categories_guard_trigger" BEFORE INSERT OR UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION "categories_guard"();
