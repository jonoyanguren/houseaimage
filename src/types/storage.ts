/** A photo that has been persisted somewhere the provider can fetch it. */
export interface StoredImage {
  /**
   * Where the photo now lives. Site-relative (`/uploads/x.jpg`) for local
   * disk, absolute (`https://…`) for an object store. Callers normalise it
   * with `toAbsoluteUrl` before handing it to a video provider.
   */
  url: string;
  /** Backend-specific handle, for deletion or lifecycle rules later. */
  key: string;
}

/**
 * Somewhere to put uploaded photos.
 *
 * Implementations must be stateless and safe to call concurrently — the upload
 * route saves a whole listing's worth of photos at once.
 */
export interface StorageProvider {
  readonly name: string;
  save(file: File): Promise<StoredImage>;
}
