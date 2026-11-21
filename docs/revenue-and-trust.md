# Revenue, verified businesses and complaints

How Ahia earns, how businesses get the Verified badge, and how complaints are handled. Everything
here is managed from the admin console.

## Verified businesses (Admin → Verifications)

Verification is a check of a business’s identity, contact details and location. It is separate
from seller approval, and **it can never be bought**: featuring a shop or sponsoring products has
no effect on it.

1. The seller uploads at least one document (business registration, owner’s ID or proof of
   address) in the app under **Sell**, then taps **Apply for the Verified badge** and gives the
   registered name, CAC number if any, the person responsible, a phone number and the address.
2. Operations staff review it: **Verify** (for 1–36 months), **Ask for more**, or **Reject**.
   Every decision needs a reason, which the seller sees, and is kept in the verification history
   and audit log.
3. A verified business can be **suspended** at any time. When the review date passes it becomes
   **expired** automatically and the badge disappears until the seller re-applies (allowed in the
   last 30 days).

Buyers see **✓ Verified** on products, shops and planner matches. The badge text explains that it
is not a guarantee that every product is genuine or defect-free.

## Commission

- **Default rate:** Settings (currently 5%), charged only when an order completes.
- **Category rates:** Catalogue → a category’s commission (for example 2% as an introductory
  rate). Empty uses the default.
- **Delivery:** the default delivery commission applies to independent riders; a delivery partner
  company’s agreed rate applies to its riders.
- Sellers see the order total, Ahia’s fee and what they receive on every order before accepting.

## Revenue streams (Admin → Revenue, Advertising, Delivery partners)

| Stream                 | How it works                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ |
| Transaction commission | Percentage of each completed order                                             |
| Delivery commission    | Share of each completed delivery fare                                          |
| Delivery partners      | Agreed share of deliveries made by a partner company’s riders                  |
| Sponsored products     | 7/14/30-day packages, paid from seller proceeds, labelled “Sponsored”          |
| Featured shops         | 7/14/30-day packages, shown on Home, labelled “Featured”                       |
| Local business adverts | Booked by the Ahia team; advertiser pays by transfer; labelled “Advertisement” |

- **Revenue switches:** owners can pause any stream at once; basic listing and browsing stay free.
- **Packages:** change prices or hide a package on the Revenue page.
- **Adverts:** create the campaign, **record the payment** (amount and transfer reference — it is
  posted as income), then **Go live**. Targeting by state, LGA and category; views and clicks are
  reported per campaign.
- **Revenue report:** income by stream for any date range, with a daily chart and CSV export.
  Income is counted when it is posted (for example when an order completes); refunds show as
  negative adjustments.

Sponsored products, featured shops and adverts use the `PROMOTIONS` feature, which pilot mode
switches off. It is switched on for the test server (`FEATURE_PROMOTIONS=true`).

## Complaints (Admin → Disputes)

Each support case now has:

- an **order snapshot** taken when it opened: seller (and its registered name and verification
  status), item, quantity, price, total and payment references;
- a **priority** (payment problems and damaged goods start as high) and an **owner** from the
  support, finance or owner staff;
- a **timeline**: buyer and seller messages, staff **internal notes** (never shown to the buyer or
  seller), **updates** sent to both parties, and case events (opened, resolved);
- queue views: **Open**, **Assigned to me**, **Unassigned**, **All**.

Buyers and sellers reply in the app on the case itself; staff appear to them as “Ahia support”.
Evidence, returns, refunds and appeals work as before.
