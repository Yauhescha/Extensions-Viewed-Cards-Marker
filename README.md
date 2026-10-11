# Viewed Cards Marker

A browser extension that remembers viewed items and highlights their cards when you return to a listing. Site-specific URL patterns and CSS selectors let you adapt it to different websites.

[Chrome Web Store](https://chromewebstore.google.com/detail/viewed-cards-marker/onkajnhookcmhnelamimonbgmomefmmg)

## Features

- Configure websites, detail pages, listing pages and card selectors.
- Identify items by normalized titles, URL patterns or custom key templates.
- Mark items on detail pages and reapply highlights to dynamically loaded lists.
- Add configurable action buttons and page actions.
- Store settings and viewed history locally, with optional Supabase synchronization.
- Import JSON data and export settings.
- Recover large histories through resumable uploads and exports split into parts.

The current source is the **Chrome Recovery 1.0.2** build. Its ordinary history/full-backup export buttons are disabled in favor of the recovery export tools.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open the extension's options and add or import a site configuration.
5. Visit that website, open the popup and grant access to the current site.

No package installation or build step is needed. The checked-in manifest targets Chromium Manifest V3.

## Configure a website

Set the host and page patterns, then supply selectors for a card, its link and title. Choose a key strategy that identifies the same item consistently across listing and detail pages. Save the configuration, visit an item and return to the list. The popup can apply the current configuration immediately.

## Data and synchronization

History and settings use `storage.local`. Supabase is optional: configure its URL, anon key and table names in **Sync**. The remote database must have the schema and access policies expected by the requests in `background.js`; this repository does not include a database migration script.

For large existing histories, use **Start / resume Recovery Sync** or **Safe export in parts**. Keep existing backups before using the replace-import action.

## Source layout

| File | Responsibility |
| --- | --- |
| `background.js` | Storage, messages, permissions, import/export and synchronization |
| `content.js`, `content.css` | Item detection, buttons and highlighting |
| `popup.*` | Current-site status and actions |
| `options.*` | Site configuration and recovery tools |

Site layouts can change. Update the corresponding selectors and patterns when item detection stops matching.
