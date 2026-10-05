/**
 * Shared access-scope rules. Keep these in ONE place so the same question is never answered
 * differently in two modules.
 */

/**
 * Whether a caller may see every batch rather than only the batches they are assigned to.
 *
 * TODO: this currently reuses the `batch.create` permission as an "oversee all" flag, which
 * means granting someone the right to create a batch also grants read access to every
 * student's grades. Replace it with a dedicated `batch.oversee` permission (a seed migration
 * is needed for that, so it is a separate decision).
 */
export const overseesAllBatches = (permissions: Set<string>) => permissions.has('batch.create');
