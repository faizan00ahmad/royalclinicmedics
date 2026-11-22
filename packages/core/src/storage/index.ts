/**
 * EXT-10. File storage with two buckets defined from day one:
 *  - "public":  website images. Not used in Phase 1 (images live in the repo and the cms.media table).
 *  - "private": clinical documents, referral letters, certificates. Phase 2 only. Never public, always signed links.
 * Phase 1 has no storage service at all, so any call fails clearly instead of pretending to work.
 */
export type Bucket = "public" | "private";

export interface StorageService {
  put(bucket: Bucket, key: string, data: Buffer, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Buffer>;
  remove(bucket: Bucket, key: string): Promise<void>;
  /** Time-limited link for the private bucket. */
  signedUrl(bucket: Bucket, key: string, expiresInSeconds: number): Promise<string>;
}

class NotConfiguredStorage implements StorageService {
  private fail(): never { throw new Error("File storage is not configured. It is added in Phase 2."); }
  async put(): Promise<void> { this.fail(); }
  async get(): Promise<Buffer> { return this.fail(); }
  async remove(): Promise<void> { this.fail(); }
  async signedUrl(): Promise<string> { return this.fail(); }
}

export function createStorage(): StorageService {
  return new NotConfiguredStorage();
}
