import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.config';

/** Used only by the TypeORM CLI (migration:run / migration:revert). */
export default new DataSource(buildTypeOrmOptions(process.env));
