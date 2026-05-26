import type { QueryCacheChangeLogEntry, QueryCacheSnapshot, QueryCacheStorageAdapter } from '@shapeshift-labs/frontier-state-cache';
declare const CHANGE_LOG_MAGIC = "frontier-state-cache-file-change";
declare const RECORD_VERSION = 1;
export interface QueryCacheFileStorageOptions {
    directory?: string;
    snapshotFile?: string;
    changeLogFile?: string;
    now?: () => number;
    pretty?: boolean;
    fsync?: boolean;
    maxLogEntries?: number;
}
export interface QueryCacheFileStoragePaths {
    directory: string;
    snapshotPath: string;
    changeLogPath: string;
}
export interface QueryCacheFileChangeLogReadOptions {
    sinceSeq?: number;
    limit?: number;
}
export interface QueryCacheFileChangeLogRecord {
    magic: typeof CHANGE_LOG_MAGIC;
    version: typeof RECORD_VERSION;
    createdAt: number;
    entry: QueryCacheChangeLogEntry;
}
export interface QueryCacheFileStorageAdapter extends QueryCacheStorageAdapter {
    readonly directory: string;
    readonly snapshotPath: string;
    readonly changeLogPath: string;
    getPaths(): QueryCacheFileStoragePaths;
    appendChange(entry: QueryCacheChangeLogEntry): Promise<void>;
    readChangeLog(options?: QueryCacheFileChangeLogReadOptions): Promise<QueryCacheChangeLogEntry[]>;
    compact(snapshot?: QueryCacheSnapshot): Promise<void>;
    destroy(): Promise<void>;
}
export declare function createQueryCacheFileStorageAdapter(options?: string | QueryCacheFileStorageOptions): QueryCacheFileStorageAdapter;
export {};
//# sourceMappingURL=index.d.ts.map