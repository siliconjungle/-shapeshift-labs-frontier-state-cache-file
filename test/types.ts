import {
  createQueryCacheFileStorageAdapter,
  type QueryCacheFileStorageAdapter,
  type QueryCacheFileStorageOptions
} from '../dist/index.js';
import type {
  QueryCacheChangeLogEntry,
  QueryCacheStorageAdapter
} from '@shapeshift-labs/frontier-state-cache';

const options: QueryCacheFileStorageOptions = {
  directory: '.cache/frontier',
  snapshotFile: 'snapshot.json',
  changeLogFile: 'changes.jsonl',
  maxLogEntries: 10,
  fsync: false
};

const adapter: QueryCacheFileStorageAdapter = createQueryCacheFileStorageAdapter(options);
const storage: QueryCacheStorageAdapter = adapter;
const entry: QueryCacheChangeLogEntry = { seq: 1, type: 'clear' };

void storage;
void adapter.appendChange(entry);
void adapter.readChangeLog({ sinceSeq: 0, limit: 1 });
void adapter.compact();
