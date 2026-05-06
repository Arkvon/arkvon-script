# Arkvon Tracking Script v2.0

Lightweight JavaScript snippet merchants embed on their websites to capture affiliate attribution and lead events.

## Setup

```html
<script data-arkvon="YOUR_CAMPAIGN_SLUG" src="https://cdn.jsdelivr.net/gh/Arkvon/arkvon-script@latest/index.js" async></script>
```

Enable debug logging during development (add **before** the script tag):

```html
<script>window.ARKVON_DEBUG = true;</script>
```

## How It Works

1. Script loads, reads campaign slug from `data-arkvon` attribute.
2. Determines root cookie domain for cross-subdomain support.
3. Checks URL for `?ref=AFFILIATE_CODE&click_id=CLICK_SLUG&trk=TOKEN` (set by the click redirect).
4. Stores attribution (`arkvon_referral` + `arkvon_data` cookies, 30 days). `arkvon_data` includes `clickId`, `trk` (cross-domain token), `landingPage`, `referrerUrl`.
5. On subsequent page loads, loads attribution from cookies if URL params are absent.
6. Sets up auto form tracking for forms opted in via `data-arkvon-track-form`, `[data-arkvon-submit]`, or the legacy `#submit-btn` ID.
7. Drains any queued commands, replaces stub with live function.
8. Dispatches `arkvonReady` and `arkvonScriptLoaded` events.

## Referral Parameters Detected

`ref` (primary), `arkvon`, `aff`

The `click_id` and `trk` (signed cross-domain tracking token) parameters are also captured and stored alongside the referral code.

## Cookies

| Cookie | Purpose | Duration | Format |
|--------|---------|----------|--------|
| `arkvon_referral` | Affiliate referral code | 30 days | Plain string |
| `arkvon_data` | `{ clickId, trk, landingPage, referrerUrl, createdAt }` | 30 days | JSON |

Cookie options: `path=/`, `samesite=lax`, `secure` on HTTPS, `domain=.rootdomain.com` (cross-subdomain).

> **Multi-part TLD support.** The script ships with a hardcoded list of common multi-part public suffixes (`.co.uk`, `.com.au`, `.co.nz`, `.com.br`, etc.) and resolves the registrable domain correctly for those. On hosts the list doesn't recognize, it falls back to "last 2 labels", which is safe for the vast majority of TLDs (`.com`, `.io`, `.app`, …). Localhost, `*.local`, and IP literals get host-only cookies (no `Domain` attribute). If your TLD isn't covered and cross-subdomain tracking breaks, ask us to add it — we don't bundle the full Public Suffix List to keep the snippet small.

## API Endpoint

| Endpoint | Trigger | Transport |
|----------|---------|-----------|
| `POST /track/signup` | `arkvon('signup', { email })` or auto form submit | `fetch` with `mode: "no-cors"`, `URLSearchParams` body |

### Signup Payload

| Field | Source |
|-------|--------|
| `email` | From form or manual call |
| `firstName` | Optional, from form or manual call |
| `lastName` | Optional, from form or manual call |
| `referralCode` | `arkvon_referral` cookie |
| `campaignSlug` | `data-arkvon` attribute |
| `clickId` | `arkvon_data.clickId` cookie |
| `trk` | `arkvon_data.trk` cookie (signed cross-domain token) |

### Why `no-cors`?

The script runs on third-party merchant websites. JSON + custom headers trigger CORS preflight which the Arkvon API would need to whitelist per merchant domain. Using `URLSearchParams` with `mode: "no-cors"` avoids preflight entirely — the request fires reliably from any origin.

The tradeoff: the response is opaque (script can't read the server's reply). This is acceptable for fire-and-forget analytics.

## Tracking Events

```javascript
// Wait for script to be ready
document.addEventListener('arkvonScriptLoaded', function() {
  // Track signup (only active command currently)
  arkvon('signup', {
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe'
  });

  // Shorthand
  arkvon.signup('user@example.com', { firstName: 'John' });
});
```

### Compatibility commands (no-op, won't break existing integrations)

```javascript
arkvon('custom', { event_name: 'video_watched' });
arkvon('conversion', { value: 99.99 });
arkvon.track('button_click', { button_name: 'cta' });
arkvon.conversion(49.99, 'subscription');
```

These return `{ recorded: false, reason: "unsupported_command" }` and log a debug message. They exist so merchants with older integration code won't get runtime errors.

## Auto Form Tracking

A form is automatically tracked on submit if it matches **any** of the following opt-ins:

| Opt-in | Where to put it | Recommended for |
|--------|------------------|------------------|
| `data-arkvon-track-form` attribute | The `<form>` element | New integrations, React/Next.js, anywhere you control the form markup |
| `data-arkvon-submit` attribute | Any descendant element (typically the submit button) | Component libraries (shadcn/ui, MUI, etc.) where you don't want to touch the `<form>` element |
| `id="submit-btn"` | The submit button | Legacy / existing integrations — kept working forever |

```html
<!-- Option 1: data-arkvon-track-form on the form -->
<form data-arkvon-track-form>
  <input type="email" name="email" />
  <button type="submit">Sign Up</button>
</form>

<!-- Option 2: data-arkvon-submit on the button -->
<form>
  <input type="email" name="email" />
  <button type="submit" data-arkvon-submit>Sign Up</button>
</form>

<!-- Option 3: legacy #submit-btn ID -->
<form>
  <input type="email" name="email" />
  <button type="submit" id="submit-btn">Sign Up</button>
</form>
```

Email is found by checking `name` attributes: `email`, `user_email`, `customer_email`, `signup_email`, or fallback `input[type="email"]`.

### React / SPA forms — call `arkvon('signup', …)` explicitly

The auto-tracker listens for native browser `submit` events. Most React form libraries (React Hook Form, Formik, plain `onSubmit` handlers that call `e.preventDefault()`) **suppress that event** as soon as validation passes — the auto-tracker never sees it.

For SPAs and any form where you call `preventDefault()`, fire the signup event yourself after your own submit handler resolves successfully:

```jsx
const onSubmit = async (values) => {
  const res = await fetch("/api/signup", { method: "POST", body: JSON.stringify(values) });
  if (!res.ok) return;

  // Fire-and-forget — the script handles cookies, retries, no-cors transport.
  if (typeof window !== "undefined" && typeof window.arkvon === "function") {
    window.arkvon("signup", {
      email: values.email,
      firstName: values.firstName,
      lastName: values.lastName,
    });
  }
};
```

Calling `arkvon('signup', …)` is safe even before the script has finished loading — early calls are queued and drained on init.

## Utility Helpers

```javascript
arkvonUtils.isReferralUser()    // boolean
arkvonUtils.getReferralData()   // { referralCode, clickId, landingPage, ... } | null
arkvonUtils.clearTracking()     // deletes cookies + window globals
```

## Global Variables

| Variable | Type | Description |
|----------|------|-------------|
| `window.arkvon` | Function | Main command function |
| `window.arkvon.signup` | Function | Signup shorthand |
| `window.arkvon.track` | Function | Custom event (no-op) |
| `window.arkvon.conversion` | Function | Conversion (no-op) |
| `window.arkvon_referral` | String/null | Current referral code |
| `window.arkvon_data` | Object/null | Attribution data |
| `window.arkvonUtils` | Object | Utility helpers |

## Events Dispatched

| Event | When | Notes |
|-------|------|-------|
| `arkvonReady` | Init complete | `CustomEvent` with `{ detail: { campaignSlug } }` |
| `arkvonScriptLoaded` | Init complete | Legacy compat, plain `Event` |

## Command Queue

Commands called before the script finishes loading are queued and drained automatically:

```javascript
// Before script loads — queued
arkvon('signup', { email: 'early@example.com' });

// After script loads — processed immediately
```

## Cross-Domain Tracking

When a visitor clicks an affiliate link, the backend generates a signed `trk` token (HMAC-SHA256, 30-day expiry) and appends it to the redirect URL. The script reads and stores this token in cookies.

**Why it matters:** Cookies are domain-scoped. If the visitor lands on `merchant.com` but pays on `checkout.partner.com`, the `arkvon_referral` cookie is inaccessible. The `trk` token is a self-contained, tamper-proof proof of attribution that works across any domain.

**For payment attribution**, merchants should pass `window.arkvon_data.trk` into Stripe metadata as `arkvon_trk`:

```javascript
const stripe = await loadStripe('...');
const { error } = await stripe.redirectToCheckout({
  // ...
  metadata: {
    affiliateCode: window.arkvon_referral,
    arkvon_trk: window.arkvon_data?.trk,
  },
});
```

The backend webhook resolver will verify the `trk` token and attribute the sale to the correct affiliate, even without cookies.

## Security

- No sensitive data tracked (no payment info, no passwords)
- Cookies: `SameSite=Lax`, `Secure` on HTTPS, domain-scoped
- No `eval()` or dynamic code execution
- Debug logging gated behind `window.ARKVON_DEBUG`
- `no-cors` transport avoids exposing server responses to client
- `trk` token: HMAC-SHA256-signed server-side, timing-safe verification, 30-day expiry
