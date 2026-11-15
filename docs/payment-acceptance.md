# Payment acceptance (provider test mode)

Run this against staging once it has Paystack and/or Flutterwave **test** keys and webhooks set up (see [deploy-staging.md](deploy-staging.md)):

```bash
npm run acceptance:payments -- --api https://<api-host>
```

You need three test accounts:

- **a buyer**
- **an approved seller** with at least one listing in stock
- **a staff member** with the finance or owner role

The script signs each of them in; you type the code each one is emailed. Then it checks:

1. **Top-ups,** for every configured provider:
   - a hosted checkout opens; you pay it with the provider's test card
   - the payment is credited by the webhook, or by manual verify if the webhook didn't arrive
   - exactly the amount paid is credited
   - verifying a second time credits nothing
2. **Seller proceeds:** the buyer books the seller's listing and pays from the wallet, and the seller marks it ready and confirms pickup with the buyer's code.
3. **Payout:**
   - the seller's test bank account is confirmed by name with the provider
   - a payout request holds the funds
   - staff approval sends a test transfer
   - the payout settles as paid, by transfer webhook or by recheck

Results are written to `docs/acceptance/payments-<date>.md`; commit that file as the record.

Test cards and test bank accounts:

- Paystack: https://paystack.com/docs/payments/test-payments
- Flutterwave: https://developer.flutterwave.com/docs/test-cards

**Before going live:**

- Repeat this with each provider's live keys and a small real amount.
- Have the business review the reconciliation page.
- Get the legal sign-off noted in `docs/build-progress.md`.
