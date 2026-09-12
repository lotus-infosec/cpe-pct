// Shared contract for every ObjectStore adapter. Imported by the node and workers projects.
import { expect } from 'vitest';
import type { ObjectStore } from '../src/ports';

export async function objectStoreContract(store: ObjectStore) {
  const bytes = new TextEncoder().encode('hello evidence');
  await store.put('evidence/ab/cd/abcd1234', bytes, { contentType: 'text/plain' });
  const head = await store.head('evidence/ab/cd/abcd1234');
  expect(head).toEqual({ contentType: 'text/plain', size: bytes.length });
  const got = await store.get('evidence/ab/cd/abcd1234');
  expect(got?.contentType).toBe('text/plain');
  expect(await new Response(got!.body).text()).toBe('hello evidence');

  // Streaming put with known size
  const stream = new Blob([bytes]).stream() as ReadableStream<Uint8Array>;
  await store.put('evidence/ab/cd/streamed', stream, {
    contentType: 'text/plain',
    size: bytes.length,
  });
  expect((await store.head('evidence/ab/cd/streamed'))?.size).toBe(bytes.length);

  const keys: string[] = [];
  for await (const o of store.list('evidence/ab/')) keys.push(o.key);
  expect(keys.sort()).toEqual(['evidence/ab/cd/abcd1234', 'evidence/ab/cd/streamed']);

  await store.delete('evidence/ab/cd/abcd1234');
  expect(await store.head('evidence/ab/cd/abcd1234')).toBeNull();
  expect(await store.get('evidence/ab/cd/abcd1234')).toBeNull();
  await store.delete('evidence/ab/cd/streamed');
}
