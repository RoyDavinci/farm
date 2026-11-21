# Pilot mode

The brief says the first release is the core marketplace and booking loop only, and that a
wallet, escrow and Pay on Delivery need legal and provider approval first. `PILOT_MODE=true`
launches exactly that scope. Staging runs with it (`render.yaml`).

## What is on

- Seller registration, approval, listings, search, chat, bookings, counteroffers, stock
  reservation, pickup codes, reviews, favourites, disputes and returns.
- Online payment through Paystack or Flutterwave, seller payouts and the double-entry ledger.
- Delivery: driver onboarding, fares, rider choice, PIN/QR handover, live tracking, return
  journeys, ratings and incidents.

## What is off

| Switch         | Feature                                                         |
| -------------- | --------------------------------------------------------------- |
| `WALLET`       | Stored balance and open top-ups (Pay on Delivery also needs it) |
| `LOCAL_STATUS` | Local Status photo/video posts and Boost campaigns              |
| `PROMOTIONS`   | Paid sponsored listings                                         |
| `SHOPPING`     | Rider shopping errands                                          |
| `PARCELS`      | Independent parcel delivery                                     |
| `VOICE`        | In-app voice calls                                              |
| `PREORDERS`    | Pre-orders before a harvest date                                |
| `MARKET_MAPS`  | Indoor market walkways and stall navigation                     |

Switch one back on with `FEATURE_<NAME>=true` (for example `FEATURE_VOICE=true`), on both the API
and the worker. Switched-off API routes answer `404 FEATURE_DISABLED`, and the app and admin
console hide them.

## How buyers pay without a wallet

1. **Booking:** after the seller accepts, the buyer taps **Pay ₦… with Paystack/Flutterwave** and
   pays the exact booking total in the provider's checkout. When the provider confirms the payment
   (webhook, return page or **I've paid — confirm**), the server pays the booking at once.
2. **Delivery:** the buyer pays the exact quoted fare the same way; the app then requests the
   delivery. The server re-quotes the fare before taking payment.
3. The Wallet tab becomes **Payments**: each payment, each card refund, and (for sellers) payouts.

## Refunds go back to the card

Cancellations, expiries, dispute refunds and cancelled deliveries still credit the buyer inside the
ledger. With the wallet off, the `card-refunds` job (every minute, in the worker) sends that money
back to the original payment, against the buyer's own payments, newest first. A payment gets a
30-minute grace period first, so a paid delivery fare can still be used.

- A refund is marked **SENDING** before the provider is called and is never requested twice.
- Accepted by the provider: **REFUNDED**.
- Rejected: **FAILED**, money held. Unknown outcome (provider unreachable): stays **SENDING**
  with an error.
- Finance staff handle the last two on the admin **Refunds** page: **Mark refunded** after
  refunding by hand in the provider dashboard, or **Send again** after confirming the dashboard
  shows no refund. Both need a reason and are audit-logged.

## Limits

- One online payment is ₦100 to ₦100,000, the same cap as before. That's a small-transaction pilot
  cap as the spec suggests. Raise it in `checkout.service.ts` and `funding.validators.ts` once
  approved.
- Payment acceptance: `npm run acceptance:payments` detects pilot mode and pays a booking with
  each provider instead of topping up a wallet. Test a refund by cancelling a paid booking; it is
  sent 30 minutes after the payment.
