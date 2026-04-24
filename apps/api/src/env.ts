export interface Env {
  DB: D1Database;
  HASH_INDEX: KVNamespace;
  VOTER_FILES: R2Bucket;
  JWT_SECRET: string;
  COOKIE_NAME?: string;
  COOKIE_DOMAIN?: string;
}
