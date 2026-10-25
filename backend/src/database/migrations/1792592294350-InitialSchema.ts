import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1792592294350 implements MigrationInterface {
    name = 'InitialSchema1792592294350'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(254) NOT NULL, "password_hash" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."monitors_method_enum" AS ENUM('HEAD', 'GET')`);
        await queryRunner.query(`CREATE TYPE "public"."monitors_status_enum" AS ENUM('pending', 'up', 'down', 'paused')`);
        await queryRunner.query(`CREATE TABLE "monitors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "url" character varying(2048) NOT NULL, "host" character varying(253) NOT NULL, "method" "public"."monitors_method_enum" NOT NULL DEFAULT 'HEAD', "interval_seconds" integer NOT NULL DEFAULT '300', "timeout_ms" integer NOT NULL DEFAULT '10000', "expected_status_code" integer, "is_active" boolean NOT NULL DEFAULT true, "status" "public"."monitors_status_enum" NOT NULL DEFAULT 'pending', "last_checked_at" TIMESTAMP WITH TIME ZONE, "next_check_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_monitors_user_url" UNIQUE ("user_id", "url"), CONSTRAINT "chk_monitors_timeout" CHECK ("timeout_ms" BETWEEN 1000 AND 30000), CONSTRAINT "chk_monitors_interval" CHECK ("interval_seconds" >= 60), CONSTRAINT "PK_193902e2013887310490284cdbe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_monitors_due" ON "monitors"  ("is_active", "next_check_at") `);
        await queryRunner.query(`ALTER TABLE "monitors" ADD CONSTRAINT "FK_e14d6e8ea5eb39ace280a3b7c23" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "monitors" DROP CONSTRAINT "FK_e14d6e8ea5eb39ace280a3b7c23"`);
        await queryRunner.query(`DROP INDEX "public"."idx_monitors_due"`);
        await queryRunner.query(`DROP TABLE "monitors"`);
        await queryRunner.query(`DROP TYPE "public"."monitors_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."monitors_method_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
