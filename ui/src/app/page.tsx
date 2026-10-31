import { ApiStatus } from "../components/api-status";
import { FeatureCards } from "../components/feature-cards";
import { HeroIllustration } from "../components/hero-illustration";
import { TreeBuilder } from "../components/tree-builder";

// The layout supplies <main>, the header and the footer, so a page renders only its own content. The hero
// pieces are server-rendered and handed to the client TreeBuilder, which owns the one piece of state.
export default function HomePage() {
  return (
    <div className="space-y-20">
      <TreeBuilder
        intro={
          <div>
            <h1 className="mb-3 font-serif text-5xl font-bold tracking-wide text-ink md:text-6xl">
              What do you want to learn today?
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted md:text-base">
              Type any topic. Polaris breaks it into a map of short lessons, from the big picture down to the
              details, with a quick check after each one.
            </p>
          </div>
        }
        status={<ApiStatus />}
        illustration={<HeroIllustration />}
      />
      <FeatureCards />
    </div>
  );
}
