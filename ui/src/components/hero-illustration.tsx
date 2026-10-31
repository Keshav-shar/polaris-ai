// The mock's right-hand card: a learner pointing a phone at a small map of linked topics. Purely
// decorative, so the whole picture is hidden from assistive tech and only the caption is read.
export function HeroIllustration() {
  return (
    <div className="relative flex aspect-square w-full max-w-sm flex-col items-center justify-center overflow-hidden rounded-3xl border border-line/40 bg-gradient-to-b from-gold-soft to-parchment-deep p-8 shadow-inner">
      <div aria-hidden="true" className="absolute top-6 right-8 h-24 w-24 rounded-full bg-gold-glow/20 blur-xl" />

      <svg viewBox="0 0 300 300" className="h-auto w-full drop-shadow-md" fill="none" aria-hidden="true">
        {/* A small topic map: one main idea linked to three smaller ones. */}
        <path d="M185 110 L250 50 L270 90 L230 110 Z" fill="#F4E8C1" opacity="0.6" />
        <circle cx="250" cy="50" r="3" fill="#8C6D36" />
        <circle cx="270" cy="90" r="3" fill="#8C6D36" />
        <circle cx="230" cy="110" r="2" fill="#8C6D36" />
        <circle cx="210" cy="70" r="4" fill="#8C6D36" />
        <path d="M250 50 L210 70 L270 90 M210 70 L230 110" stroke="#8C6D36" strokeWidth="1.5" strokeDasharray="2 2" />

        {/* Phone */}
        <rect x="150" y="130" width="75" height="135" rx="12" fill="#1C1814" transform="rotate(-15 150 130)" stroke="#D4C4A8" strokeWidth="2" />
        <rect x="159" y="140" width="57" height="113" rx="6" fill="#2C221E" transform="rotate(-15 150 130)" />
        <path d="M180 190 A 12 12 0 0 1 195 210 A 15 15 0 1 0 180 190 Z" fill="#D9C496" transform="rotate(-15 150 130)" />

        {/* Learner */}
        <path d="M200 230 C200 180 230 150 260 140 C280 133 300 145 300 170 L300 280 L200 280 Z" fill="#E2DAC9" opacity="0.8" />
        <path d="M225 125 C225 110 238 95 255 95 C272 95 285 110 285 125 C285 140 272 155 255 155 C238 155 225 140 225 125 Z" fill="#1C1814" />
        <path d="M225 140 L195 130 L185 140" stroke="#1C1814" strokeWidth="3" strokeLinecap="round" />
      </svg>

      <p className="mt-4 text-center font-serif text-xs uppercase tracking-widest text-faint">
        Your learning map, ready in minutes
      </p>
    </div>
  );
}
