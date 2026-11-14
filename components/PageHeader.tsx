import type { ReactNode } from "react";

// One compact page header for every top-level view — a mono eyebrow, a display title, an optional
// one-line subtitle, and an optional right-aligned action cluster. Deliberately slim (was a 38px title
// + roomy margins on each page) so the work below gets the vertical space.
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  /** A node rather than a string, so a screen with somewhere to go back to can put the link here —
   *  which is where the eye already is when you want it. */
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    // The action cluster used to be `shrink-0` against a `min-w-0` title, which meant the title lost
    // every fight: on a page with a lot of controls (the Calendar now has eight) the heading column
    // collapsed to a few characters wide and "Calendar" wrapped one letter per line. Now the ROW
    // wraps — actions drop onto their own line rather than crushing the words — and the title keeps a
    // floor it can't be squeezed below. Identical on pages with room to spare.
    <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
      <div className="min-w-[240px] flex-1">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="font-display text-[28px] leading-none">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-[13px] text-[color:var(--mist)] max-w-2xl leading-snug">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div> : null}
    </div>
  );
}
