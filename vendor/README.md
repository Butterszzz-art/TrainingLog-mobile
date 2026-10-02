# vendor/

Third-party files served from our own origin instead of a CDN, so:

- visitors' IP addresses aren't sent to Google Fonts / jsDelivr / gstatic
  (no cookie or consent banner is needed for them under GDPR), and
- versions are pinned — a new upstream release can't change the app unreviewed.

| File | Source | Licence |
|---|---|---|
| `chart-4.5.1.umd.min.js` | npm `chart.js@4.5.1` `dist/chart.umd.min.js` | MIT |
| `confetti-1.9.3.browser.js` | npm `canvas-confetti@1.9.3` `dist/confetti.browser.js` | ISC |
| `litepicker-2.0.12.js` / `.css` | npm `litepicker@2.0.12` `dist/` | MIT |
| `firebase-app-compat-10.14.1.js`, `firebase-auth-compat-10.14.1.js` | npm `firebase@10.14.1` | Apache-2.0 |
| `fonts/` | Google Fonts: Anton, Archivo, Barlow Condensed, JetBrains Mono, Oswald, Poppins (Latin + Latin Extended, woff2) | SIL Open Font License 1.1 |

To upgrade: `npm pack <pkg>@<version>`, copy the file from the tarball, rename
it with the new version, and update the `<script>` tags and `sw.js` APP_SHELL.
Fonts: fetch the Google Fonts `css2` URL with a modern browser User-Agent, keep
the `latin` and `latin-ext` blocks, download their `woff2` files here and point
`fonts.css` at them.
