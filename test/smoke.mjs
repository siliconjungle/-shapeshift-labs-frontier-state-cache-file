import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createQueryCache,
  persistQueryCache
} from '@shapeshift-labs/frontier-state-cache';
import { createQueryCacheFileStorageAdapter } from '../dist/index.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-state-cache-file-smoke-'));

try {
  {
    const directory = path.join(tempRoot, 'basic');
    const storage = createQueryCacheFileStorageAdapter({
      directory,
      fsync: false,
      now: () => 10
    });
    const snapshot = {
      entities: {
        'Todo:1': { __typename: 'Todo', id: '1', text: 'saved' }
      },
      queries: []
    };

    assert.strictEqual(await storage.load(), null);
    await storage.save(snapshot);
    snapshot.entities['Todo:1'].text = 'mutated';

    const loaded = await storage.load();
    assert.strictEqual(loaded.entities['Todo:1'].text, 'saved');
    loaded.entities['Todo:1'].text = 'mutated-again';
    assert.strictEqual((await storage.load()).entities['Todo:1'].text, 'saved');

    const files = await fs.readdir(directory);
    assert.deepStrictEqual(files.filter((file) => file.endsWith('.tmp')), []);

    await storage.clear();
    assert.strictEqual(await storage.load(), null);
    await storage.destroy();
  }

  {
    const directory = path.join(tempRoot, 'persist');
    const source = createQueryCache({ now: () => 20 });
    const storage = createQueryCacheFileStorageAdapter({
      directory,
      fsync: false
    });
    const persistence = persistQueryCache(source, storage, { debounceMs: 1000 });

    source.writeQuery(['todos'], [
      { __typename: 'Todo', id: '1', text: 'ship', done: false }
    ]);
    await persistence.flush();

    source.modifyEntity('Todo:1', (todo) => ({ ...todo, text: 'draft' }));
    assert.strictEqual((await storage.load()).queries[0].value[0].text, 'ship');
    await persistence.flush();
    assert.strictEqual((await storage.load()).queries[0].value[0].text, 'draft');

    const restored = createQueryCache();
    const restoredPersistence = persistQueryCache(restored, storage);
    assert.strictEqual(await restoredPersistence.hydrate(), true);
    assert.deepStrictEqual(restored.getQueryData(['todos']), [
      { __typename: 'Todo', id: '1', text: 'draft', done: false }
    ]);

    await restoredPersistence.clear();
    assert.strictEqual(await storage.load(), null);

    persistence.dispose();
    restoredPersistence.dispose();
    await storage.destroy();
  }

  {
    const directory = path.join(tempRoot, 'log');
    const storage = createQueryCacheFileStorageAdapter({
      directory,
      fsync: false,
      maxLogEntries: 3,
      now: () => 30
    });

    await storage.appendChange({ seq: 1, type: 'query', key: ['todos'], hash: 'a', patchOperations: 1, stale: false, updatedAt: 1 });
    await storage.appendChange({ seq: 2, type: 'entity', entityId: 'Todo:1', patchOperations: 1 });
    await storage.appendChange({ seq: 3, type: 'invalidate', hash: 'a' });
    await storage.appendChange({ seq: 4, type: 'clear' });

    assert.deepStrictEqual((await storage.readChangeLog()).map((entry) => entry.seq), [2, 3, 4]);
    assert.deepStrictEqual((await storage.readChangeLog({ sinceSeq: 2 })).map((entry) => entry.seq), [3, 4]);
    assert.deepStrictEqual((await storage.readChangeLog({ limit: 1 })).map((entry) => entry.seq), [2]);

    await storage.compact({
      entities: {},
      queries: []
    });
    assert.deepStrictEqual(await storage.readChangeLog(), []);
    assert.deepStrictEqual(await storage.load(), {
      entities: {},
      queries: []
    });

    await storage.destroy();
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('frontier state-cache-file smoke passed');
