
# Benefit Navigator Domain Context

Standards for benefit discovery, eligibility validation, insurance comparison, and action planning in the public benefits and insurance domain.

## Core Principle

Information without action is overhead. The user came to get enrolled, not to read a report. Every output must answer: "What do I do Monday morning?"

## Federal Poverty Level (FPL) Reference

FPL is the foundation for almost all benefit eligibility. Always calculate and state it explicitly.

### 2025 HHS Poverty Guidelines (48 contiguous states + DC)

| Household Size | 100% FPL | 138% FPL (Medicaid expansion) | 200% FPL (CHIP typical) | 250% FPL (CSR) | 400% FPL (ACA subsidy cliff) |
|---|---|---|---|---|---|
| 1 | $15,650 | $21,597 | $31,300 | $39,125 | $62,600 |
| 2 | $21,150 | $29,187 | $42,300 | $52,875 | $84,600 |
| 3 | $26,650 | $36,777 | $53,300 | $66,625 | $106,600 |
| 4 | $32,150 | $44,367 | $64,300 | $80,375 | $128,600 |
| 5 | $37,650 | $51,957 | $75,300 | $94,125 | $150,600 |
| 6 | $43,150 | $59,547 | $86,300 | $107,875 | $172,600 |
| +each | +$5,500 | +$7,590 | +$11,000 | +$13,750 | +$22,000 |

### Alaska

| Household Size | 100% FPL | 138% FPL | 200% FPL | 250% FPL | 400% FPL |
|---|---|---|---|---|---|
| 1 | $19,560 | $26,993 | $39,120 | $48,900 | $78,240 |
| 2 | $26,440 | $36,487 | $52,880 | $66,100 | $105,760 |
| 3 | $33,320 | $45,982 | $66,640 | $83,300 | $133,280 |
| 4 | $40,200 | $55,476 | $80,400 | $100,500 | $160,800 |
| +each | +$6,880 | +$9,494 | +$13,760 | +$17,200 | +$27,520 |

### Hawaii

| Household Size | 100% FPL | 138% FPL | 200% FPL | 250% FPL | 400% FPL |
|---|---|---|---|---|---|
| 1 | $18,000 | $24,840 | $36,000 | $45,000 | $72,000 |
| 2 | $24,340 | $33,589 | $48,680 | $60,850 | $97,360 |
| 3 | $30,680 | $42,338 | $61,360 | $76,700 | $122,720 |
| 4 | $37,020 | $51,088 | $74,040 | $92,550 | $148,080 |
| +each | +$6,340 | +$8,749 | +$12,680 | +$15,850 | +$25,360 |

### US Territories

Guam, Puerto Rico, US Virgin Islands, American Samoa, and CNMI have separate benefit structures:

- **Puerto Rico & USVI**: Use 48-state FPL guidelines but have a **block grant** structure for Medicaid (not standard federal matching). Coverage is more limited.
- **Guam & American Samoa & CNMI**: Block grant Medicaid. No ACA marketplace — residents use local health programs.
- **All territories**: Not eligible for ACA marketplace subsidies (APTC). SNAP equivalent is NAP (Nutrition Assistance Program) in PR and CNMI, with fixed block grant funding and lower benefit levels.

When the user is in a territory, the agent MUST:
1. Use the correct FPL table (48-state for PR/USVI, territory-specific for others)
2. Note that ACA marketplace subsidies do NOT apply
3. Research territory-specific health programs instead of ACA
4. Note that SNAP is replaced by NAP with different benefit levels

**Note:** These guidelines are updated annually (typically January). Always verify against the current year's HHS guidelines when the workflow runs.

## Benefit Program Quick Reference

### Federal Programs by Agency

| Program | Agency | Income Limit | Who | Key Requirement |
|---|---|---|---|---|
| Medicaid (expansion) | HHS/CMS | 138% FPL | Adults | State must have expanded |
| Medicaid (traditional) | HHS/CMS | Varies by state | Pregnant, disabled, elderly | Categorical eligibility |
| CHIP | HHS/CMS | ~200-300% FPL (varies by state) | Children under 19 | State-specific thresholds |
| SNAP | USDA/FNS | 130% FPL gross / 100% net | All | Asset test varies by state |
| WIC | USDA/FNS | 185% FPL | Pregnant, postpartum, children <5 | Nutritional risk assessment |
| LIHEAP | HHS/ACF | 150% FPL or 60% state median | All | Heating/cooling season |
| Section 8/HCV | HUD | 50% area median income | All | Waitlist, lottery |
| TANF | HHS/ACF | Varies by state | Families with children | Time-limited (60 months federal) |
| Head Start | HHS/ACF | 100% FPL | Children 3-5 | Slot availability |
| CCDF | HHS/ACF | 85% state median income | Working parents | State-administered |

### Medicaid Expansion Status (as of 2025)

This is the single largest state-by-state eligibility variable. In expansion states, adults under 65 with income up to 138% FPL qualify for Medicaid. In non-expansion states, many adults fall into the "coverage gap" — earning too much for traditional Medicaid but too little for ACA marketplace subsidies.

**Non-expansion states (10):** Alabama, Florida, Georgia, Kansas, Mississippi, South Carolina, Tennessee, Texas, Wisconsin*, Wyoming

*Wisconsin covers adults up to 100% FPL under a waiver but has not formally expanded.

**All other states + DC have expanded Medicaid.**

When a user is in a non-expansion state, the agent MUST:
1. Check if they fall in the coverage gap (income below 100% FPL)
2. Research state-specific alternatives (waivers, state-funded programs)
3. Note that ACA marketplace subsidies start at 100% FPL in these states (not 138%)

### State-Specific Variations to Always Check

- **Short-term insurance duration**: Ranges from banned (several states) to 364 days (most states). Always verify for the user's state.
- **CHIP income thresholds**: Range from 200% to 400%+ FPL depending on state. Never assume 200%.
- **SNAP asset tests**: Many states have eliminated the asset test via broad-based categorical eligibility. Check state policy.
- **State-funded programs**: Many states offer programs beyond federal minimums (e.g., NY Essential Plan, CA Medi-Cal expansions, MN MinnesotaCare). Always research the specific state.

### Insurance Channels

| Channel | Subsidy? | Pre-existing? | ACA-compliant? | Best For |
|---|---|---|---|---|
| ACA Marketplace | Yes (APTC + CSR) | Covered | Yes | Most uninsured people |
| Off-marketplace carrier | No | Covered | Yes | High income (no subsidy benefit) |
| Short-term medical | No | Excluded | No | Coverage gaps <12 months |
| Health sharing ministry | No | May exclude | No | Religious communities, healthy individuals |
| ICHRA | Employer-funded | Covered | Yes | Small business employees |
| QSEHRA | Employer-funded | Covered | Yes | Small business employees (<50) |

## Quality Standards

### Source Verification Protocol

Every claim in the output must carry a confidence classification:

| Confidence | Meaning | When to Use | Notation |
|---|---|---|---|
| VERIFIED | Matches reference data in this context document | FPL calculations, Medicaid expansion status, federal program thresholds | (verified) |
| RESEARCHED | From a .gov source or official program page | State-specific thresholds, enrollment dates, program names | (source: URL) |
| ESTIMATED | Calculated from known formulas or documented averages | Benefit dollar values, subsidy amounts, cost scenarios | (estimated) |
| UNVERIFIED | Could not confirm from authoritative source | Any claim without a .gov or official source | (unverified — verify before acting) |

**Verification rules:**
- Every program must cite a .gov URL or official program page — mark as RESEARCHED
- Every FPL calculation must be verifiable against the tables in this document — mark as VERIFIED and show the math
- Every income threshold must state the dollar amount, not just the FPL percentage
- Every enrollment window must state specific dates, not "seasonal"
- Never fabricate program names, URLs, or eligibility criteria
- Dollar value estimates must state the source (benefit table, calculator, documented average) — mark as ESTIMATED
- If a claim cannot be sourced, it MUST be marked UNVERIFIED — do not present unverified claims as facts

### Cross-Verification Requirements

The Eligibility Analyst MUST verify the following against this context document:

1. **FPL math check** — Recalculate FPL percentage from scratch using the tables above. If the Benefits Researcher's calculation differs, flag it as an error with the correct value.
2. **Medicaid expansion check** — Verify the state's expansion status against the list above. If the researcher assumes expansion in a non-expansion state (or vice versa), flag it.
3. **Program existence check** — For each program cited, verify it exists in the stated state. Flag any program that appears to be a federal program claimed as state-specific, or a state program that doesn't exist in that state.
4. **Threshold plausibility check** — Compare cited income thresholds against the FPL table. If a threshold doesn't align with a standard FPL percentage (100%, 138%, 150%, 185%, 200%, 250%, 300%, 400%), flag it for verification.
5. **Internal consistency check** — Verify that all agents used the same household size, income, and FPL percentage. Inconsistencies across phases are errors.

### Income Cliff Protocol

Flag an income cliff warning when:
- User's income is within 10% of a program's disqualification threshold
- Quantify the annual value of the benefit at risk
- State the exact dollar amount where eligibility changes

Example: "At $42,000 (198% FPL), both children qualify for CHIP. At $42,510 (201% FPL), CHIP eligibility is lost. Annual value at risk: $3,600 in avoided premiums."

### Coverage Gap Protocol

After all eligible programs are identified, check for gaps in:
- [ ] Healthcare (medical)
- [ ] Dental (adult — children often covered by CHIP/Medicaid)
- [ ] Vision (adult)
- [ ] Prescription drug coverage
- [ ] Disability insurance
- [ ] Life insurance
- [ ] Mental health / substance abuse

For each gap, identify the lowest-cost option to fill it.

## Voice & Tone

Write like a knowledgeable, compassionate benefits counselor — not a government website. The person reading this output may be stressed, time-constrained, and overwhelmed by bureaucracy. They need clarity, not comprehensiveness for its own sake.

- **Lead with what matters most** — total value, critical deadlines, coverage gaps
- **Quantify everything** — "$535/month" not "food assistance"; "$5,508/year in avoided premiums" not "significant subsidy"
- **Use state-specific program names** — "Texas CHIP" not "CHIP"; "Your Texas Benefits" not "the state portal"
- **Explain jargon inline** — "APTC (the subsidy that lowers your monthly premium)" not just "APTC"
- **Be direct about bad news** — "Texas has not expanded Medicaid, which means you fall in a coverage gap — you earn too much for traditional Medicaid but would qualify in 40 other states" is more useful than omitting this entirely
- **Show the math** — "Family of 3 at $42,000 = 157.6% FPL ($42,000 ÷ $26,650)" so the user can verify and update when their income changes
- **Group by "one trip" opportunities** — if SNAP and CHIP use the same office and documents, say so

## Anti-Patterns to Avoid

- **Listing without quantifying** — Don't just list programs; estimate the dollar value for THIS household
- **Burying the lead** — Total annual value and the #1 action item must appear in the first paragraph, not page 4
- **Ignoring state variation** — Medicaid expansion status, CHIP thresholds, short-term insurance duration all vary by state
- **Presenting health sharing as insurance** — Always include a "not insurance" disclaimer
- **Vague timelines** — "Apply soon" is never acceptable; use specific dates
- **Missing the cliff** — Every eligibility determination must check proximity to income thresholds
- **Assuming single coverage need** — Check each household member independently; children and adults often qualify for different programs
- **Saying "contact your state agency" or "check your local office"** — provide the actual URL, phone number, or office address
- **Omitting the coverage gap in non-expansion states** — This is often the single most impactful finding and must be called out prominently with alternatives
