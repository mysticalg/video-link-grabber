# Chrome Web Store Submission Notes

Last updated: March 24, 2026

## Suggested Single Purpose

Identify likely video links that already exist on the current page and present them clearly so the user can inspect or copy them.

## Short Description

Scan the current tab for video links, stream manifests, and poster images.

## Detailed Description

Video Link Grabber scans the current page when you open the extension popup and lists likely video-related URLs it finds in video tags, metadata, page links, and page HTML.

It helps users inspect direct file links, spot stream manifests such as HLS or DASH playlists, and copy the URLs they are allowed to use. The extension does not bypass DRM, paywalls, or protected streams, and it does not monitor browsing activity in the background.

## Permissions Justification

- `activeTab`: used so the extension only scans the page the user explicitly asked it to inspect
- `scripting`: used to run the scan in that active tab

## Privacy Disclosure Guidance

Suggested answers for the Chrome Web Store privacy form:
- Does the extension collect data? `No`
- Is data sold to third parties? `No`
- Is data used for purposes unrelated to the extension's core functionality? `No`
- Is data used for creditworthiness or lending decisions? `No`

Host `PRIVACY.md` at a public URL and use that URL in the Chrome Web Store listing.

## Listing Assets

The repository includes generated assets in `store-assets/`:
- `store-assets/icon-128-store.png`
- `store-assets/screenshot-1.png`
- `store-assets/promo-tile-440x280.png`

## Submission Checklist

- Load the unpacked extension from the `video-link-grabber` folder
- Confirm the popup works on a normal website tab and shows a restricted-page message on blocked Chrome pages
- Zip the extension contents for upload
- Upload the 128x128 icon and at least one screenshot
- Fill out the single purpose field to match the actual behavior
- Link a public privacy policy URL
- Verify your support email in the Chrome Web Store dashboard
