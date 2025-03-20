import { datastore, markdown } from "@silverbulletmd/silverbullet/syscalls";
import type { KV, KvKey, KvQuery, ObjectValue } from "../../plug-api/types.ts";
import { ttlCache } from "$lib/memory_cache.ts";
import type { LuaCollectionQuery } from "$common/space_lua/query_collection.ts";
import {
  extractFrontmatter as extractFrontmatterFromTree,
  type FrontMatter,
  type FrontmatterExtractOptions,
} from "../../plug-api/lib/frontmatter.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";

const indexKey = "idx";
const pageKey = "ridx";

/*
 * Key namespace:
 * [indexKey, type, ...key, page] -> value
 * [pageKey, page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  const finalBatch: KV[] = [];
  for (const { key, value } of kvs) {
    finalBatch.push({
      key: [indexKey, ...key, page],
      value,
    }, {
      key: [pageKey, page, ...key],
      value: true,
    });
  }
  return datastore.batchSet(finalBatch);
}

/**
 * Clears all keys for a given file
 * @param file
 */
export async function clearFileIndex(file: string): Promise<void> {
  if (file.endsWith(".md")) {
    file = file.replace(/\.md$/, "");
  }
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({
      prefix: [pageKey, file],
    })
  ) {
    allKeys.push(key);
    allKeys.push([indexKey, ...key.slice(2), file]);
  }
  await datastore.batchDel(allKeys);
}

/**
 * Clears the entire index
 */
export async function clearIndex(): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({ prefix: [indexKey] })
  ) {
    allKeys.push(key);
  }
  for (
    const { key } of await datastore.query({ prefix: [pageKey] })
  ) {
    allKeys.push(key);
  }
  await datastore.batchDel(allKeys);
  console.log("Deleted", allKeys.length, "keys from the index");
}

// OBJECTS API

/**
 * Indexes entities in the data store
 */
export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  const kvs: KV<T>[] = [];
  for (const obj of objects) {
    if (!obj.tag) {
      console.error("Object has no tag", obj, "this shouldn't happen");
      continue;
    }
    // Index as all the tag + any additional tags specified
    const allTags = [obj.tag, ...obj.tags || []];
    for (const tag of allTags) {
      // The object itself
      kvs.push({
        key: [tag, cleanKey(obj.ref, page)],
        value: obj,
      });
    }
  }
  if (kvs.length > 0) {
    return batchSet(page, kvs);
  } else {
    return Promise.resolve();
  }
}

function cleanKey(ref: string, page: string) {
  if (ref.startsWith(`${page}@`)) {
    return ref.substring(page.length + 1);
  } else {
    return ref;
  }
}

export function queryLuaObjects<T>(
  tag: string,
  query: LuaCollectionQuery,
  scopedVariables: Record<string, any> = {},
  ttlSecs?: number,
): Promise<ObjectValue<T>[]> {
  return ttlCache(query, () => {
    return datastore.queryLua([indexKey, tag], query, scopedVariables);
  }, ttlSecs);
}

export function deleteObject(
  tag: string,
  page: string,
  object: ObjectValue<any>,
): Promise<void> {
  return datastore.del([tag, cleanKey(object.ref, page)]);
}

export async function query(
  query: KvQuery,
): Promise<KV[]> {
  return (await datastore.query({
    ...query,
    prefix: [indexKey, ...query.prefix ? query.prefix : []],
  })).map(({ key, value }) => ({ key: key.slice(1), value }));
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<ObjectValue<T> | undefined> {
  return datastore.get([indexKey, tag, cleanKey(ref, page), page]);
}

export async function extractFrontmatter(
  text: string,
  extractOptions: FrontmatterExtractOptions = {},
): Promise<{ frontmatter: FrontMatter; text: string }> {
  const tree = await markdown.parseMarkdown(text);
  const frontmatter = await extractFrontmatterFromTree(tree, extractOptions);
  return { frontmatter, text: renderToText(tree) };
}
