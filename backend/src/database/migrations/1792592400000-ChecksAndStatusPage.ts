import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Day 3: what the frontend needs.
 *  - checks: per-check history (response time, up/down) for charts and uptime %.
 *  - users.status_slug: the unguessable id in a public status page URL.
 *  - users.status_page_title: heading shown on that page.
 *  - monitors.is_public: opt-in per monitor; nothing is public by default.
 */
export class ChecksAndStatusPage1792592400000 implements MigrationInterface {
  name = 'ChecksAndStatusPage1792592400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "checks" ("id" BIGSERIAL NOT NULL, "monitor_id" uuid NOT NULL, "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_up" boolean NOT NULL, "response_time_ms" integer, "status_code" smallint, "cause" character varying(255), CONSTRAINT "PK_checks_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_checks_monitor_time" ON "checks" ("monitor_id", "checked_at")`,
    );
    // Rows arrive in checked_at order, so a BRIN index (a few KB, vs. MBs for a
    // B-tree) is enough for the daily "delete everything older than 31 days" job.
    await queryRunner.query(
      `CREATE INDEX "idx_checks_checked_at_brin" ON "checks" USING BRIN ("checked_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "checks" ADD CONSTRAINT "FK_checks_monitor_id" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // A volatile DEFAULT is evaluated per row, so existing users each get
    // their own random slug in the same statement — no separate backfill step.
    await queryRunner.query(
      `ALTER TABLE "users" ADD "status_slug" character varying(32) NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "uq_users_status_slug" UNIQUE ("status_slug")`,
    );

    await queryRunner.query(`ALTER TABLE "users" ADD "status_page_title" character varying(80)`);

    await queryRunner.query(`ALTER TABLE "monitors" ADD "is_public" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "monitors" DROP COLUMN "is_public"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status_page_title"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "uq_users_status_slug"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status_slug"`);
    await queryRunner.query(`ALTER TABLE "checks" DROP CONSTRAINT "FK_checks_monitor_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_checks_checked_at_brin"`);
    await queryRunner.query(`DROP INDEX "public"."idx_checks_monitor_time"`);
    await queryRunner.query(`DROP TABLE "checks"`);
  }
}
