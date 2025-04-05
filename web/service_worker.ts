import type { FileContent } from "$common/spaces/datastore_space_primitives.ts";
import { simpleHash } from "$lib/crypto.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { IndexedDBKvPrimitives } from "$lib/data/indexeddb_kv_primitives.ts";
import {
  decodePageURI,
  looksLikePathWithExtension,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import type { ClientConfig } from "./client.ts";

const CACHE_NAME = "{{CACHE_NAME}}";

const precacheFiles = Object.fromEntries([
  "/",
  "/.client/client.js",
  "/.client/favicon.png",
  "/.client/iAWriterMonoS-Bold.woff2",
  "/.client/iAWriterMonoS-BoldItalic.woff2",
  "/.client/iAWriterMonoS-Italic.woff2",
  "/.client/iAWriterMonoS-Regular.woff2",
  "/.client/logo.png",
  "/.client/logo-dock.png",
  "/.client/main.css",
  "/.client/manifest.json",
].map((path) => [path, path + "?v=" + CACHE_NAME, path])); // Cache busting

self.addEventListener("install", (event: any) => {
  console.log("[Service worker]", "Installing service worker...");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log(
        "[Service worker]",
        "Now pre-caching client files",
      );
      await cache.addAll(Object.values(precacheFiles));
      console.log(
        "[Service worker]",
        Object.keys(precacheFiles).length,
        "client files cached",
      );
      // @ts-ignore: Force the waiting service worker to become the active service worker
      await self.skipWaiting();
      console.log("[Service worker]", "skipWaiting complete");
    })(),
  );
});

self.addEventListener("activate", (event: any) => {
  console.log("[Service worker]", "Activating new service worker!");
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[Service worker]", "Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      // @ts-ignore: Take control of all clients as soon as the service worker activates
      await clients.claim();
      console.log("[Service worker]", "clients.claim complete");
    })(),
  );
});

let ds: DataStore | undefined;
const filesContentPrefix = ["file", "content"];

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Use the custom cache key if available, otherwise use the request URL
  const cacheKey = precacheFiles[url.pathname] || event.request.url;

  event.respondWith(
    (async () => {
      const request = event.request;
      const requestUrl = new URL(request.url);

      // Are we fetching a URL from the same origin as the app? If not, we don't handle it and pass it on
      if (location.host !== requestUrl.host) {
        return fetch(request);
      }

      // Any request with the X-Sync-Mode header originates from the sync engine: pass it on to the server
      if (request.headers.has("x-sync-mode")) {
        return fetch(request);
      }

      // Try the static (client) file cache first
      const cachedResponse = await caches.match(cacheKey);
      // Return the cached response if found
      if (cachedResponse) {
        return cachedResponse;
      }

      if (!ds) {
        // Not initialzed yet, or in thin client mode, let's just proxy
        return fetch(request);
      }

      const pathname = requestUrl.pathname;

      if (pathname === "/.config") {
        try {
          // First check if we have a cached config in ds
          const cachedConfig = await ds?.get<ClientConfig>(["$clientConfig"]);

          if (cachedConfig) {
            // If we have a cached config, try to fetch fresh config with a timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);

            try {
              const response = await fetch(request, {
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (response.status === 401) {
                // Pass on the 401 to the client
                return response;
              }
              const clientConfig = await response.json();
              await ds.set(["$clientConfig"], clientConfig);
              console.log(
                "[Service worker]",
                "Serving and cached fresh config",
              );
              return new Response(JSON.stringify(clientConfig));
            } catch (e) {
              clearTimeout(timeoutId);
              // If timeout or other error occurs, use cached config
              console.log(
                "[Service worker]",
                "Using cached config due to timeout or error:",
                e instanceof Error ? e.message : String(e),
              );
              return new Response(JSON.stringify(cachedConfig));
            }
          } else {
            // No cached config, fetch without timeout
            const response = await fetch(request);
            if (response.status === 401) {
              return response;
            }
            const clientConfig = await response.json();
            await ds.set(["$clientConfig"], clientConfig);
            console.log(
              "[Service worker]",
              "Serving and cached initial config",
            );
            return new Response(JSON.stringify(clientConfig));
          }
        } catch (e: any) {
          console.error(
            "[Service worker]",
            "Failed to fetch client config",
            e.message,
          );
          return new Response("{}", {
            status: 404,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }
      } else if (
        pathname === "/.auth" ||
        pathname === "/.logout" ||
        pathname === "/index.json"
      ) {
        return fetch(request);
      } else if (
        pathname.endsWith(".md") &&
        request.headers.get("accept") !== "application/octet-stream" &&
        request.headers.get("sec-fetch-mode") !== "cors"
      ) {
        return Response.redirect(`${pathname.slice(0, -3)}`);
      } else if (
        (looksLikePathWithExtension(pathname) &&
          !request.headers.get("accept").includes("text/html")) ||
        requestUrl.searchParams.get("raw") === "true"
      ) {
        // If this is a /*.* request, this can either be a plug worker load or an document load
        return handleLocalFileRequest(pathname, request);
      } else {
        // Must be a page URL, let's serve index.html which will handle it
        return (await caches.match(precacheFiles["/"])) || fetch(request);
      }
    })().catch((e) => {
      console.warn("[Service worker]", "Fetch failed:", e);
      return new Response("Offline", {
        status: 503, // Service Unavailable
      });
    }),
  );
});

async function handleLocalFileRequest(
  pathname: string,
  request: Request,
): Promise<Response> {
  const path = decodePageURI(pathname.slice(1));
  const data = await ds?.get<FileContent>([...filesContentPrefix, path]);
  if (data) {
    // console.log("Serving from space", path);
    return new Response(
      data.data,
      {
        headers: {
          "Content-type": data.meta.contentType,
          "Content-Length": "" + data.meta.size,
          "X-Permission": data.meta.perm,
          "X-Created": "" + data.meta.created,
          "X-Last-Modified": "" + data.meta.lastModified,
        },
      },
    );
  } else {
    console.warn(
      "Did not find file in locally synced space",
      path,
    );
    // If this is a _plug request and we don't have it, we may not have performed an initial sync yet
    if (path.startsWith("_plug/")) {
      console.info("Proxying _plug fetch to server", path);
      return fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  }
}

self.addEventListener("message", (event: any) => {
  switch (event.data.type) {
    case "skipWaiting": {
      console.log(
        "[Service worker]",
        "Received skipWaiting message, activating immediately",
      );
      // @ts-ignore: Skip waiting to activate this service worker immediately
      self.skipWaiting();
      break;
    }
    case "flushCache": {
      caches.delete(CACHE_NAME)
        .then(() => {
          console.log("[Service worker]", "Cache deleted");
          // ds?.close();
          event.source.postMessage({ type: "cacheFlushed" });
        });
      break;
    }
    case "config": {
      const spaceFolderPath = event.data.config.spaceFolderPath;
      const dbPrefix = "" + simpleHash(spaceFolderPath);

      // Setup space
      const kv = new IndexedDBKvPrimitives(`${dbPrefix}`);
      kv.init().then(() => {
        ds = new DataStore(kv);
        console.log("Datastore in service worker initialized...");
      });
      break;
    }
    case "shutdown": {
      if (ds) {
        console.log("[Service worker]", "Disconnecting datastore");
        ds.kv.close();
        ds = undefined;
      }
      break;
    }
  }
});
