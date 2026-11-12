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
  // Cookie domain
  // ---------------------------------------------------------------------------
  // Cookies go on the widest domain the browser accepts, so a referral stored
  // on www.merchant.com is also read on app.merchant.com. Browsers refuse a
  // cookie for a public suffix: .com, .co.uk, .com.ng, or a shared host such
  // as .vercel.app, .myshopify.com or .github.io, where every site belongs to
  // someone else. So each candidate is tried from the widest
  // ("merchant.com") down to the full host, and the first whose test cookie
  // reads back is used. Guessing from a list of suffixes instead set cookies
  // the browser silently dropped on every suffix the list missed.
  //
  // Returns a leading-dot domain, or null for host-only cookies (no Domain):
  // localhost, IP addresses, single-label hosts, and a browser that refuses
  // every candidate.
  function detectCookieDomain(rawHost) {
    if (!rawHost) return null;
    const host = rawHost.toLowerCase();

    if (host === "localhost" || host.endsWith(".local")) return null;
    // IP addresses (127.0.0.1, [::1]) can't share cookies with other hosts.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    if (host.includes(":") || host.startsWith("[")) return null;

    const parts = host.split(".");
    if (parts.length < 2) return null;

    const probeName = "arkvon_cookie_probe";
    const probeValue = Math.random().toString(36).slice(2) || "1";
    for (let i = 2; i <= parts.length; i++) {
      const candidate = "." + parts.slice(-i).join(".");
      writeCookie(probeName, probeValue, Date.now() + 60e3, candidate);
      const accepted = hasCookie(probeName, probeValue);
      writeCookie(probeName, "", 0, candidate);
      if (accepted) return candidate;
    }
    return null;
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

  // `value` is already encoded. `domain` null means host-only.
  function writeCookie(name, value, expiresAt, domain) {
    let str = `${name}=${value};expires=${new Date(expiresAt).toUTCString()};path=/;samesite=lax`;
    if (domain) str += `;domain=${domain}`;
    if (window.location.protocol === "https:") str += ";secure";
    document.cookie = str;
  }

  function hasCookie(name, value) {
    return ("; " + document.cookie + ";").indexOf(`; ${name}=${value};`) !== -1;
  }

  function setCookie(name, value, days) {
    try {
      const serialised =
        typeof value === "string" ? value : JSON.stringify(value);
      writeCookie(
        name,
        encodeURIComponent(serialised),
        Date.now() + days * 864e5,
        cookieDomain
      );
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

  // Removes the cookie both on the shared domain and host-only, so nothing of
  // it is left to read back.
  function deleteCookie(name) {
    try {
      if (cookieDomain) writeCookie(name, "", 0, cookieDomain);
      writeCookie(name, "", 0, null);
    } catch (e) {
      warn("deleteCookie failed:", e);
    }
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

  // Asks the backend whether `trk` is a token Arkvon signed. Only the backend
  // holds the key, and a `trk` in the URL can be made up by anyone. Returns
  // { referralCode, campaignSlug, clickId } when it's real, else null
  // (including when the check itself fails).
  async function verifyTrk(trk) {
    try {
      const res = await fetch(
        `${API_BASE}/track/verify-trk?trk=${encodeURIComponent(trk)}`,
        { method: "GET", credentials: "omit", signal: timeoutSignal(4000) }
      );
      if (!res.ok) return null;
      const body = await res.json();
      const result = body && body.data ? body.data : body;
      return result && result.valid === true ? result : null;
    } catch (e) {
      log("trk verification failed:", e && e.message);
      return null;
    }
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

      // 2. Find the widest domain the browser lets us share cookies on
      //    (see detectCookieDomain).
      try {
        cookieDomain = detectCookieDomain(window.location.hostname);
      } catch {
        cookieDomain = null;
      }
      log("Cookie domain:", cookieDomain || "(this host only)");

      // 3. Check URL for fresh attribution params.
      //    With nothing stored yet, the URL's referral is used as is.
      //    Replacing a stored referral takes an affiliate link click: a
      //    `trk` the backend confirms Arkvon signed, for this affiliate and
      //    this campaign. A bare ?ref= is often a marketing tag
      //    (?ref=producthunt), and anyone can type `&trk=anything`, so
      //    neither can take a sale away from the affiliate stored first.
      const fromUrl = extractAttributionFromUrl();
      const stored = getStoredAttribution();
      let fromUrlStored = false;

      if (fromUrl && !stored) {
        storeAttribution(fromUrl.referralCode, fromUrl.clickId, fromUrl.trk);
        fromUrlStored = true;
      } else if (fromUrl && fromUrl.trk && fromUrl.trk !== stored.trk) {
        const verified = await verifyTrk(fromUrl.trk);
        if (
          verified &&
          verified.referralCode === fromUrl.referralCode &&
          verified.campaignSlug === campaignSlug
        ) {
          storeAttribution(
            fromUrl.referralCode,
            verified.clickId || fromUrl.clickId,
            fromUrl.trk
          );
          fromUrlStored = true;
        } else {
          log("Link's trk not confirmed; keeping stored referral:", stored.referralCode);
        }
      }

      if (fromUrlStored) {
        log("Attribution stored from URL:", fromUrl);
      } else if (stored) {
        // 4. Fall back to cookie
        window.arkvon_referral = stored.referralCode;
        window.arkvon_data = stored;
        log("Attribution loaded from cookie:", stored.referralCode);
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
