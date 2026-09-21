import { TAPER_LAYERS } from "../../config/constants";
import type { LayerPosition } from "../schemas/node.schema";

// "Last two layers" = the taper layer (maxDepth - 1) + the leaf layer (maxDepth).
export function layerPosition(depth: number, maxDepth: number): LayerPosition {
  if (depth >= maxDepth) return "leaf";
  if (maxDepth - depth < TAPER_LAYERS) return "taper";
  return "normal";
}
