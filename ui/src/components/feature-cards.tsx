import type { ReactNode } from "react";

// The mock's four-card band, rewritten as what Polaris actually does for a learner. Static content, so a
// server component; icons are decorative.
const FEATURES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Topic map",
    body: "Your subject split into clear branches, from the big picture to the fine detail.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
        <path strokeLinecap="round" strokeWidth="1.5" d="M12 3v18M3 12h18" />
      </>
    ),
  },
  {
    title: "Bite-sized lessons",
    body: "Each lesson covers one idea and points you to what comes next, so nothing is repeated.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    ),
  },
  {
    title: "Quick checks",
    body: "Three questions after every lesson, each linked to the source it comes from.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
  },
  {
    title: "Learns from you",
    body: "Tell us how each lesson felt, and your next map is pitched at the right level.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    ),
  },
];

export function FeatureCards() {
  return (
    <section aria-labelledby="how-it-works" className="border-t border-rule pt-10">
      <h2 id="how-it-works" className="mb-10 text-center font-serif text-2xl font-bold tracking-wider text-ink md:text-3xl">
        How Polaris teaches
      </h2>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <li
            key={feature.title}
            className="parchment-card flex flex-col items-center rounded-2xl p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
          >
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-gold-soft text-gold">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {feature.icon}
              </svg>
            </span>
            <h3 className="mb-1 font-serif text-lg font-bold text-ink">{feature.title}</h3>
            <p className="text-xs leading-relaxed text-subtle">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
