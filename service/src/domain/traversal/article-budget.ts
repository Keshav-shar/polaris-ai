import { ARTICLE } from "../../config/constants";

export type ArticleBudget = { minWords: number; maxWords: number };

// How long a node's article should be, derived from the node's own shape. This is the ONLY place article
// length policy lives, and it is pure so it can be reasoned about without running the model.
//
// Why a band at all, when the idea is "let the scope decide"? Because measurement says pure
// self-determination fails twice (docs/conflicts.md C85):
//
//   1. It is not repeatable. The same leaf node, same prompt, twice: 282 words and 690 words. Two sibling
//      leaves would differ 2.5x in depth for no reason a reader could see.
//   2. It inverts the design. Left alone the model wrote LEAVES SHORTER than interiors (486 vs 690 mean),
//      the opposite of the rule that a leaf conveys everything. Scope alone does not tell a model "you are
//      the last stop"; it reads a leaf as a narrow topic rather than a final one.
//
// A band fixed both: leaves became the longest (1023 vs 660) and leaf variance fell 84% -> 29%.
//
// The band is CALIBRATION, not a quota - one measured run still came back at 1198 words against an 1100
// top. ARTICLE.MAX_WORDS is the separate hard guard that catches a genuinely runaway draft.
const BANDS: readonly { upToChildren: number; minWords: number; maxWords: number }[] = [
  // A leaf hands nothing downward, so it carries the whole detail: the longest articles in the tree.
  { upToChildren: 0, minWords: 700, maxWords: 1100 },
  // Barely a fork. Little is handed down, so it still teaches most of its own material.
  { upToChildren: 2, minWords: 500, maxWords: 850 },
  // A real layer with real subtopics.
  { upToChildren: 5, minWords: 450, maxWords: 750 },
];

// Beyond the last band: a wide hub is mostly a map of where to go next, so it gets the least room.
const WIDE_HUB: ArticleBudget = { minWords: 350, maxWords: 600 };

// `writableChildCount` is the number of children that will actually GET an article (construction-done
// ones), not the number the tree has. A node whose children all failed genuinely is the last stop, and the
// article pass already treats it as a leaf for exactly that reason.
export function articleBudget(writableChildCount: number): ArticleBudget {
  if (!Number.isInteger(writableChildCount) || writableChildCount < 0) {
    throw new RangeError(`writableChildCount must be a non-negative integer, got ${writableChildCount}`);
  }
  const band = BANDS.find((b) => writableChildCount <= b.upToChildren) ?? WIDE_HUB;
  return { minWords: band.minWords, maxWords: band.maxWords };
}

// The band must never ask for more than the schema will accept, or the writer would be told to produce a
// draft that `ArticleOutput` then rejects and the repair loop has to shorten - burning a call every time.
// Asserted here rather than only in a test, because it is a relationship between two constants that can
// drift independently.
export function budgetFitsSchema(): boolean {
  const widest = [...BANDS, { ...WIDE_HUB, upToChildren: Infinity }];
  return widest.every((b) => b.maxWords < ARTICLE.MAX_WORDS);
}
