/**
 * Optional community banner shown at the top of the List view (AUB-61,
 * Phase 2b). A warm, human "real people contributed this" cue (design.md → "Part
 * of a community"): overlapping pastel avatar circles + a neighbor-count line.
 *
 * The avatars are DECORATIVE pastel fills only (never load-bearing for safety —
 * they carry no safety meaning), so they are `aria-hidden`; the accessible
 * content is the text line.
 */

/** Decorative pastel avatar ring set (fills only). */
const AVATAR_TILES = [
  "bg-accent-lavender",
  "bg-accent-mint",
  "bg-accent-peach",
  "bg-accent-sky",
] as const;

export function CommunityBanner({ count = 1204 }: { count?: number }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-brand-soft bg-brand-soft px-3.5 py-3">
      <div className="flex items-center" aria-hidden="true">
        {AVATAR_TILES.map((tile, index) => (
          <span
            key={tile}
            className={`size-[26px] rounded-full border-2 border-brand-soft ${tile} ${
              index > 0 ? "-ml-2" : ""
            }`}
          />
        ))}
      </div>
      <p className="text-body-sm text-foreground">
        <span className="font-bold text-brand-strong">{count.toLocaleString()}</span> neighbors
        verified spots this month
      </p>
    </div>
  );
}
