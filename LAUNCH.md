# Aries launch checklist

Things only you can do before selling Aries. None of this is legal advice; get a lawyer for the contracts.

## 1. Name and company
- [ ] Trademark search for "Aries" in your markets (USPTO TESS, EUIPO) and check app stores and domains. Pick another name if it's taken in software.
- [ ] Register the domain and form a company so liability isn't personal.

## 2. Legal documents (agents take real actions for customers)
- [ ] Terms of Service: customers authorize agents to act within the rules they set; customers are responsible for those rules; AI output can be wrong; limitation of liability.
- [ ] Privacy Policy: you process customers' customer data (names, emails, addresses) and send it to Anthropic and connected apps.
- [ ] Data Processing Agreement for business customers (GDPR/UK GDPR); list Anthropic and your host as subprocessors.
- [ ] Read Anthropic's Commercial Terms and Usage Policy. You're building a product on the API for your customers, so you're responsible for how it's used.

## 3. Accounts and keys
- [ ] Anthropic: production API key; raise rate limits before launch; set a spend alert.
- [ ] Stripe (selling Aries): create Starter/Growth/Scale prices, add the webhook `$PUBLIC_URL/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.*`, enable the customer portal.
- [ ] Shopify Partner account: create a public app, set the redirect URL `$PUBLIC_URL/api/oauth/shopify/callback`, and request **protected customer data** access (names, emails, addresses are needed for shipping). Shopify reviews public apps before listing; plan for a few weeks.
- [ ] Optional: Shippo and Resend partner programs, if you want to provide shipping and email to customers yourself instead of them bringing their own accounts.

## 4. Hosting
- [ ] Deploy with the Dockerfile to Fly.io, Render, Railway or similar, with managed Postgres and daily backups.
- [ ] Set every variable in `.env.example`. **Never change `SECRET_KEY` after launch**: it decrypts customers' stored credentials.
- [ ] HTTPS only. Put error monitoring (e.g. Sentry) and uptime checks on `/api/health`.
- [ ] Before many customers: move agent runs to a separate worker process, and split big businesses' data out of the single JSON document into tables.

## 5. Google Play
- [ ] Pick the final Android application ID (currently `app.aries` in `android/app/build.gradle.kts`). It can never change after the first Play upload.
- [ ] Build with `-PariesUrl=https://your-domain`, sign with your own upload key (not the debug key), upload an AAB.
- [ ] Data safety form: personal info (name, email), app activity, and customers' customer data, encrypted in transit and at rest.
- [ ] Account deletion: in the app (More → Delete account) and add a web URL for it in Play Console.
- [ ] Payments: plans are bought on the web, and the Android app hides checkout. Don't add purchase links in the app unless you use Google Play Billing.

## 6. Pricing sanity
- [ ] Check `server/src/plans.ts`: each plan's `aiCreditUsd` is your Anthropic cost cap per business per month. Watch real usage in the first weeks and adjust prices, credits and default models (Haiku is cheapest).
- [ ] Verify the model prices in `server/src/engine/claude.ts` against Anthropic's pricing page; override with the `PRICES` env var if needed.

## 7. Before the first paying customer
- [ ] Run the full flow against a Shopify development store and a Shippo test key: order → rates → label → fulfill → email.
- [ ] Keep default rules conservative (everything "Ask me" except payment links). Let owners loosen them.
- [ ] Write a short onboarding email and a help page for each connector.
