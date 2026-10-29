# PAY2-0 — Payments audit

Read-only audit before the Payments v2 rework (PAY2-1 → PAY2-8). Snapshot taken
2026-10-29 against `TrainingLog-mobile@708298b` (main) and
`traininglog-backend-sync@main` (pulled, up to date). No source files changed.

Line numbers are for those commits. `index.html` is the monolith; most gating
lives there.

---

## 1. Plan gating

### 1a. Frontend helpers (index.html)

| Helper | Where | Rule |
|---|---|---|
| `loadUserPlan()` | index.html:4671 | `GET /api/user/plan` → sets `currentUserPlan`, `currentSubStatus`, `currentSubSource`, `currentReferralCode`, `currentReferralCredits`, `currentIsAdmin`, `currentUserPlanLoaded`; caches `userPlan` / `userIsAdmin` in localStorage. On a thrown error falls back to cached `userPlan`. |
| `isPro()` | index.html:4695 | plan is `pro` or `coach` (billing screens) |
| `hasPaidAccess()` | index.html:4699 | `isPro()` or admin — used for every AI / premium gate |
| `hasCoachAccess()` | index.html:4707 | plan `coach` or admin |
| `coachPlanKnownMissing()` | index.html:4714 | plan known and not coach |
| `isCoach()` | index.html:4718 | plan `coach` |
| `isActiveSub()` | index.html:4719 | status `active`/`trialing` — **no call sites** besides the export |
| `isProUser()` | index.html:13815 | alias of `hasPaidAccess()` |
| `renderLockedCard(name, plan)` | index.html:4725 | locked card with "Available on Pro (from £x)" and an upgrade button |
| `openUpgradeModal(plan)` | index.html:4891 | upgrade sheet; billing cycle from `localStorage.billingCycle` (default annual) |

### 1b. Frontend gating call sites

| File:line | Feature | Gate | What a free user sees |
|---|---|---|---|
| index.html:2539 | AI Program Generator | `progAiGenLocked` row | "AI Program Generator — Pro feature" row → upgrade modal on tap |
| index.html:4948 | Manage billing | `!isPro() && !isCoach()` | upgrade modal instead of the Stripe portal |
| index.html:11104 | Coach Mode switch | coach plan | upgrade modal ('coach') |
| index.html:13824 | **AI check-in summary** | `isProUser()` | **locked "Upgrade" card shown right after submitting a check-in** (see §3) |
| index.html:16020 | Plateau detector (Progress tab) | `isProUser()` | nothing (silent return) |
| index.html:20968 | Macro AI advisor | `isProUser()` | upgrade path on tap |
| src/js/ai-consent.js:149,159 | **Every `/api/ai/*` and `/ai/*` fetch** | `knownFreeAccount()` short-circuit + server 403 | fake 403; toast "AI features are part of Pocket Coach Pro." **and** upgrade modal if any pointerdown/keydown happened in the last 5 s |
| src/js/exerciseAutoClassify.js:69 | Background exercise classify | `hasPaidAccess()` | nothing (skipped) |
| src/js/food-database.js:224 | AI food search assist | `hasPaidAccess()` | nothing (plain search only) |
| src/js/nutrition-review.js:91,172 | Weekly nutrition review AI wording | consent + `hasPaidAccess()` | rules-only review |
| src/js/premium-library.js:242,304,535 | Premium library items | `renderLockedCard` / `hasPaidAccess()` | locked card / "Upgrade" upsell |
| src/js/program-import.js:63 | Program import (AI) | server 403 → `openUpgradeModal('pro')` | upgrade modal after tap |
| src/js/body-hub.js:325 | Body tab "Coach takeaways" | **none** (relies on interceptor) | auto AI call → interceptor (see §3) |
| src/js/coach-brief.js:151 | Home brief | **none** (relies on interceptor) | auto AI call → interceptor (see §3) |
| src/js/coach-review.js:190 | Weekly review AI wording | **none** (relies on interceptor) | auto AI call → interceptor |
| src/js/rehab.js:315 | AI rehab plan | **none** (relies on interceptor) | tap → interceptor modal |
| src/js/ProgramTabV2.js:1075 | Program analysis | **none** (relies on interceptor) | tap → interceptor modal |
| src/js/data-export.js | CSV/JSON export | **none** | free today (PAY2-6 will gate) |

### 1c. Backend gating (`src/planAccess.js`, `server.js`)

`createPlanAccess()` → `requirePaidPlan` (plan ∈ {pro, coach} or admin) and
`requireCoachPlan` (plan = coach or admin). Plan comes from `getUserPlanInfo()`
(Firestore `users/{uid}`, Airtable fallback). Lookup errors → 503
`plan.lookup_failed`.

| Endpoint(s) | Gate | Error on fail |
|---|---|---|
| `POST /ai/chat` (server.js:4471, legacy) | requirePaidPlan | 403 `plan.upgrade_required` |
| `/api/ai/*` (server.js:4519 — all of `src/routes/ai.js` + `src/routes/coach.js`) | aiLimiter + requirePaidPlan | 403 `plan.upgrade_required`; 429 `ai.rate_limited` |
| `/api/premium/*` (server.js:4530) | own check inside `src/routes/premium.js` | premium router error |
| `GET /api/coach/clients`, `POST /api/coach/clients/invite`, `GET/DELETE/PATCH /api/coach/clients/:clientUid`, `GET/PUT/DELETE /api/coach/programs[/:id]`, `POST/GET /api/coach/clients/:clientUid/notes`, `GET/PATCH /api/coach/leads[/:id]` (server.js:2978–3831) | requireCoachPlan | 403 `plan.coach_required` |
| `POST /coach/workouts`, `POST/GET/DELETE /coach/exercise-videos` (server.js:3858–4073) | requireCoachPlan | 403 `plan.coach_required` |
| `/api/coach/nutrition`, `/api/coach/foods`, `/api/coach/plans`, `/api/coach/videos` (server.js:4671–4735) | requireCoachPlan | 403 `plan.coach_required` |

No logging route (bodyweight, workouts, macros, cardio, check-ins, measurements,
crossfit) has a plan check on the server.

---

## 2. Billing

### 2a. Backend

| Piece | Where | Notes |
|---|---|---|
| Stripe init | server.js:251 | enabled only if `STRIPE_SECRET_KEY` set |
| Stripe webhook | `POST /api/stripe/webhook` server.js:305 | raw body; handles `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`. Uses `metadata.username/plan/billing`. **Not idempotent** (no processed-event store); **no `charge.refunded`**; ignores `mode: 'payment'`. |
| Checkout | `POST /api/stripe/create-checkout-session` server.js:514 | body `{ username, plan, billing, withdrawalWaiver }`; `withdrawalWaiver !== true` → 400. Subscription mode only. **Trial: `referralCredits * 30` days, else 7 days.** Prices from `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`, `STRIPE_COACH_MONTHLY_PRICE_ID`, `STRIPE_COACH_ANNUAL_PRICE_ID`. |
| Billing portal | `GET /api/stripe/portal` server.js:577 | uses `users/{uid}.stripeCustomerId` (Airtable fallback) |
| Plan writer | `applyEntitlement()` server.js:987 | single writer for both rails; sets Firestore user fields + Firebase custom claim `tier` |
| Apple IAP | `src/routes/appleIap.js`, mounted `/api/iap/apple` | `GET /account-token` (UUID → `users/{uid}.appleAccountToken`), `POST /verify` (`signedTransaction`), `POST /notifications` (ASSN v2). `PRODUCT_PLAN_MAP` has 4 IDs (pro/coach × monthly/annual). `EXPIRED/REFUND/REVOKE/GRACE_PERIOD_EXPIRED` → free; `DID_FAIL_TO_RENEW` → past_due. |
| Plan read | `getUserPlanInfo()` server.js:460, `GET /api/user/plan` server.js:502 | returns `{ plan, status, periodEnd, billingCycle, source, referralCode, referralCredits, admin }`. **On error returns 200 `{ plan: 'free', status: 'none' }`.** |
| Referral | `GET /api/referral/validate`, `GET /api/referral/stats` server.js:812–885; signup writes `referralCode`, `referralCredits: 0`, `referredByCode`, `referredByUid` (server.js:1146–1186) | No code path found that increments `referralCredits`. |

### 2b. Firestore fields (`users/{uid}`)

| Field | Meaning |
|---|---|
| `userPlan` | `'free' \| 'pro' \| 'coach'` |
| `subStatus` | Stripe/Apple status (`active`, `trialing`, `past_due`, `canceled`, …) |
| `subCurrentPeriodEnd` | ISO string or null |
| `billingCycle` | `'monthly' \| 'annual'` |
| `subSource` | `'stripe' \| 'apple'` |
| `stripeCustomerId` | Stripe customer |
| `appleAccountToken`, `appleOriginalTransactionId` | Apple linking |
| `referralCode`, `referralCredits`, `referredByCode`, `referredByUid` | Referrals |

No entitlements subcollection, no counters, no AI usage collection exist yet.

### 2c. Frontend

| Piece | Where | Notes |
|---|---|---|
| `loadUserPlan()` | index.html:4671 | doesn't check `res.ok`; see Surprises |
| `planPrice(key, billing)` | index.html:4744 | iOS → `pocketCoachPayments.applePrice()`; web → hard-coded **GBP** from `UPGRADE_PLANS` (Pro £9/£7, Coach £16/£13), "7-day free trial" |
| `UPGRADE_PLANS` | index.html:~4834 | feature lists + `annualNote: 'Billed £84/year · save £24'`, `'Billed £156/year · save £36'` |
| Upgrade modal | `openUpgradeModal` index.html:4891, `refreshModalPrices`, `toggleModalBilling` (stores `billingCycle`) | annual default only when nothing stored |
| Stripe checkout call | index.html:4821 | |
| Billing portal call | index.html:4953 | |
| Referral stats / link | index.html:4997–5007 | links already use `https://pocketcoachcoms.org/#signup?ref=` |
| `src/js/payments.js` | `APPLE_PRODUCTS` (line 26): pro/coach × monthly/annual only; StoreKit via `@capgo/native-purchases` |
| `pricing.html` | 3 `price-block`s (lines 454/484/508), feature table (538), FAQ (583); **8 `£` occurrences** |
| `payment-success.html` | reads `?plan=`; no one-off handling |

---

## 3. Free-tier blockers

**Method:** traced in code; **not reproduced live** (no free test account
signed in for this audit). The trace below is deterministic from the code.

### 3a. Upgrade prompt after logging bodyweight — cause identified

1. `addWeightEntry()` (index.html:14287) saves
   locally with no plan check and no network await. That part is fine.
2. The new weigh-in changes the facts fingerprint of two auto-loading AI cards:
   Body tab **Coach takeaways** (`src/js/body-hub.js:351 renderBodyCoach`) and
   Home **brief** (`src/js/coach-brief.js:181 renderCoachBrief`). Neither has a
   client-side plan check.
3. The next time either renders — the user taps back to the Body tab
   (index.html:5431), taps Home (index.html:12010), or cloud-sync applies a pull
   (`src/js/cloud-sync.js:484` always calls `renderBodyHub`) — it fires
   `POST /api/ai/coach/body` or `/api/ai/coach/brief`.
4. `src/js/ai-consent.js` intercepts it. `knownFreeAccount()` is true, so it
   returns `upgradeRequiredResponse()`. Because the user's **navigation tap**
   happened < 5 s ago (`lastInteraction`, any `pointerdown`), it shows the toast
   "AI features are part of Pocket Coach Pro." **and** opens the upgrade modal.

The same chain fires after logging a meal, cardio or a workout whenever it
changes the Home brief / Body takeaways facts. The 5 s "last pointerdown"
heuristic can't tell a navigation tap from an AI-button tap.

### 3b. Check-in submit shows a locked upgrade card

`saveCheckIn` path (index.html:14013) calls `requestAiCheckInSummary()` for
every athlete save; for free users (index.html:13824) it immediately renders a
"Upgrade to Pro to get an AI-generated summary…" card with an **Upgrade**
button right under the check-in they just submitted. Violates the upgrade rule.

### 3c. Paid user treated as free when the plan call fails

`GET /api/user/plan` returns **200 `{plan:'free'}`** on any server error, and
`loadUserPlan()` writes that over the cached plan. A paying user then gets the
free-account short-circuit and upgrade prompts until the next successful load.

### 3d. Legacy "Airtable" code

| Item | Where | Status |
|---|---|---|
| `archiveBodyweightToAirtable` | def index.html:18665; calls index.html:5279, 14336 | **Misnamed, not dead**: posts to `/bodyweight/archive`, which writes Firestore `users/{uid}/bodyweightArchives` for migrated users (Airtable only for unmigrated). Removing it per PAY2-1 drops those archives (cloud-sync still syncs the raw log). |
| `syncMeasurementsToAirtable`, `syncCardioToAirtable`, `syncCrossfitToAirtable` | index.html:5280–5282, 14829; body-measurements.js | Same: hit `/measurements/sync`, `/cardio/sync`, `/crossfit/sync`, Firestore-first. |
| `saveToAirtable` (macro targets) | index.html:10446; client-coaching.js | Misnamed: hits `/macrotargets` (Firestore-first). |
| `fetchAirtableConfig`, `airtableToken`, `airtableBaseId` | index.html:4323–4501 | `/config` only returns `airtableBaseId`; `airtableToken` is never set → dependent paths never run. |
| `MacroTargetsApiUrl` (direct api.airtable.com) | index.html:4506 | **Dead** (unused constant). |
| Check-in AI summary patch to `${SERVER_URL}/airtable/{base}/CheckIns` | index.html:13906–13911 | **Dead**: no `/airtable/*` route on the backend; guarded by `airtableToken` (always empty). |
| index.html:18077 `Authorization: Bearer ${airtableToken}` | index.html:18077 | **Dead** (empty token). |
| `src/js/mobility.js:146,178,190` | direct Airtable with `window.airtableToken` | **Dead** (empty token). |

No call to a non-existent endpoint fires in normal use, apart from the guarded
`/airtable/` check-in patch above.

---

## 4. AI inventory

All `/api/ai/*` routes sit behind `authenticateToken + aiLimiter (30 req / 15
min, keyed by IP) + requirePaidPlan`. **No per-user or monthly usage limit
exists today.** Some auto cards have their own client-side daily caps.

| Endpoint | Backend | Frontend caller | Trigger | Existing limit |
|---|---|---|---|---|
| `POST /ai/chat` (legacy) | server.js:4471 | none found (only tests/aiConsent.test.js) | — | requirePaidPlan only |
| `POST /api/ai/chat` | src/routes/ai.js:47 | none found | — | aiLimiter |
| `POST /api/ai/checkin-summary` | ai.js:64 | index.html:13881 (`requestAiCheckInSummary`); coach/coach.js:1594 (`aiAnalyse`) | **auto** after check-in save; coach portal: tap | aiLimiter |
| `POST /api/ai/macro-advice` | ai.js:111 | index.html:20968 (`openMacroAiAdvisor`) | tap | aiLimiter |
| `POST /api/ai/program-analysis` | ai.js:162 | src/js/ProgramTabV2.js:1149 | tap ("Analyse"), cached per program | aiLimiter |
| `POST /api/ai/generate-program` | ai.js:189 | index.html:21273 (`submitProgAiGen`) | tap | aiLimiter |
| `POST /api/ai/plateau-check` | ai.js:231 | index.html:16079 (`runPlateauCheck`) | **auto** on Progress tab open (index.html:5490), cached per ISO week | aiLimiter + weekly cache |
| `POST /api/ai/coach-draft-message` | ai.js:254 | index.html:12801; coach/coach.js:1639,1654 | tap (coach) | aiLimiter |
| `POST /api/ai/profile-summary` | ai.js:287 | index.html:19519 (`generateAiProfileSummary`) | tap | aiLimiter |
| `POST /api/ai/sleep-insight` | ai.js:311 | index.html:20008 (`requestSleepInsight`, button index.html:3824) | tap | aiLimiter |
| `POST /api/ai/classify-exercises` | ai.js:339 | src/js/exerciseAutoClassify.js:93 | **auto** background, paid-only client gate | aiLimiter |
| `POST /api/ai/food-search-assist` | ai.js:355 | src/js/food-database.js:268,278 | **auto** on weak search results, paid-only client gate | aiLimiter |
| `POST /api/ai/rehab-plan` | ai.js:374 | src/js/rehab.js:328 | tap | aiLimiter |
| `POST /api/ai/coach` (stream) | src/routes/coach.js:65 | src/js/ai-coach.js:111 | tap (per message) | aiLimiter |
| `POST /api/ai/coach/brief` | coach.js:295 | src/js/coach-brief.js:160 | **auto** on Home render, per-day + fingerprint cache | aiLimiter + client cache |
| `POST /api/ai/coach/review` | coach.js:417 | src/js/coach-review.js:198 | **auto** when weekly recap renders | aiLimiter + client cache |
| `POST /api/ai/coach/nutrition-review` | coach.js:463 | src/js/nutrition-review.js:108 | **auto**, paid + consent client gate | aiLimiter + client cache |
| `POST /api/ai/coach/body` | coach.js:507 | src/js/body-hub.js:332 | **auto** on Body tab render, max 3/day client-side | aiLimiter + client cap |
| `POST /api/ai/coach/import-program` | coach.js:546 | src/js/program-import.js:130 | tap (file upload) | aiLimiter |
| `programBuilderV2Core.js:623`, `coach-data.js:674` | — | comments only / data pack builder, no fetch | — | — |

Suggested PAY2-3 feature keys: `checkin-summary`, `macro-advisor`
(macro-advice), `program-analyser` (program-analysis), `programGenerator`
(generate-program), `plateau-detector`, `draftMessage` (coach-draft-message),
`profile-summary`, `sleep-insight`, `classify-exercises`, `food-search-assist`,
`rehab-plan`, `coach-chat`, `home-brief`, `weekly-review`, `nutrition-review`,
`body-takeaways`, `program-import`. The pack's free `allowedFeatures` list
doesn't mention the auto cards (brief, body, weekly review) or rehab /
profile / classify / food assist — decide in PAY2-3 whether auto cards spend
credits (recommend: no, keep them rules-only for free users so credits are only
spent on taps).

---

## Surprises

1. **Stripe price env var names don't match the pack.** Backend reads
   `STRIPE_PRO_MONTHLY_PRICE_ID` etc.; PAY2-4 introduces `STRIPE_PRICE_PRO_MONTHLY`.
   Either keep both names or rename in Render at the same time.
2. **Stripe checkout already grants a 7-day card-required trial** (or
   `referralCredits × 30` days). That overlaps the planned 14-day reverse trial
   and the "1 week per referral" reward. Decide in PAY2-7/8 whether to drop it.
3. **Nothing ever increments `referralCredits`.** The referral reward is
   effectively unimplemented; PAY2-8 is building it rather than extending it.
4. **The "Airtable" sync helpers aren't dead.** They're misnamed Firestore
   writers (see §3d). PAY2-1's "remove `archiveBodyweightToAirtable()`" would
   delete the bodyweight archive feature; recommend renaming instead, and
   removing only the truly dead pieces (`MacroTargetsApiUrl`, `airtableToken`
   paths, `/airtable/` check-in patch, mobility.js direct Airtable calls).
5. **`/api/user/plan` returns free on error** and the frontend overwrites the
   cached plan with it (§3c). Should return 5xx and the client keep its cache.
6. **Webhook isn't idempotent and doesn't handle refunds** (Stripe), and only
   handles subscription mode. Needed for PAY2-5.
7. **`aiLimiter` is keyed by IP**, not user — users behind the same NAT share 30
   requests / 15 min, and one user on several networks isn't capped.
8. **Several auto-loading AI cards have no client plan check** (Home brief,
   Body takeaways, weekly review) and rely solely on the interceptor; that's the
   root of §3a.
9. Prices are GBP on web (£9/£7 Pro, £16/£13 Coach) and in `pricing.html`
   (8 occurrences); Apple shows localized prices. Old worktrees under
   `.claude/worktrees/` also contain `£` and should be excluded from the PAY2-4
   grep test.
10. `isActiveSub()` is defined but not used for gating anywhere; gating is
    purely on `userPlan`, so `past_due` subscribers keep access until Stripe
    deletes the subscription.
