# tools/form-scan.js — onboard a new portal form

Scans a saved government-portal page and drafts a mapping so the dev team can add or update a form.

1. Log in to the portal, open the form, press Ctrl+S, choose "Webpage, HTML only".
2. Run: `node tools/form-scan.js saved.html --name "EWS demo" --url-pattern "/path-fragment"`
   (optional `--out <dir>`, default `forms/drafts/`).
3. Read the printed field table (id, label, read-only, first dropdown options).
4. Open `forms/drafts/<slug>.json`: fill `fields` (`"#id": "profile.path"`), `selectChains`,
   `operator`, `hints`, `verify`, set `urlPattern`, then delete `_draft` and `_fields`.
   Use `forms/mahaonline-ews.json` as the worked example.
5. Move the file to `forms/<name>.json`. `loadForms()` reads every `*.json` in `forms/`, so
   never leave a draft there with an empty `urlPattern` (it would match every page).
6. Re-scan a fresh save when the portal changes and diff `_fields` to track form updates.

Privacy: saved pages contain the logged-in person's data. The scanner never prints `value=`
or typed text, but never commit saved pages; delete them after scanning.
