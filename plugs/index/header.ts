import {
  collectNodesMatching,
  collectNodesOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "../../type/event.ts";
import { indexObjects, queryLuaObjects } from "./api.ts";
import { parseRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import { lua } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "../../type/index.ts";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

type HeaderObject = ObjectValue<
  {
    name: string;
    page: string;
    level: number;
    pos: number;
  } & Record<string, any>
>;

export async function indexHeaders({ name: pageName, tree }: IndexTreeEvent) {
  const headers: ObjectValue<HeaderObject>[] = [];

  for (
    const n of collectNodesMatching(
      tree,
      (t) => !!t.type?.startsWith("ATXHeading"),
    )
  ) {
    const level = +n.type!.substring("ATXHeading".length);
    const tags = new Set<string>();

    collectNodesOfType(n, "Hashtag").forEach((h) => {
      // Push tag to the list, removing the initial #
      tags.add(extractHashtag(h.children![0].text!));
      h.children = [];
    });

    // Extract attributes and remove from tree
    const extractedAttributes = await extractAttributes(n);
    const name = n.children!.slice(1).map(renderToText).join("").trim();

    headers.push({
      ref: `${pageName}#${name}@${n.from}`,
      tag: "header",
      tags: [...tags],
      level,
      name,
      page: pageName,
      pos: n.from!,
      ...extractedAttributes,
    });
  }

  // console.log("Found", headers, "headers(s)");
  await indexObjects(pageName, headers);
}

export async function headerComplete(completeEvent: CompleteEvent) {
  const match = /(?:\[\[|\[.*?\]\()([^\]$:#]*#[^\]\)]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match) {
    return null;
  }

  const pageRef = parseRef(match[1]).page;
  const allHeaders = await queryLuaObjects<HeaderObject>(
    "header",
    {
      objectVariable: "_",
      where: await lua.parseExpression(`_.page == pageRef`),
    },
    { pageRef: pageRef || completeEvent.pageName },
    5,
  );
  console.log("Matching ehaders", allHeaders);
  return {
    from: completeEvent.pos - match[1].length,
    options: allHeaders.map((a) => ({
      label: a.page === completeEvent.pageName
        ? `#${a.name}`
        : a.ref.split("@")[0],
      type: "header",
    })),
  };
}
