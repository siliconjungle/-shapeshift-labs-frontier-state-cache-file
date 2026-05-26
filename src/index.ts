import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  QueryCacheChangeLogEntry,
  QueryCacheSnapshot,
  QueryCacheStorageAdapter
} from '@shapeshift-labs/frontier-state-cache';

const DEFAULT_DIRECTORY = '.frontier-state-cache';
const DEFAULT_SNAPSHOT_FILE = 'snapshot.json';
const DEFAULT_CHANGE_LOG_FILE = 'changes.jsonl';
const SNAPSHOT_MAGIC = 'frontier-state-cache-file-snapshot';
const CHANGE_LOG_MAGIC = 'frontier-state-cache-file-change';
const RECORD_VERSION = 1;

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

type QueryCacheFileSnapshotEnvelope = {
  magic: typeof SNAPSHOT_MAGIC;
  version: typeof RECORD_VERSION;
  savedAt: number;
  snapshot: QueryCacheSnapshot;
};

type NormalizedOptions = Required<
  Pick<QueryCacheFileStorageOptions, 'directory' | 'snapshotFile' | 'changeLogFile' | 'now' | 'pretty' | 'fsync' | 'maxLogEntries'>
>;

export function createQueryCacheFileStorageAdapter(
  options: string | QueryCacheFileStorageOptions = {}
): QueryCacheFileStorageAdapter {
  const normalized = normalizeOptions(options);
  const directory = normalized.directory;
  const snapshotPath = path.join(directory, normalized.snapshotFile);
  const changeLogPath = path.join(directory, normalized.changeLogFile);

  const adapter: QueryCacheFileStorageAdapter = {
    directory,
    snapshotPath,
    changeLogPath,
    getPaths() {
      return { directory, snapshotPath, changeLogPath };
    },
    async load() {
      const envelope = await readJson<QueryCacheFileSnapshotEnvelope>(snapshotPath);
      if (envelope === undefined) return null;
      assertSnapshotEnvelope(envelope);
      return cloneSnapshot(envelope.snapshot);
    },
    async save(snapshot) {
      const envelope: QueryCacheFileSnapshotEnvelope = {
        magic: SNAPSHOT_MAGIC,
        version: RECORD_VERSION,
        savedAt: normalized.now(),
        snapshot: cloneSnapshot(snapshot)
      };
      await writeJsonAtomic(snapshotPath, envelope);
    },
    async clear() {
      await removeFile(snapshotPath);
      await removeFile(changeLogPath);
    },
    async appendChange(entry) {
      assertChangeLogEntry(entry);
      await ensureDirectory();
      const record: QueryCacheFileChangeLogRecord = {
        magic: CHANGE_LOG_MAGIC,
        version: RECORD_VERSION,
        createdAt: normalized.now(),
        entry: cloneChangeLogEntry(entry)
      };
      await appendLine(changeLogPath, JSON.stringify(record) + '\n');
      if (normalized.maxLogEntries > 0) await trimChangeLog(normalized.maxLogEntries);
    },
    async readChangeLog(options = {}) {
      const records = await readChangeLogRecords();
      const sinceSeq = Number(options.sinceSeq);
      const limit = readPositiveInt(options.limit, 0);
      const entries: QueryCacheChangeLogEntry[] = [];
      for (const record of records) {
        const entry = record.entry;
        if (Number.isFinite(sinceSeq) && entry.seq <= sinceSeq) continue;
        entries.push(cloneChangeLogEntry(entry));
        if (limit > 0 && entries.length >= limit) break;
      }
      return entries;
    },
    async compact(snapshot) {
      if (snapshot !== undefined) await adapter.save(snapshot);
      await writeTextAtomic(changeLogPath, '');
    },
    async destroy() {
      await adapter.clear();
      await removeEmptyDirectory(directory);
    }
  };

  return adapter;

  async function ensureDirectory(): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
  }

  async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const body = JSON.stringify(value, null, normalized.pretty ? 2 : 0) + '\n';
    await writeTextAtomic(filePath, body);
  }

  async function writeTextAtomic(filePath: string, body: string): Promise<void> {
    await ensureDirectory();
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, '.' + base + '.' + Date.now() + '.' + randomUUID() + '.tmp');
    const handle = await fs.open(tmpPath, 'w', 0o600);
    try {
      await handle.writeFile(body, 'utf8');
      if (normalized.fsync) await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await removeFile(tmpPath);
      throw error;
    }
    await handle.close();
    await fs.rename(tmpPath, filePath);
    if (normalized.fsync) await syncDirectory(dir);
  }

  async function appendLine(filePath: string, line: string): Promise<void> {
    const handle = await fs.open(filePath, 'a', 0o600);
    try {
      await handle.appendFile(line, 'utf8');
      if (normalized.fsync) await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function readChangeLogRecords(): Promise<QueryCacheFileChangeLogRecord[]> {
    let text: string;
    try {
      text = await fs.readFile(changeLogPath, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return [];
      throw error;
    }
    const records: QueryCacheFileChangeLogRecord[] = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.length === 0) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error('Invalid Frontier state-cache file change-log JSON on line ' + (index + 1));
      }
      assertChangeLogRecord(value);
      records.push(value);
    }
    return records;
  }

  async function trimChangeLog(maxEntries: number): Promise<void> {
    const records = await readChangeLogRecords();
    if (records.length <= maxEntries) return;
    const next = records.slice(records.length - maxEntries);
    await writeTextAtomic(changeLogPath, next.map((record) => JSON.stringify(record)).join('\n') + '\n');
  }
}

function normalizeOptions(options: string | QueryCacheFileStorageOptions): NormalizedOptions {
  const raw = typeof options === 'string' ? { directory: options } : options;
  return {
    directory: normalizeDirectory(raw.directory),
    snapshotFile: normalizeFileName(raw.snapshotFile, DEFAULT_SNAPSHOT_FILE, 'snapshotFile'),
    changeLogFile: normalizeFileName(raw.changeLogFile, DEFAULT_CHANGE_LOG_FILE, 'changeLogFile'),
    now: typeof raw.now === 'function' ? raw.now : Date.now,
    pretty: raw.pretty === true,
    fsync: raw.fsync !== false,
    maxLogEntries: readPositiveInt(raw.maxLogEntries, 0)
  };
}

function normalizeDirectory(value: unknown): string {
  if (value === undefined) return path.resolve(DEFAULT_DIRECTORY);
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('createQueryCacheFileStorageAdapter directory must be a non-empty string');
  }
  return path.resolve(value);
}

function normalizeFileName(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('createQueryCacheFileStorageAdapter ' + label + ' must be a non-empty string');
  }
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new TypeError('createQueryCacheFileStorageAdapter ' + label + ' must be a file name inside the storage directory');
  }
  return value;
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await fs.rmdir(directory);
  } catch (error) {
    if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY') && !isErrno(error, 'EEXIST')) throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, fsConstants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync support varies by platform and filesystem.
  }
}

function assertSnapshotEnvelope(value: QueryCacheFileSnapshotEnvelope): void {
  if (value.magic !== SNAPSHOT_MAGIC || value.version !== RECORD_VERSION) {
    throw new Error('File record is not a Frontier state-cache snapshot');
  }
  assertSnapshot(value.snapshot);
}

function assertSnapshot(snapshot: QueryCacheSnapshot): void {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    snapshot.entities === null ||
    typeof snapshot.entities !== 'object' ||
    !Array.isArray(snapshot.queries)
  ) {
    throw new Error('File record contains an invalid Frontier state-cache snapshot');
  }
}

function assertChangeLogRecord(value: unknown): asserts value is QueryCacheFileChangeLogRecord {
  const record = value as QueryCacheFileChangeLogRecord;
  if (
    record === null ||
    typeof record !== 'object' ||
    record.magic !== CHANGE_LOG_MAGIC ||
    record.version !== RECORD_VERSION
  ) {
    throw new Error('File record is not a Frontier state-cache change-log record');
  }
  assertChangeLogEntry(record.entry);
}

function assertChangeLogEntry(entry: QueryCacheChangeLogEntry): void {
  if (entry === null || typeof entry !== 'object' || !Number.isFinite(entry.seq) || typeof entry.type !== 'string') {
    throw new Error('Invalid Frontier state-cache change-log entry');
  }
}

function cloneSnapshot(snapshot: QueryCacheSnapshot): QueryCacheSnapshot {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(snapshot);
  return JSON.parse(JSON.stringify(snapshot)) as QueryCacheSnapshot;
}

function cloneChangeLogEntry(entry: QueryCacheChangeLogEntry): QueryCacheChangeLogEntry {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(entry);
  return JSON.parse(JSON.stringify(entry)) as QueryCacheChangeLogEntry;
}

function readPositiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}
