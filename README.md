# Frontier State Cache File

Structured file persistence adapter for Frontier state-cache snapshots and bounded change logs.

This package is the Node/Electron/CLI storage edge for `@shapeshift-labs/frontier-state-cache`. It keeps filesystem APIs out of the cache root import while giving local tools a durable snapshot file, JSONL change log, atomic snapshot writes, and explicit compaction.

- npm: [`@shapeshift-labs/frontier-state-cache-file`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-file)
- source: [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)
- cache: [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives below the state-cache package.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared query-key, selector path, condition, identity, and table-schema primitives.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): normalized query-result cache with entity/query watchers, persistence hooks, change logs, optimistic layers, and mutation bridge helpers.
- [`@shapeshift-labs/frontier-state-cache-idb`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-idb): browser IndexedDB persistence adapter for the same cache snapshot contract.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-idb`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-idb)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)

## Install

```sh
npm install @shapeshift-labs/frontier-state-cache @shapeshift-labs/frontier-state-cache-file
```

## Usage

```js
import {
  createQueryCache,
  persistQueryCache
} from '@shapeshift-labs/frontier-state-cache';
import { createQueryCacheFileStorageAdapter } from '@shapeshift-labs/frontier-state-cache-file';

const cache = createQueryCache();
const storage = createQueryCacheFileStorageAdapter({
  directory: '.frontier/cache',
  maxLogEntries: 512
});

const persistence = persistQueryCache(cache, storage, {
  debounceMs: 25
});

await persistence.hydrate();

cache.writeQuery(['todos'], [
  { __typename: 'Todo', id: '1', text: 'Ship', done: false }
]);

await storage.appendChange({
  seq: 1,
  type: 'query',
  key: ['todos'],
  hash: cache.getQueryHash(['todos']),
  patchOperations: 1,
  stale: false,
  updatedAt: Date.now()
});

await persistence.flush();
```

## API

```ts
import {
  createQueryCacheFileStorageAdapter,
  type QueryCacheFileStorageAdapter,
  type QueryCacheFileStorageOptions
} from '@shapeshift-labs/frontier-state-cache-file';
```

- `createQueryCacheFileStorageAdapter(options?)` creates a `QueryCacheStorageAdapter`.
- `load()`, `save(snapshot)`, and `clear()` match the state-cache persistence contract.
- `appendChange(entry)` appends a structured JSONL `QueryCacheChangeLogEntry`.
- `readChangeLog({ sinceSeq, limit })` reads retained log entries.
- `compact(snapshot?)` atomically writes an optional snapshot and clears the JSONL log.
- `destroy()` removes the adapter-owned snapshot/log files and removes the directory if it is empty.

Passing a string is shorthand for `{ directory: string }`.

## File Layout

The adapter stores structured records inside one directory:

```text
.frontier-state-cache/
  snapshot.json
  changes.jsonl
```

`snapshot.json` is an envelope with a format marker, version, `savedAt`, and the state-cache snapshot. Writes go through a temporary file in the same directory and then `rename`, so readers never observe a half-written snapshot.

`changes.jsonl` is an append-only sequence of structured change-log records. `maxLogEntries` bounds retained entries by trimming the oldest records after append. `compact(snapshot)` is the explicit checkpoint operation: write the current snapshot and clear the log.

This is not arbitrary binary file diffing. The package persists Frontier's structured state-cache artifacts so local tools can restore quickly and decide how much replay history to retain.

## Options

```ts
interface QueryCacheFileStorageOptions {
  directory?: string;
  snapshotFile?: string;
  changeLogFile?: string;
  now?: () => number;
  pretty?: boolean;
  fsync?: boolean;
  maxLogEntries?: number;
}
```

`fsync` defaults to `true`. Set it to `false` for tests or for tools that prefer throughput over stronger local durability. `snapshotFile` and `changeLogFile` must be file names inside `directory`.

## Verification

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0 with `fsync: false`, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| File snapshot save | 1,578 us | 1,900 us |
| File snapshot load | 2,124 us | 2,405 us |
| File change-log append | 67 us | 115 us |
| File change-log read | 167 us | 218 us |
| File snapshot compact | 1,681 us | 1,912 us |
| File snapshot clear | 87 us | 121 us |

These are Frontier-only package measurements, not competitor comparisons. Filesystem timings vary substantially by machine, filesystem, and `fsync` policy.

## License

MIT. See [LICENSE](./LICENSE).
