import { walk } from "@std/fs/walk";
import { resolve } from "@std/path";
import { mime } from "mimetypes";

import type { FileMeta } from "../type/index.ts";

const rootDir = resolve("website_build");

const lastModifiedTimestamp = +Deno.env.get("LAST_MODIFIED_TIMESTAMP")! ||
  Date.now();

const allFiles: FileMeta[] = [];
for await (
  const file of walk(rootDir, {
    includeDirs: false,
    // Exclude hidden files
    skip: [
      /^.*\/(\..+|_redirects|_headers|service_worker\.js.*|index\.json|_client\/.*)$/,
    ],
  })
) {
  const fullPath = file.path;
  const s = await Deno.stat(fullPath);
  allFiles.push({
    name: fullPath.substring(rootDir.length + 1),
    lastModified: lastModifiedTimestamp,
    created: lastModifiedTimestamp,
    contentType: mime.getType(fullPath) || "application/octet-stream",
    size: s.size,
    perm: "rw",
  });
}
console.log(JSON.stringify(allFiles, null, 2));
