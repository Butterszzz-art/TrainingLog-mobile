# App Store submission checklist

What's done in code, and what still has to happen outside it. Work top to bottom.

## Done in code

### App (this repo, branch `feat/app-store-readiness`)
- **Payments (Guideline 3.1.1 / 3.1.3):** Stripe on every platform via `src/js/payments.js`.
  On iOS the user sees a "You're leaving Pocket Coach" disclosure, then checkout
  opens in Safari. Capacitor hands every non-app URL to the default browser, so
  no plugin is needed. **Don't add `@capacitor/browser` for this**: it opens an
  in-app Safari sheet. The plan refreshes when the user comes back to the app.
- **Subscription disclosure (3.1.2):** the checkout sheet shows the price, billing
  period, auto-renewal, how to cancel, and links to the Terms and Privacy Policy.
- **Terms of Use** (`terms.html`): medical disclaimer, AI disclaimer, subscription
  terms, zero-tolerance policy for user content, and Apple's required EULA terms.
- **Privacy Policy** (`privacy.html`): rewritten to match what the app actually
  does (Firebase, Airtable, Anthropic, Stripe, email collection, GDPR rights).
- **AI consent (5.1.2(i)):** `src/js/ai-consent.js` asks before any data goes
  to Anthropic. Users can change it in Settings → App → Privacy & Legal.
- **Blocking (1.2):** every profile card (tap any avatar) has **Block / Unblock**,
  as well as Report and Hide photo. Blocked users disappear from the feed and
  leaderboard.
- **Legal links:** on sign-up ("By creating an account you agree…"), on the login
  screen, in Settings, and on the pricing page.
- **Account deletion (5.1.1(v)):** already in Settings → App → Danger Zone.
- **"Beta" banner removed** from the login screen (Guideline 2.2).
- **CI (`codemagic.yaml`):** no longer downgrades Capacitor 8 to 6. It now
  generates a real app icon and splash screen, sets
  `ITSAppUsesNonExemptEncryption=false`, and adds an `ios-app-store` workflow
  that signs the build and uploads it to TestFlight.

### Backend (`traininglog-backend`, branch `feat/moderation-blocks`)
- `POST/DELETE /api/profiles/:username/block` and `GET /api/profiles/blocks`.
  A block hides the user's profile from the blocker, ends their friendship,
  and stops friend requests either way.
- Profile reports and blocks post to a moderation webhook, so someone sees them
  within Apple's 24 hours.
- Display names and bios are checked against `OBJECTIONABLE_TERMS`.
- Account deletion also removes the user's block list.

## You need to do (can't be done from code)

### Before anything
1. **Apple Developer Program** membership ($99/yr).
2. **Decide who you're legally selling as** (sole trader or company). Add the
   legal name and a postal address to `terms.html` and `privacy.html`. UK/EU
   consumer law requires this for paid services.
3. **Confirm governing law** in `terms.html` §11 (currently England & Wales,
   based on £ pricing).
4. **Have someone qualified review the Terms and Privacy Policy.** They're a
   solid first draft, not legal advice.

### Backend deploy
5. Merge and deploy `feat/moderation-blocks` **before** shipping the app. The
   app's Block button calls routes that don't exist on the current backend.
6. Set these in the Cloud Function's environment:
   - `MODERATION_WEBHOOK_URL`: a Slack or Discord incoming webhook
   - `OBJECTIONABLE_TERMS`: comma-separated words to reject in names and bios
     (**empty means no filtering**)
   - `PROFILE_ADMINS`: your username, so you can remove photos and bios
7. Redeploy `firestore.rules` (`firebase deploy --only firestore:rules`).

### Storefronts and payments (the big one)
8. **Pick which countries to release in.** Linking out to Stripe instead of using
   Apple's In-App Purchase is allowed:
   - **US:** yes, no entitlement needed (since the 2025 Epic v. Apple injunction).
   - **EU:** only after Apple grants the *StoreKit External Purchase Link
     Entitlement*. Once granted, Apple requires its own system disclosure sheet
     (a native StoreKit API) and charges a commission. That needs a small native
     plugin that doesn't exist yet.
   - **UK and everywhere else:** generally not allowed. Your prices are in £,
     so check Apple's current UK rules before assuming UK users can pay this way.
   → **Recommended for v1: release in the US storefront only**, or add real
   Apple IAP for other territories. Otherwise expect a 3.1.1 rejection.
9. Stripe checkout currently charges in £. For a US launch, add USD prices in
   Stripe (and in `UPGRADE_PLANS` in `index.html`).

### App Store Connect
10. Create the app record: bundle ID `com.pocketcoach.app`, name "Pocket Coach".
11. **Privacy URL:** host `privacy.html` publicly (e.g. `https://pocketcoachcoms.org/privacy.html`).
    Add a **Terms of Use (EULA)** link to the app description, or set it as a
    custom EULA.
12. **App Privacy "nutrition label":** declare Contact Info (email), Health &
    Fitness, User Content (photos, posts), Identifiers (user ID), and
    Purchases. Mark all of them "linked to user" and none as used for tracking.
13. **Age rating questionnaire:** answer "yes" to user-generated content.
14. **Screenshots:** 6.9" iPhone (required), plus iPad if you support iPad.
15. **Review notes:** give Apple a demo account with Pro unlocked, and explain:
    "Subscriptions are sold on our website via Stripe under the US storefront
    external-purchase rules; the app shows a disclosure before opening Safari.
    Users can report or block anyone from their profile card (tap an avatar)."
16. **Support URL** and support email.

### Codemagic
17. Team settings → Integrations → Developer Portal: add an App Store Connect
    API key named **`Pocket Coach ASC key`** (or change the name in `codemagic.yaml`).
18. Start the **iOS (App Store)** workflow manually. It builds, signs, and uploads
    to TestFlight.
19. **Test on a real iPhone via TestFlight**, especially: sign-up, the AI consent
    sheet, checkout → Safari → back to the app (the plan should refresh), the
    billing portal, block/report, account deletion, and the camera/photo
    permission prompts.

### Worth fixing before or soon after launch
- **App icon:** CI upscales `public/icons/icon-512.png`. Export a real
  1024×1024 version with no transparency and no rounded corners. `plate.jpg`
  can't be used: it has white rounded corners and an image-generator watermark.
- **Community groups:** posts go to `/community/*` routes that don't exist on
  the backend, so they're only saved on the device and nobody else sees them.
  Hide the Groups tab or build the backend. If you build it, it needs the same
  moderation: report a post, filter the text, and hide posts from blocked users.
- **Reports:** the Terms promise action within 24 hours. Watch the moderation
  webhook channel.
- **`pricing.html`** is out of date with the in-app plans (it's hidden inside
  the native app). Update it before sending web traffic to it.
