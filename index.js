(() => {
  // Configuration
  let apiBaseUrl = "https://api.arkvon.com/v1/tracking"; // will be updated when the backend is hosted
  let publicId = null;
  let domain = null;

  // Queue system for commands before script is fully loaded
  function queueCommand(command, data) {
    commandQueue.push({ command: command, data: data });
  }

  var commandQueue;

  // Initialize global Arkvon variables
  window.arkvon_referral = null;
  window.arkvon_data = null;
  window.arkvon =
    window.arkvon ||
    ((commandQueue = []), (queueCommand.queue = commandQueue), queueCommand);

  // Payment processor integration - works with Stripe, PayPal, etc.
  let setupPaymentIntegration = (processorType, processorDomain) => {
    console.log(`[Arkvon] Setting up ${processorType} integration`);

    // Wait for payment elements to appear in DOM (polling with timeout)
    let waitForPaymentElements = (selector, callback) => {
      let attempts = 0;
      let maxAttempts = 20; // Increased for better reliability

      let interval = setInterval(() => {
        var elements = document.querySelectorAll(selector);

        if (elements.length > 0 || attempts >= maxAttempts) {
          clearInterval(interval);
          if (elements.length > 0) {
            console.log(`[Arkvon] Found ${elements.length} payment elements`);
            callback(elements);
          } else {
            console.log(
              `[Arkvon] No payment elements found after ${maxAttempts} attempts`
            );
          }
        }
        attempts++;
      }, 250); // Check every 250ms for faster detection
    };

    // Define selectors for different payment processors
    let paymentSelectors = {
      // Stripe integration
      stripe_links: processorDomain
        ? `a[href*="${processorDomain}"], a[href*="buy.stripe.com"], a[href*="checkout.stripe.com"]`
        : 'a[href*="buy.stripe.com"], a[href*="checkout.stripe.com"]',
      stripe_elements: "stripe-pricing-table, stripe-buy-button",

      // PayPal integration
      paypal_buttons: ".paypal-buttons, [data-paypal-button]",
      paypal_links: `a[href*="paypal.com/checkout"], a[href*="paypal.me"]`,

      // Generic payment forms
      payment_forms:
        "form[action*='checkout'], form[action*='payment'], form[action*='subscribe']",
    };

    let selector = paymentSelectors[processorType];
    if (!selector) {
      console.warn(`[Arkvon] Unknown payment processor type: ${processorType}`);
      return;
    }

    waitForPaymentElements(selector, (elements) => {
      if (processorType.includes("links")) {
        modifyPaymentLinks(elements, processorType);
      } else if (processorType.includes("elements")) {
        modifyPaymentElements(elements);
      } else if (processorType.includes("forms")) {
        modifyPaymentForms(elements);
      } else {
        modifyPaymentButtons(elements);
      }
    });
  };

  // Modify payment link URLs to include Arkvon referral tracking
  function modifyPaymentLinks(elements, processorType) {
    if (!window.arkvon_referral || elements.length === 0) return;

    console.log(`[Arkvon] Modifying ${elements.length} payment links`);

    for (let i = 0; i < elements.length; i++) {
      let link = elements[i];
      let paramName = getTrackingParamName(processorType);

      // Skip if already has tracking parameter
      if (link.href.indexOf(paramName) !== -1) continue;

      // Add tracking parameter
      let separator = link.href.indexOf("?") === -1 ? "?" : "&";
      link.href =
        link.href +
        separator +
        paramName +
        "=" +
        encodeURIComponent(window.arkvon_referral);

      console.log(`[Arkvon] Modified link: ${link.href}`);
    }
  }

  // Modify payment processor embedded elements
  function modifyPaymentElements(elements) {
    if (!window.arkvon_referral || elements.length === 0) return;

    console.log(`[Arkvon] Modifying ${elements.length} payment elements`);

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];

      // Add various possible referral attributes
      let attributes = [
        "client-reference-id",
        "data-referral",
        "data-arkvon-ref",
      ];

      attributes.forEach((attr) => {
        if (!element.hasAttribute(attr)) {
          element.setAttribute(attr, window.arkvon_referral);
        }
      });
    }
  }

  // Modify payment forms to include hidden referral fields
  function modifyPaymentForms(elements) {
    if (!window.arkvon_referral || elements.length === 0) return;

    console.log(`[Arkvon] Modifying ${elements.length} payment forms`);

    for (let i = 0; i < elements.length; i++) {
      let form = elements[i];

      // Check if referral field already exists
      if (form.querySelector('input[name="arkvon_referral"]')) continue;

      // Create hidden input for referral tracking
      let hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.name = "arkvon_referral";
      hiddenInput.value = window.arkvon_referral;

      form.appendChild(hiddenInput);
      console.log(`[Arkvon] Added referral field to form`);
    }
  }

  // Modify payment buttons (PayPal, etc.)
  function modifyPaymentButtons(elements) {
    if (!window.arkvon_referral || elements.length === 0) return;

    console.log(`[Arkvon] Modifying ${elements.length} payment buttons`);

    // This would need specific implementation based on payment processor APIs
    // For example, PayPal buttons might need custom data attributes
    for (let i = 0; i < elements.length; i++) {
      let button = elements[i];
      button.setAttribute("data-arkvon-referral", window.arkvon_referral);
    }
  }

  // Get appropriate tracking parameter name for different processors
  function getTrackingParamName(processorType) {
    const paramMap = {
      stripe_links: "client_reference_id",
      paypal_links: "custom",
      payment_forms: "ref",
    };

    return paramMap[processorType] || "arkvon_ref";
  }

  // Enhanced cookie management with better security and flexibility
  function setArkvonCookie(name, value, days, options = {}) {
    let date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    let expires = "expires=" + date.toUTCString();

    // Default cookie options
    let cookieOptions = {
      path: "/",
      domain: domain,
      samesite: "lax", // More permissive than 'none' for better compatibility
      secure: window.location.protocol === "https:",
      ...options,
    };

    let cookieString;
    if (name === "arkvon_referral") {
      // Simple string value for referral code
      cookieString = `arkvon_referral=${encodeURIComponent(value)}`;
    } else {
      // JSON encoded value for complex data
      cookieString = `${name}=${encodeURIComponent(JSON.stringify(value))}`;
    }

    // Add options to cookie string
    cookieString += `;${expires};path=${cookieOptions.path}`;
    if (cookieOptions.domain) cookieString += `;domain=${cookieOptions.domain}`;
    cookieString += `;samesite=${cookieOptions.samesite}`;
    if (cookieOptions.secure) cookieString += `;secure`;

    document.cookie = cookieString;
    console.log(`[Arkvon] Set cookie: ${name}`);
  }

  function getArkvonCookie(name) {
    let cookieArray = ("; " + document.cookie).split(`; ${name}=`);

    if (cookieArray.length === 2) {
      let cookieValue = decodeURIComponent(
        cookieArray.pop().split(";").shift()
      );

      try {
        return JSON.parse(cookieValue);
      } catch (error) {
        return cookieValue;
      }
    }
    return null;
  }

  // Enhanced API communication with retry logic and better error handling
  async function makeArkvonApiCall(endpoint, data, retries = 3) {
    if (!publicId || !domain) {
      console.warn("[Arkvon] Public ID or domain missing. API calls disabled.");
      return null;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Arkvon] API call to ${endpoint} (attempt ${attempt})`);

        let requestData = {
          ...data,
          public_id: publicId,
          domain: domain,
          timestamp: Date.now(),
          user_agent: navigator.userAgent,
          referrer: document.referrer,
          page_url: window.location.href,
        };

        if (window.arkvon_referral) {
          requestData.referral_code = window.arkvon_referral;
        }

        let response = await fetch(`${apiBaseUrl}/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Arkvon-Version": "1.0",
            "X-Arkvon-Source": "tracking-script",
          },
          body: JSON.stringify(requestData),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let result = await response.json();
        console.log(`[Arkvon] API call successful:`, result);

        // Handle specific responses
        if (endpoint === "signup" && result.customer_id) {
          window.arkvon_data.customer_id = result.customer_id;
          setArkvonCookie("arkvon_data", window.arkvon_data, 30);
        }

        if (endpoint === "conversion" && result.commission_earned) {
          console.log(
            `[Arkvon] Commission tracked: $${result.commission_earned}`
          );
        }

        return result;
      } catch (error) {
        console.error(`[Arkvon] API call failed (attempt ${attempt}):`, error);

        if (attempt === retries) {
          // Final attempt failed - could implement offline queue here
          console.error(`[Arkvon] All API attempts failed for ${endpoint}`);
          return null;
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }
  }

  // Enhanced command processor with more tracking events
  async function processArkvonCommand(command, data) {
    console.log(`[Arkvon] Processing command: ${command}`, data);

    switch (command) {
      case "click":
        return makeArkvonApiCall("clicks", {
          click_type: data.type || "generic",
          element_id: data.element_id,
          element_class: data.element_class,
          ...data,
        });

      case "signup":
        return makeArkvonApiCall("signup", {
          email: data.email,
          name: data.name,
          signup_source: data.source || "website",
          ...data,
        });

      case "conversion":
        return makeArkvonApiCall("conversion", {
          conversion_type: data.type || "purchase",
          value: data.value,
          currency: data.currency || "USD",
          transaction_id: data.transaction_id,
          ...data,
        });

      case "page_view":
        return makeArkvonApiCall("page_view", {
          page: data.page || window.location.pathname,
          title: data.title || document.title,
          ...data,
        });

      case "custom":
        return makeArkvonApiCall("custom_event", {
          event_name: data.event_name,
          event_data: data.event_data,
          ...data,
        });

      default:
        console.warn(`[Arkvon] Unknown command: ${command}`);
        return null;
    }
  }

  // Main initialization function with better error handling
  (async () => {
    try {
      console.log("[Arkvon] Initializing tracking script...");

      // Find script tag with data-arkvon attribute
      let scriptTag = document.querySelector("script[data-arkvon]");
      publicId = scriptTag ? scriptTag.getAttribute("data-arkvon") : null;

      if (!publicId) {
        console.warn(
          "[Arkvon] Public ID (data-arkvon) missing. Initialization aborted."
        );
        return;
      }

      console.log(`[Arkvon] Public ID: ${publicId}`);

      // Main initialization function
      let initializeArkvon = async () => {
        // Determine domain for cookie setting
        let hostname = window.location.hostname;

        if (hostname === "localhost" || hostname.endsWith(".local")) {
          domain = hostname;
        } else {
          // Extract main domain (e.g., example.com from sub.example.com)
          let domainParts = hostname.split(".");
          domain =
            domainParts.length > 2 ? domainParts.slice(-2).join(".") : hostname;
        }

        console.log(`[Arkvon] Domain: ${domain}`);

        // Check for existing tracking data in cookies
        let existingReferral = getArkvonCookie("arkvon_referral");
        let existingData = getArkvonCookie("arkvon_data");

        if (existingReferral || existingData) {
          console.log("[Arkvon] Loading existing tracking data from cookies");
          window.arkvon_referral = existingReferral;
          window.arkvon_data = existingData;
        } else {
          // Look for referral parameters in current URL
          let urlParams = new URLSearchParams(window.location.search);

          // Extended list of referral parameters to check
          let referralParams = [
            "arkvon",
            "ref",
            "referral",
            "aff",
            "affiliate",
            "partner",
            "via",
            "utm_source",
            "source",
            "lmref",
            "fpr",
            "tap_s",
            "afmc",
            "promo",
          ];

          let foundReferralParam = null;
          let referralCode = null;

          // Find the first matching referral parameter
          for (let param of referralParams) {
            if (urlParams.has(param)) {
              foundReferralParam = param;
              referralCode = urlParams.get(param);
              console.log(
                `[Arkvon] Found referral parameter: ${param}=${referralCode}`
              );
              break;
            }
          }

          // If referral found, track the click and set up tracking
          if (foundReferralParam && referralCode) {
            let clickData = {
              param_name: foundReferralParam,
              referral_code: referralCode,
              landing_page: window.location.href,
              referrer_url: document.referrer || null,
              user_agent: navigator.userAgent,
              timestamp: Date.now(),
            };

            try {
              let clickResult = await makeArkvonApiCall("clicks", clickData);

              if (clickResult && clickResult.success) {
                let cookieDuration = clickResult.cookie_duration || 30;

                console.log(
                  `[Arkvon] Tracking setup successful. Cookie duration: ${cookieDuration} days`
                );

                // Set referral tracking cookie
                setArkvonCookie(
                  "arkvon_referral",
                  clickResult.referral_id || referralCode,
                  cookieDuration
                );
                window.arkvon_referral =
                  clickResult.referral_id || referralCode;

                // Set comprehensive tracking data
                window.arkvon_data = {
                  click_id: clickResult.click_id,
                  referral_id: clickResult.referral_id || referralCode,
                  partner_id: clickResult.partner_id,
                  campaign_id: clickResult.campaign_id,
                  cookie_duration: cookieDuration,
                  created_at: Date.now(),
                };

                setArkvonCookie(
                  "arkvon_data",
                  window.arkvon_data,
                  cookieDuration
                );

                console.log(
                  "[Arkvon] Referral tracking activated:",
                  window.arkvon_data
                );
              }
            } catch (error) {
              console.error(
                "[Arkvon] Failed to initialize referral tracking:",
                error
              );
            }
          }
        }

        // Process any queued commands from before initialization
        console.log(
          `[Arkvon] Processing ${
            window.arkvon.queue?.length || 0
          } queued commands`
        );

        for (let { command, data } of window.arkvon.queue || []) {
          await processArkvonCommand(command, data);
        }

        // Clear queue and replace with direct function
        window.arkvon.queue = [];
        window.arkvon = async function (command, data) {
          return processArkvonCommand(command, data);
        };

        // Add convenience methods
        window.arkvon.signup = async function (email, additionalData = {}) {
          return processArkvonCommand("signup", { email, ...additionalData });
        };

        window.arkvon.conversion = async function (
          value,
          type = "purchase",
          additionalData = {}
        ) {
          return processArkvonCommand("conversion", {
            value,
            type,
            ...additionalData,
          });
        };

        window.arkvon.track = async function (eventName, eventData = {}) {
          return processArkvonCommand("custom", {
            event_name: eventName,
            event_data: eventData,
          });
        };

        // Setup payment processor integration if configured
        let arkvonScript = document.querySelector("script[data-arkvon]");
        if (arkvonScript) {
          let processorType = arkvonScript.getAttribute("data-payment-type");
          let processorDomain = arkvonScript.getAttribute(
            "data-payment-domain"
          );

          if (processorType) {
            console.log(
              `[Arkvon] Setting up payment integration: ${processorType}`
            );
            setupPaymentIntegration(processorType, processorDomain);
          }
        }

        // Track initial page view
        await processArkvonCommand("page_view", {
          is_landing_page: !existingReferral && !existingData,
        });

        // Dispatch ready event
        document.dispatchEvent(new Event("arkvonScriptLoaded"));
        console.log("[Arkvon] Tracking script fully initialized and ready");
      };

      // Initialize immediately (no external dependencies required)
      await initializeArkvon();
    } catch (error) {
      console.error("[Arkvon] Critical initialization error:", error);
    }
  })();

  // Auto-track common user interactions
  document.addEventListener("DOMContentLoaded", () => {
    // Track clicks on important elements
    document.addEventListener("click", (event) => {
      let element = event.target;

      // Track clicks on buttons, links, and form submissions
      if (
        element.tagName === "BUTTON" ||
        element.tagName === "A" ||
        element.type === "submit"
      ) {
        // Only track if we have referral data
        if (window.arkvon_referral) {
          processArkvonCommand("click", {
            type: element.tagName.toLowerCase(),
            element_id: element.id || null,
            element_class: element.className || null,
            element_text: element.textContent?.trim().substring(0, 100) || null,
            href: element.href || null,
          });
        }
      }
    });

    // Track form submissions
    document.addEventListener("submit", (event) => {
      if (window.arkvon_referral) {
        let form = event.target;
        processArkvonCommand("custom", {
          event_name: "form_submit",
          event_data: {
            form_id: form.id || null,
            form_class: form.className || null,
            form_action: form.action || null,
            form_method: form.method || "GET",
          },
        });
      }
    });
  });

  // Expose utility functions for manual integration
  window.arkvonUtils = {
    // Get current referral data
    getReferralData: () => ({
      referral_code: window.arkvon_referral,
      tracking_data: window.arkvon_data,
    }),

    // Check if user came from referral
    isReferralUser: () => !!window.arkvon_referral,

    // Manually set referral (useful for custom integrations)
    setReferral: (referralCode, duration = 30) => {
      window.arkvon_referral = referralCode;
      setArkvonCookie("arkvon_referral", referralCode, duration);
      console.log(`[Arkvon] Manually set referral: ${referralCode}`);
    },

    // Clear all tracking data
    clearTracking: () => {
      document.cookie =
        "arkvon_referral=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie =
        "arkvon_data=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      window.arkvon_referral = null;
      window.arkvon_data = null;
      console.log("[Arkvon] Tracking data cleared");
    },
  };
})();
