import {
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  SCHEMA_V4,
  SCHEMA_V5,
  SCHEMA_V6,
  SCHEMA_V7,
  SCHEMA_V8,
  SCHEMA_V9,
  SCHEMA_V10,
  SCHEMA_V11,
  SCHEMA_V12,
} from '@/db/schema';

const SCHEMAS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12];

/** Schema SQL from version 1 up to and including `version`, so tests need not list every constant. */
export function schemaSql(version: number = SCHEMAS.length): string {
  return SCHEMAS.slice(0, version).join('\n');
}

/** Sequences as a fresh install seeds them. */
export const SEED_SEQUENCES_SQL = "INSERT OR IGNORE INTO sequences(name,high_water_mark) VALUES ('CSR',0),('BS',0),('PA',0),('QT',0),('DF',0);";
