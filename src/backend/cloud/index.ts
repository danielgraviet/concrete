/**
 * Vendor-neutral entry point for the cloud data layer. Nothing exported here
 * pulls in Firebase; load `./firebase` lazily when a real backend is needed.
 */

export * from './CloudRepository';
export * from './AuthProvider';
export * from './errors';
export { InMemoryCloudRepository, type InMemoryCloudRepositoryOptions } from './memory/InMemoryCloudRepository';
