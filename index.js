/**
 * Arkvon Tracking Script v2.0
 *
 * Install on any merchant website:
 *   <script data-arkvon="your-campaign-slug" src="https://cdn.arkvon.com/track.js" async></script>
 *
 * Optional: enable verbose debug logging during development:
 *   <script>window.ARKVON_DEBUG = true;</script>  (add BEFORE the script tag)
 */
(() => {
  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  const API_BASE = "https://api.arkvon.com"; // no trailing slash
  const COOKIE_DURATION_DAYS = 30;

  // ---------------------------------------------------------------------------
  // Cookie-domain hardcoded multi-part public suffix list
  // ---------------------------------------------------------------------------
  // Browsers reject `Domain=co.uk` and similar because public suffixes can't
  // own cookies — but our previous "always slice last 2 parts" logic produced
  // exactly that. Result: silent attribution failure for every merchant on
  // .co.uk, .com.au, .co.nz, etc. (cookies were never set, but the script
  // logged success). We don't want to bundle the full Public Suffix List
  // (40k+ entries, ~4MB JSON) for an MVP script — instead we cover the
  // commercial registrable suffixes our target market actually uses. Hosts
  // not in this list fall back to the standard "last 2 parts" assumption,
  // which is correct for ~95% of real merchants (.com, .net, .org, .io, .app,
  // .dev, .co, .ai, plus all the new gTLDs).
  //
  // If a merchant on an unlisted multi-part TLD reports broken
  // cross-subdomain attribution, add their suffix here. Updating the list
  // is cheaper than maintaining a PSL build pipeline.
  const KNOWN_MULTI_PART_TLDS = [
    ".co.uk", ".org.uk", ".ac.uk", ".gov.uk", ".me.uk", ".net.uk", ".ltd.uk", ".plc.uk",
    ".com.au", ".net.au", ".org.au", ".edu.au", ".gov.au", ".id.au",
    ".co.nz", ".net.nz", ".org.nz",
    ".com.br", ".net.br", ".org.br",
    ".co.jp", ".or.jp", ".ne.jp",
    ".com.cn", ".com.hk", ".com.tw", ".com.sg", ".com.tr",
    ".com.mx", ".com.ar",
    ".co.in", ".co.za", ".co.kr", ".co.il", ".co.id", ".co.th",
  ];

  let campaignSlug = null; // value of data-arkvon attribute
  let cookieDomain = null;
  let queuedCommands = [];

  // Support calls made before the script fully initializes.
  if (!window.arkvon) {
    const stub = (command, data) => {
      queuedCommands.push({ command, data });
    };
    stub.queue = queuedCommands;
    window.arkvon = stub;
  } else if (Array.isArray(window.arkvon.queue)) {
    queuedCommands = window.arkvon.queue;
  } else {
    window.arkvon.queue = queuedCommands;
  }

  function log(...args) {
    if (window.ARKVON_DEBUG) console.log("[Arkvon]", ...args);
  }
  function warn(...args) {
    console.warn("[Arkvon]", ...args);
  }

  // ---------------------------------------------------------------------------
  // Cookie domain resolver — public-suffix aware fallback
  // ---------------------------------------------------------------------------
  // Returns either:
  //   - a leading-dot domain string (".merchant.com" or ".merchant.co.uk")
  //     for cross-subdomain cookie scoping, OR
  //   - null, meaning "set the cookie with NO Domain attribute" so it's
  //     scoped to the exact host. We pick null for: localhost, *.local,
  //     IP literals, single-label hosts, hosts that look like bare public
  //     suffixes, and anything we can't confidently slice. Better to lose
  //     cross-subdomain support than silently fail to set the cookie at all.
  function computeCookieDomain(rawHost) {
    if (!rawHost) return null;
    const host = rawHost.toLowerCase();

    if (host === "localhost" || host.endsWith(".local")) return null;

    // IPv4 literal (e.g. 127.0.0.1) — cookies can't take a Domain attr on
    // raw IPs; let the browser scope to the exact host.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    // IPv6 literal — `[::1]` style or bare colons, never set Domain.
    if (host.includes(":") || host.startsWith("[")) return null;

    const parts = host.split(".");
    if (parts.length < 2) return null; // single-label, treat as host-only

    // Multi-part public suffix (e.g. .co.uk) — registrable domain is last 3.
    for (let i = 0; i < KNOWN_MULTI_PART_TLDS.length; i++) {
      if (host.endsWith(KNOWN_MULTI_PART_TLDS[i])) {
        if (parts.length < 3) return null; // bare ".co.uk" host — give up
        return "." + parts.slice(-3).join(".");
      }
    }

    // Single-part TLD (.com, .io, .app, etc.) — registrable domain is last 2.
    return "." + parts.slice(-2).join(".");
  }

  // ---------------------------------------------------------------------------
  // AbortSignal.timeout polyfill
  // ---------------------------------------------------------------------------
  // `AbortSignal.timeout()` is a 2022 addition (Chrome 103+, Safari 16+,
  // Firefox 100+). Older Safari iOS (15 and earlier) and the long tail of
  // older browsers throw `TypeError: AbortSignal.timeout is not a function`
  // synchronously when fetch reads `options.signal`. The fetch-level
  // try/catch DOES catch it, but every retry fails identically because the
  // function never appears, so signups are silently dropped on those
  // browsers. The fallback below uses the universally-supported
  // AbortController + setTimeout pair to produce an equivalent signal.
  function timeoutSignal(ms) {
    if (
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
    ) {
      return AbortSignal.timeout(ms);
    }
    if (typeof AbortController === "undefined") return undefined;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  }

  // ---------------------------------------------------------------------------
  // Cookie helpers
  // ---------------------------------------------------------------------------

  function setCookie(name, value, days) {
    try {
      const expires = new Date(Date.now() + days * 864e5).toUTCString();
      const serialised =
        typeof value === "string" ? value : JSON.stringify(value);
      let str = `${name}=${encodeURIComponent(serialised)};expires=${expires};path=/;samesite=lax`;
      if (cookieDomain) str += `;domain=${cookieDomain}`;
      if (window.location.protocol === "https:") str += ";secure";
      document.cookie = str;
    } catch (e) {
      warn("setCookie failed:", e);
    }
  }

  function getCookie(name) {
    try {
      const match = ("; " + document.cookie).split(`; ${name}=`);
      if (match.length < 2) return null;
      const raw = decodeURIComponent(match.pop().split(";")[0]);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch (e) {
      return null;
    }
  }

  function deleteCookie(name) {
    const domainStr = cookieDomain ? `;domain=${cookieDomain}` : "";
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/${domainStr}`;
  }

  // ---------------------------------------------------------------------------
  // Attribution data stored in cookies
  // ---------------------------------------------------------------------------

  /**
   * Returns whatever referral state is currently stored.
   * Shape: { referralCode, clickId, landingPage, referrerUrl, createdAt }
   */
  function getStoredAttribution() {
    const code = getCookie("arkvon_referral");
    const data = getCookie("arkvon_data");
    if (!code) return null;
    return { referralCode: code, ...(data && typeof data === "object" ? data : {}) };
  }

  function storeAttribution(referralCode, clickId, trk) {
    setCookie("arkvon_referral", referralCode, COOKIE_DURATION_DAYS);
    const dataObj = {
      clickId: clickId || null,
      trk: trk || null,
      landingPage: window.location.href,
      referrerUrl: document.referrer || null,
      createdAt: Date.now(),
    };
    setCookie("arkvon_data", dataObj, COOKIE_DURATION_DAYS);
    window.arkvon_referral = referralCode;
    window.arkvon_data = { referralCode, ...dataObj };
  }

  // ---------------------------------------------------------------------------
  // URL param extraction
  // ---------------------------------------------------------------------------

  function extractAttributionFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const referralCode = params.get("ref") || params.get("arkvon") || params.get("aff");
      const clickId = params.get("click_id") || null;
      const trk = params.get("trk") || null;
      return referralCode ? { referralCode: referralCode.trim(), clickId, trk } : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // API communication
  // ---------------------------------------------------------------------------

  async function apiPost(path, payload, retries = 2) {
    const url = `${API_BASE}/${path}`;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const body = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
          if (value === null || value === undefined) return;
          body.append(key, String(value));
        });

        const res = await fetch(url, {
          method: "POST",
          mode: "no-cors",
          keepalive: true,
          body,
          signal: timeoutSignal(8000),
        });
        // no-cors returns opaque responses by design.
        return { queued: true };
      } catch (e) {
        log(`POST ${path} attempt ${attempt} failed:`, e.message);
        if (attempt <= retries) {
          await new Promise((r) =>
            setTimeout(r, Math.pow(2, attempt) * 500 + Math.random() * 300)
          );
        }
      }
    }
    warn(`All attempts failed for POST ${path}`);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Signup / lead tracking
  // ---------------------------------------------------------------------------

  async function trackSignup(email, opts = {}) {
    if (!email || typeof email !== "string") {
      warn("trackSignup: email is required");
      return null;
    }

    const attribution = getStoredAttribution();
    if (!attribution) {
      log("trackSignup: no referral attribution found, skipping");
      return null;
    }

    const payload = {
      email: email.trim().toLowerCase(),
      firstName: opts.firstName || opts.first_name || null,
      lastName: opts.lastName || opts.last_name || null,
      referralCode: attribution.referralCode,
      campaignSlug,
      clickId: attribution.clickId || null,
      trk: attribution.trk || null,
    };

    log("Sending signup event:", payload);
    return apiPost("track/signup", payload);
  }

  // ---------------------------------------------------------------------------
  // Automatic form tracking
  // ---------------------------------------------------------------------------

  function findEmailInForm(form) {
    const emailFields = ["email", "user_email", "customer_email", "signup_email"];
    const elements = form.elements;
    for (const field of emailFields) {
      if (elements[field] && elements[field].value) {
        return elements[field].value.trim();
      }
    }
    // fallback: first input[type=email]
    const emailInput = form.querySelector('input[type="email"]');
    return emailInput ? emailInput.value.trim() : null;
  }

  // Decide whether a submitted form should be auto-tracked. Three opt-ins:
  //   1. `<form data-arkvon-track-form>` — explicit, framework-friendly,
  //      survives Tailwind / shadcn refactors. Recommended for new merchants.
  //   2. `<button data-arkvon-submit>` (or any descendant) — same intent,
  //      attached to the CTA element instead of the form itself.
  //   3. `<button id="submit-btn">` — legacy selector, kept for backward
  //      compatibility with existing integrations. ID-based selectors are
  //      brittle (collisions across the page, fights with framework-generated
  //      IDs), so new merchants should prefer the data-attributes above.
  //
  // We deliberately keep #submit-btn working forever — yanking it would
  // silently break installs that have been collecting data for months.
  function shouldTrackForm(form) {
    if (form.hasAttribute("data-arkvon-track-form")) return true;
    if (form.querySelector("[data-arkvon-submit]")) return true;
    if (form.querySelector("#submit-btn")) return true;
    return false;
  }

  function onFormSubmit(e) {
    const form = e.target;
    if (!form || form.tagName !== "FORM") return;
    if (!shouldTrackForm(form)) return;

    const email = findEmailInForm(form);
    if (!email) {
      log("Tracked form submitted but no email field found");
      return;
    }

    const firstNameEl = form.elements["first_name"] || form.elements["firstName"];
    const lastNameEl = form.elements["last_name"] || form.elements["lastName"];

    trackSignup(email, {
      firstName: firstNameEl ? firstNameEl.value : null,
      lastName: lastNameEl ? lastNameEl.value : null,
    });
  }

  function setupFormTracking() {
    document.addEventListener("submit", onFormSubmit, true);
    log(
      "Form tracking ready (opt-ins: data-arkvon-track-form, [data-arkvon-submit], #submit-btn)"
    );
  }

  // ---------------------------------------------------------------------------
  // Command processor  (window.arkvon("signup", { email }) API)
  // ---------------------------------------------------------------------------

  async function processCommand(command, data = {}) {
    switch (command) {
      case "signup":
        return trackSignup(data.email, data);
      case "custom":
      case "conversion":
      case "track":
        // Keep old API surface for backward compatibility while those
        // endpoints are not enabled server-side.
        log(`Ignoring unsupported command "${command}" for compatibility.`);
        return { recorded: false, reason: "unsupported_command" };
      default:
        warn(`Unknown command: ${command}`);
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  (async () => {
    try {
      // 1. Read campaign slug from script tag
      const scriptEl = document.querySelector("script[data-arkvon]");
      campaignSlug = scriptEl ? scriptEl.getAttribute("data-arkvon").trim() : null;

      if (!campaignSlug) {
        warn("data-arkvon attribute missing on script tag — aborting.");
        return;
      }

      log(`Initialising for campaign: ${campaignSlug}`);

      // 2. Determine root domain for cross-subdomain cookies (public-suffix
      //    aware — see computeCookieDomain comment for rationale).
      try {
        cookieDomain = computeCookieDomain(window.location.hostname);
      } catch {
        cookieDomain = null;
      }

      // 3. Check URL for fresh attribution params (highest priority)
      const fromUrl = extractAttributionFromUrl();
      if (fromUrl) {
        storeAttribution(fromUrl.referralCode, fromUrl.clickId, fromUrl.trk);
        log("Attribution stored from URL:", fromUrl);
      } else {
        // 4. Fall back to cookie
        const stored = getStoredAttribution();
        if (stored) {
          window.arkvon_referral = stored.referralCode;
          window.arkvon_data = stored;
          log("Attribution loaded from cookie:", stored.referralCode);
        }
      }

      // 5. Drain any commands queued before script loaded
      if (window.arkvon && Array.isArray(window.arkvon.queue)) {
        for (const item of window.arkvon.queue) {
          if (item && item.command) {
            await processCommand(item.command, item.data || {});
          }
        }
      }

      // 6. Replace stub with live function
      window.arkvon = async (command, data = {}) => processCommand(command, data);
      window.arkvon.signup = (email, opts = {}) => trackSignup(email, opts);
      window.arkvon.track = (eventName, eventData = {}) =>
        processCommand("track", { event_name: eventName, event_data: eventData });
      window.arkvon.conversion = (value, type = "purchase") =>
        processCommand("conversion", { value, type });

      // 7. Expose utility helpers
      window.arkvonUtils = {
        getReferralData: () => getStoredAttribution(),
        isReferralUser: () => !!getStoredAttribution(),
        clearTracking: () => {
          deleteCookie("arkvon_referral");
          deleteCookie("arkvon_data");
          window.arkvon_referral = null;
          window.arkvon_data = null;
          log("Tracking cleared");
        },
      };

      // 8. Auto form tracking
      setupFormTracking();

      document.dispatchEvent(new CustomEvent("arkvonReady", { detail: { campaignSlug } }));
      document.dispatchEvent(new Event("arkvonScriptLoaded"));
      log("Ready.");
    } catch (e) {
      warn("Initialisation error:", e);
    }
  })();
})();
