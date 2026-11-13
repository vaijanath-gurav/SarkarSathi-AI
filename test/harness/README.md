# Extension test harness
Runs the real extension/content.js, pick.js and offscreen.js on the demo form in a normal tab.
1. From the repo root: `python -m http.server 5700`
2. Open http://localhost:5700/test/harness/index.html
3. The app server must be running on http://localhost:3000 (API calls go there directly, CORS *).
4. chrome.* is faked in-page (storage in memory, API relay like background.js, PDF via offscreen.js).
5. Keyboard shortcuts are replaced by the banner buttons or `harness.feature('FILL'|'VOICE'|'FORMAT'|'COMPRESS'|'CLIENT')`.
6. `harness.log` lists every API/PDF call and its status.
