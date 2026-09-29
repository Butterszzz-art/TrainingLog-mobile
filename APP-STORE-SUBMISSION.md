# App Store submission checklist

Target: **EU first** (plus the rest of the world), **iPhone and iPad**.
What's done in code, and what still has to happen outside it. Work top to bottom.

## Done in code

### App (this repo, branch `feat/app-store-readiness`)
- **Payments (Guideline 3.1.1):** on iPhone/iPad, subscriptions are sold through
  **Apple In-App Purchase** in every country (`src/js/payments.js`, using
  `@capgo/native-purchases`). Prices come from the App Store in the user's
  currency (EUR in the EU). The iOS app never mentions or links to the website
  checkout. Web and Android keep Stripe.
- **Restore Purchases** in the upgrade sheet, the checkout sheet and
  Progress → Tools → Subscription. **Manage Subscription** opens Apple's
  subscription settings (or explains where a web subscription is managed).
- **Subscription disclosure (3.1.2):** before buying, the sheet shows the
  price, period, free trial, Apple's auto-renewal wording, and Terms/Privacy links.
- **Terms of Use** (`terms.html`) and **Privacy Policy** (`privacy.html`) cover
  App Store and Stripe purchases, AI, user content and GDPR rights.
- **AI consent (5.1.2(i)):** asked before any data goes to Anthropic.
- **Blocking and reporting (1.2)** on every profile card.
- **Account deletion (5.1.1(v))** in Settings, with the required warning that
  it doesn't cancel an App Store subscription.
- **App icon and splash:** the sign-in logo's plate art, 1024×1024,
  full-bleed (`assets/`).
- **iPad:** layouts checked at iPad portrait and landscape sizes.
- **CI (`codemagic.yaml`):** Capacitor 8, icon/splash generation, export
  compliance flag, and an `ios-app-store` workflow that uploads to TestFlight.

### Backend (`traininglog-backend`, branch `feat/moderation-blocks`)
- **Apple IAP** (`src/routes/appleIap.js`): receipt verification against
  Apple's root certificate, sandbox + production (App Review uses sandbox),
  per-account purchase tokens, renewals/refunds via server notifications.
- **CORS** now allows the iOS and Android apps (it blocked every app request before).
- Blocking, moderator emails for reports and blocks, and a word filter for
  usernames, names and bios.

## You need to do (can't be done from code)

### Legal
1. **Apple Developer Program** membership ($99/yr).
2. Add your **legal name and postal address** to `terms.html` and
   `privacy.html` (EU consumer law requires it for paid services).
3. ~~Governing law~~ done: the Netherlands (`terms.html` §11), with the Dutch
   Autoriteit Persoonsgegevens as the privacy authority (`privacy.html` §7).
4. Have someone qualified review the Terms and Privacy Policy.
5. **EU trader status (Digital Services Act):** App Store Connect asks whether
   you're a trader. Selling subscriptions makes you one, and Apple then shows
   your address, phone and email on your EU product page. **The app can't be
   listed in the EU until this is done.**

### App Store Connect — payments
6. Business → sign the **Paid Apps agreement** and add bank and tax details.
   Apply for the **App Store Small Business Program** (15% commission).
7. Create one subscription group ("Pocket Coach") with **exactly these four
   auto-renewable products**:
   - `com.pocketcoach.app.pro.monthly`, `com.pocketcoach.app.pro.annual`
   - `com.pocketcoach.app.coach.monthly`, `com.pocketcoach.app.coach.annual`

   Rank Coach above Pro. Set prices per country (Apple suggests EUR prices from
   your base price). Add a **1-week free trial introductory offer** to each if
   you want to keep the 7-day trial. Each product needs a display name,
   description and a review screenshot of the paywall.
8. App Information → **App Store Server Notifications**, Version 2, both
   Production and Sandbox:
   `https://us-central1-pocketcoach-280c4.cloudfunctions.net/api/api/iap/apple/notifications`
9. Users and Access → Sandbox → create a **sandbox tester**.

### Backend deploy
10. In the backend `.env`: `APPLE_IAP_ENABLED=true` and `APPLE_APP_ID=` (the numeric
    Apple ID from App Store Connect → App Information).
11. Deploy (use `$env:FUNCTIONS_DISCOVERY_TIMEOUT=60` in PowerShell if the deploy
    times out), then merge the backend pull request. Groups need the new
    Firestore index and rules too: `firebase deploy --only functions,firestore`.

### App Store Connect — listing
12. Create the app record: bundle ID `com.pocketcoach.app`, name "Pocket Coach".
13. **Availability:** all countries (or EU + chosen others).
14. **Privacy Policy URL:** your live `privacy.html`. Add a **Terms of Use (EULA)**
    link in the description or as a custom EULA (required for subscriptions).
15. **App Privacy form:** Contact Info (email), Health & Fitness, User Content
    (photos, posts), Identifiers (user ID), Purchases — all linked to the user,
    none used for tracking.
16. **Age rating:** answer "yes" to user-generated content.
17. **Screenshots:** 6.9" iPhone **and** 13" iPad (required because the app runs
    on iPad).
18. **Localization:** English is fine for the EU. Local languages are optional.
19. **Review notes:** a demo account with a verified email; say that
    subscriptions use In-App Purchase, and that users can report or block
    anyone from their profile card (tap an avatar). **Submit the four
    subscriptions together with the first app version.**

### Build and test
20. Codemagic: add an App Store Connect API key named **`Pocket Coach ASC key`**,
    then run the **iOS (App Store)** workflow.
21. On a real iPhone **and** iPad via TestFlight, signed in with the sandbox tester:
    sign-up, AI consent, buying Pro, Restore Purchases, Manage Subscription,
    block/report (check the moderation email), a group post and a group report, account deletion, camera/photo
    prompts.

### Worth fixing before or soon after launch
- **Community feed:** posts written in Community → Feed still only save on
  the device (Groups are now server-backed and shared).
- **Reports:** the Terms promise action within 24 hours. Watch the moderation inbox.
- **`pricing.html`** doesn't match the app's plans (hidden in the native app).
