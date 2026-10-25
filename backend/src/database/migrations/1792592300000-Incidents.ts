import { MigrationInterface, QueryRunner } from 'typeorm';

export class Incidents1792592300000 implements MigrationInterface {
  name = 'Incidents1792592300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "monitors" ADD "consecutive_failures" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE TABLE "incidents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "monitor_id" uuid NOT NULL, "cause" character varying(255) NOT NULL, "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_incidents_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_incidents_monitor_open" ON "incidents" ("monitor_id", "resolved_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_incidents_monitor_id" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_incidents_monitor_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_incidents_monitor_open"`);
    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(`ALTER TABLE "monitors" DROP COLUMN "consecutive_failures"`);
  }
}
