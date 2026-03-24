# Privacy Policy for Video Link Grabber

Last updated: March 24, 2026

Video Link Grabber is designed to inspect the page the user is currently viewing and identify likely video links that are already present in that page.

## What the extension accesses

The extension accesses the contents of the active tab only when the user opens the extension popup or clicks the rescan button.

The extension may read:
- Video URLs that are already present in the page source or page metadata
- Poster image URLs associated with those video links
- The page title, for display inside the extension popup

## What the extension does not do

The extension does not:
- Collect personal information
- Track browsing history across tabs or sessions
- Send page contents, video links, or personal data to any remote server
- Sell, transfer, or share user data with third parties
- Use analytics, ads, remote code, or external tracking scripts
- Bypass DRM, paywalls, authentication, or access controls

## Data storage

Video Link Grabber does not store scan results remotely and does not use cloud services.

At the time of writing, the extension does not persist scan results locally either. Results are shown only inside the popup for the current session.

## Permissions

The extension requests only the following Chrome permissions:
- `activeTab`: to inspect the tab the user is actively viewing after the user invokes the extension
- `scripting`: to run the scan on that active tab

## Contact

Project page: https://github.com/mysticalg/video-link-grabber

Support: https://github.com/mysticalg/video-link-grabber/issues
