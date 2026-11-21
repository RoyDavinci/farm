# Local Status videos campaigns and booking attribution

The app supports photo and short-video statuses, reviewed Boost Status campaigns, and a booking conversion funnel. These extend the existing listing, booking, ledger and Local Status modules. No live payment or deployment is required to use the development simulation.

## Short videos

Approved sellers choose a video in the Local Status publisher, wait for processing, preview it, and publish it against an active available listing. Uploads accept MP4/MOV/WebM containers, at most 20 MB and 30 seconds, one video track and dimensions up to 4096 pixels per side. The server probes the actual file rather than trusting its extension or client duration. Invalid, overlong or undecodable files are rejected.

FFmpeg produces an H.264/AAC MP4, up to 720 by 1280 pixels with the source aspect ratio preserved, 24 fps, bounded bitrate and a 12 MB output cap. Metadata and chapters are removed. A compressed WebP poster is generated. Processing has a 90-second timeout and a two-upload/process limit per API instance; temporary files and failed storage writes are cleaned up.

Videos and posters use the existing public media storage provider. Local MP4 delivery supports HTTP byte ranges through `sendFile`, including storage rooted under `.data`; failed file responses are not cached. S3 uses signed object URLs, where S3 handles ranges. Receipt and identity files remain in private records storage. The feed loads posters; the story viewer uses `expo-video` with user-initiated playback. The player is released when the status is closed. Admin moderation also supports video playback.

The API host needs `ffmpeg` and `ffprobe` on PATH. Optional `FFMPEG_PATH` and `FFPROBE_PATH` select explicit executable paths. The Dockerfile includes FFmpeg in the image; the image has not been deployed. A host without these executables returns `VIDEO_PROCESSOR_UNAVAILABLE`. Native development clients need to be rebuilt after adding `expo-video`; physical-device playback and production S3/video delivery still need acceptance checks.

## Boost Status campaigns

Sellers select one to five distinct state/LGA or state/city targets and a duration. The quote shows the full campaign budget before confirmation. Price is the admin-configured hourly rate multiplied by duration and number of targets; the initial development setting is ₦25 per hour per area. The current campaign budget cap is ₦1,000,000. Duration must fit before the status expires. Changing targets or duration clears the quote; the server rechecks the expected price at submission.

Submitting holds the budget from available seller earnings in a campaign-specific `boost_escrow` ledger account. A pending campaign has no paid reach. Operations, finance or owners review the content, targets and price under **Status boosts** in admin. Approval starts the clock and transfers the hold to platform revenue. If too little status lifetime remains to run the requested duration, approval is refused and staff must reject/refund or the seller can cancel. The campaign is never silently shortened at the full price.

Pending rejection or cancellation returns the full hold. Stopping an active campaign returns the unused time portion, rounded down to whole kobo. Seller deletion or staff removal of a status stops its campaign in the same transaction. A worker checks every minute for expiry, unavailable products or suspended sellers/accounts and settles affected campaigns. Listing/status visibility checks take effect immediately in discovery, even before recovery runs. Ledger mutations and campaign creation use the existing idempotency mechanism; state locks prevent duplicate refunds or approval.

Paid targeting applies to buyers browsing the matching selected LGA or city in its state. GPS-only discovery continues to use the organic nearby radius; the server does not infer administrative boundaries from GPS. A matching active Boost is labelled Sponsored and its campaign ID is captured for analytics. Content still respects user blocks, seller/category mutes, category filters, expiry and product availability. A paid campaign does not guarantee impressions or sales and does not broadcast notifications. Existing sponsored-listing promotions remain separate from status campaign budgets.

Seller and admin dashboards show each campaign's views, product clicks, attributed bookings and completed bookings. Campaign metrics remain available after stopping or expiry.

## Booking conversion tracking

Opening a product from an eligible status issues an unpredictable click reference, bound server-side to the buyer, status, product, current sponsored state and matching Boost campaign. The reference expires after 24 hours. The mobile app carries it into the booking request. When no explicit reference is supplied, the server may use that buyer's latest valid unconverted click for the same listing within the window, allowing a later visit to convert.

A click can attribute at most one booking. References belonging to another buyer/listing, expired references and already-used references cannot create another conversion. An invalid or stale reference does not prevent a legitimate booking; it leaves the booking unattributed. Existing idempotent booking retries return the original booking rather than creating another conversion. Own-status clicks do not issue references. Unconverted expired references are removed after a seven-day grace period; converted references are retained for analytics/history.

The seller sees aggregate funnels split between organic and sponsored traffic: attributed bookings, ever accepted, currently paid, completed, cancelled/declined/expired, and completed gross order value. Current booking state and recorded events drive the counts, so a cancelled request is not counted as a completed order. Completed gross is before fees/refunds and is not net seller revenue. Attribution identifies a preceding click, not proof that the campaign caused the purchase. No buyer or viewer identities are exposed in these dashboards. Direct enquiry attribution is not added by this feature.

## Local verification

The local migration and campaign analytics indexes are applied. A fictional-account walkthrough processed a real four-second clip, generated its poster, rejected invalid video bytes, confirmed organic/paid audience boundaries, verified pending campaign invisibility, full pending refund, paid LGA and city reach, an attributed booking through accept/pay/pickup completion, single-use click attribution, prorated active cancellation, and removal of paid reach after stopping. The mobile web preview also completed real file selection, server processing, tap-to-play playback, linked-product publication and feed playback at a 390 × 844 viewport. HTTP seeking returned 206 with the requested byte range. The Boost quote UI displayed the configured budget before any hold. Money used the existing development ledger only; no provider calls or real transfers occurred.

Automated tests remain deferred at the user's request. Typechecks, builds, contract consistency and mobile UI checks are completed separately; they do not establish production/device/provider acceptance.
