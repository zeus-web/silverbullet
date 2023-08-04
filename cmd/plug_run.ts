import { runPlug } from "../cli/plug_run.ts";
import { path } from "../common/deps.ts";
import assets from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";

export async function plugRunCommand(
  {
    noIndex,
  }: {
    noIndex: boolean;
  },
  spacePath: string,
  functionName: string,
  ...args: string[]
) {
  spacePath = path.resolve(spacePath);
  console.log("Space path", spacePath);
  console.log("Function to run:", functionName, "with arguments", args);
  try {
    const result = await runPlug(
      spacePath,
      functionName,
      args,
      new AssetBundle(assets),
      !noIndex,
    );
    console.log("Output", result);
  } catch (e: any) {
    console.error(e.message);
    Deno.exit(1);
  }
}
