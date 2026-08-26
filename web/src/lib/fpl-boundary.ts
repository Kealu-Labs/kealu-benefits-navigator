//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Near-boundary detection for eligibility thresholds.
 *
 * Approved by Stefan 2026-08-26 in place of a rounding convention.
 *
 * Why there is no rounding rule to implement: HHS states in writing that it
 * "does not calculate or prepare any official charts showing percentage
 * multiples of the poverty guidelines", and that "the rounding rules for these
 * calculations, as well as procedures for calculating monthly income, are
 * determined by the federal, state, and local program offices". So any single
 * convention we adopted would be wrong for some programme, and the 138/200/250/
 * 400% columns are our construction rather than a federal artifact.
 *
 * The same sentence names what actually dominates: "procedures for calculating
 * monthly income". Deductions, disregards and MAGI-versus-gross move a
 * determination by hundreds or thousands of dollars, and an income figure given
 * at a benefits centre is frequently an estimate — hourly and shift work make it
 * approximate by far more than the cents a rounding rule would decide. Choosing
 * a rounding convention would be precision theatre on top of that.
 *
 * So instead of pretending to a crisp answer at the margin, say so: "you are
 * close to this line; whether you qualify depends on how this programme counts
 * your income, which the caseworker decides."
 *
 * This is deterministic code, not an instruction to the model, for the same
 * reason as the staleness guard: an instruction is a request whose compliance
 * varies by model, and the deployed backend is not chosen yet.
 */

/**
 * Half-width of the band, in PERCENTAGE POINTS of FPL, applied either side of
 * each threshold.
 *
 * ±5 points is roughly $800/year — about $66/month — at the 100% line for a
 * single person. It is chosen to sit above the estimation error, not above the
 * rounding error: a band narrower than the noise in the input is theatre, and
 * one much wider stops BN answering the question it exists to answer.
 *
 * THIS IS A DEFENSIBLE STARTING POINT, NOT A DERIVED ONE. Instrument what
 * fraction of households land in the band and revisit with evidence. A number
 * nobody measures stays arbitrary forever.
 */
export const BAND_HALF_WIDTH_FPL_POINTS = 5;

/** A threshold BN reasons about, as a percentage of FPL. */
export interface Threshold {
  /** e.g. 138 */
  fplPercent: number;
  /** Short label for the person reading it, e.g. "Medicaid (expansion states)". */
  label: string;
}

export interface BoundaryProximity {
  threshold: Threshold;
  /** Signed distance in FPL points: negative below the threshold, positive above. */
  distancePoints: number;
  /** True when the household sits on the threshold side that qualifies. */
  above: boolean;
}

export interface BandResult {
  /** The household's income as a percentage of FPL. */
  fplPercent: number;
  /** Thresholds this household is too close to call against. */
  near: BoundaryProximity[];
  /** Convenience: any threshold is within the band. */
  isNearAnyBoundary: boolean;
}

/**
 * Which thresholds is this household too close to for a crisp answer?
 *
 * Thresholds are passed in rather than hardcoded: the FPL tables live in the
 * model's context document and are currently stale, so this module deliberately
 * does not embed them. Structure and figures are separable — see
 * fpl-vintage.ts for the staleness guard on the figures themselves.
 */
export function findNearBoundaries(
  fplPercent: number,
  thresholds: readonly Threshold[],
  halfWidth: number = BAND_HALF_WIDTH_FPL_POINTS,
): BandResult {
  const near: BoundaryProximity[] = [];

  for (const threshold of thresholds) {
    const distancePoints = fplPercent - threshold.fplPercent;
    if (Math.abs(distancePoints) <= halfWidth) {
      near.push({ threshold, distancePoints, above: distancePoints >= 0 });
    }
  }

  // Closest first: the most consequential line is the one they are nearest to.
  near.sort((a, b) => Math.abs(a.distancePoints) - Math.abs(b.distancePoints));

  return { fplPercent, near, isNearAnyBoundary: near.length > 0 };
}

/**
 * The wording for a household inside the band, or null when the answer is crisp.
 *
 * Deliberately does NOT say "you may not qualify" or "you may qualify" — the
 * point is that we do not know, and implying either direction is the error this
 * replaces. It names the reason (how income is counted) so the person has
 * something concrete to ask the caseworker about, rather than a vague hedge.
 */
export function boundaryNotice(result: BandResult): string | null {
  if (!result.isNearAnyBoundary) return null;

  const labels = result.near.map((n) => n.threshold.label);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;

  return (
    `Your household income is very close to the cut-off for ${list}. ` +
    `Whether you qualify depends on how that programme counts your income — ` +
    `things like deductions and which income is counted vary by programme and ` +
    `are decided by a caseworker, not by this tool. ` +
    `Please ask a benefits counsellor rather than treating this as a yes or a no.`
  );
}
