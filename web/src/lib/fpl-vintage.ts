//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Staleness guard for the federal poverty guidelines.
 *
 * BN computes eligibility from the FPL tables in
 * `contexts/community/benefits-navigator.md`. HHS reissues those guidelines
 * every January, and nothing in this repo updates them automatically. When the
 * tables fall behind the calendar the failure is silent and it runs **against
 * the applicant**: thresholds rise each year, so stale lower tables make a
 * household's income read as a higher percentage of FPL than it truly is, and
 * BN understates eligibility — telling someone they are over a cut-off when
 * they are under it. They then do not apply.
 *
 * This check is deliberately in CODE rather than expressed as an instruction to
 * the model. An instruction is a request, and its compliance varies by model —
 * which matters here because the deployed backend is not chosen yet and a
 * cost-driven swap is under consideration. A guard that cannot be proven to
 * fire is not a guard. This one is deterministic and tested in both directions.
 *
 * What it does NOT do: it cannot stop the model computing and stating a wrong
 * percentage. It makes the staleness visible to whoever reads the result. A
 * wrong answer that announces its own staleness is recoverable; a confident one
 * is not. Only current tables are a fix.
 */

/**
 * The year of the HHS poverty guidelines currently embedded in
 * `contexts/community/benefits-navigator.md`.
 *
 * UPDATE THIS IN THE SAME COMMIT that updates the tables themselves, and never
 * on its own — raising it without changing the numbers converts a loud wrong
 * answer back into a silent one, which is strictly worse than leaving it.
 */
export const EMBEDDED_FPL_GUIDELINE_YEAR = 2025;

export interface FplVintage {
  /** Guideline year the tables represent. */
  embeddedYear: number;
  /** Calendar year the determination is being made in. */
  currentYear: number;
  /** True when the tables are behind the calendar. */
  isStale: boolean;
  /** Whole years behind; 0 when current. */
  yearsBehind: number;
}

/**
 * Compare the embedded guideline year against the date of the run.
 *
 * `now` is injectable so this is testable without touching the system clock.
 */
export function checkFplVintage(
  now: Date = new Date(),
  embeddedYear: number = EMBEDDED_FPL_GUIDELINE_YEAR,
): FplVintage {
  // UTC, not local time. Local time makes the rollover depend on where the
  // server happens to sit: at a Texas centre (UTC-6) `getFullYear()` would
  // still read the old year for the first six hours of 1 January, so the guard
  // would stay silent exactly when it is most needed. UTC also errs toward
  // firing marginally early, which is the safe direction -- an unnecessary
  // notice costs a sentence, a missing one costs someone their benefits.
  const currentYear = now.getUTCFullYear();
  const yearsBehind = Math.max(0, currentYear - embeddedYear);

  return {
    embeddedYear,
    currentYear,
    isStale: yearsBehind > 0,
    yearsBehind,
  };
}

/**
 * The notice to surface when the tables are stale, or null when they are
 * current.
 *
 * Deliberately says which way the error runs. "May be out of date" invites a
 * reader to assume the effect is random; it is not. Someone told they do not
 * qualify needs to know that this specific staleness makes that answer more
 * likely to be wrong than right.
 */
export function fplStalenessNotice(vintage: FplVintage): string | null {
  if (!vintage.isStale) return null;

  return (
    `These results use the ${vintage.embeddedYear} federal poverty guidelines, ` +
    `which are ${vintage.yearsBehind === 1 ? 'a year' : `${vintage.yearsBehind} years`} out of date. ` +
    `The thresholds rise each year, so this may understate what you qualify for — ` +
    `you could be eligible for more than is shown here. ` +
    `Please confirm with a benefits counsellor before ruling anything out.`
  );
}
