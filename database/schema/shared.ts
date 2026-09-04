import { customType, pgSchema } from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

export const bytea = customType<{
  data: Buffer;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  }
});

export const jsonObjectDefault = "'{}'::jsonb";
export const emptyTextArrayDefault = "'{}'::text[]";
