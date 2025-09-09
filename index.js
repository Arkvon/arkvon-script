(() => {
  // Configuration
  let apiBaseUrl = "https://api.arkvon.com/"; // will be updated when the backend is hosted
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

  // Enhanced cookie management with better security and flexibility
  function setArkvonCookie(name, value, days, options = {}) {
    try {
      if (!name || value === undefined || value === null) {
        console.warn(`[Arkvon] Invalid cookie parameters: ${name}, ${value}`);
        return false;
      }

      let date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      let expires = "expires=" + date.toUTCString();

      // Default cookie options
      let cookieOptions = {
        path: "/",
        domain: domain,
        samesite: "lax",
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
      if (cookieOptions.domain)
        cookieString += `;domain=${cookieOptions.domain}`;
      cookieString += `;samesite=${cookieOptions.samesite}`;
      if (cookieOptions.secure) cookieString += `;secure`;

      document.cookie = cookieString;
      console.log(`[Arkvon] Set cookie: ${name}`);
      return true;
    } catch (error) {
      console.error(`[Arkvon] Failed to set cookie ${name}:`, error);
      return false;
    }
  }

  function getArkvonCookie(name) {
    try {
      if (!name) {
        console.warn("[Arkvon] Cookie name is required");
        return null;
      }

      let cookieArray = ("; " + document.cookie).split(`; ${name}=`);

      if (cookieArray.length === 2) {
        let cookieValue = decodeURIComponent(
          cookieArray.pop().split(";").shift()
        );

        if (!cookieValue) return null;

        try {
          return JSON.parse(cookieValue);
        } catch (error) {
          return cookieValue;
        }
      }
      return null;
    } catch (error) {
      console.error(`[Arkvon] Failed to get cookie ${name}:`, error);
      return null;
    }
  }

  // Enhanced API communication with retry logic and better error handling
  async function makeArkvonApiCall(endpoint, data, retries = 3) {
    if (!publicId) {
      console.warn("[Arkvon] Public ID missing. API calls disabled.");
      return null;
    }

    if (!endpoint || typeof endpoint !== "string") {
      console.warn("[Arkvon] Invalid endpoint provided");
      return null;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Arkvon] API call to ${endpoint} (attempt ${attempt})`);

        let requestData = {
          ...data,
          public_id: publicId,
          domain: domain || window.location.hostname,
          timestamp: Date.now(),
          user_agent: navigator.userAgent,
          referrer: document.referrer || null,
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
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let result = await response.json();
        console.log(`[Arkvon] API call successful:`, result);

        // Handle specific responses with better error checking
        if (endpoint === "signup" && result && result.customer_id) {
          if (window.arkvon_data) {
            window.arkvon_data.customer_id = result.customer_id;
            setArkvonCookie("arkvon_data", window.arkvon_data, 30);
          }
        }

        return result;
      } catch (error) {
        console.error(`[Arkvon] API call failed (attempt ${attempt}):`, error);

        if (attempt === retries) {
          console.error(`[Arkvon] All API attempts failed for ${endpoint}`);
          return null;
        }

        // Wait before retry (exponential backoff with jitter)
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Enhanced command processor with better validation
  async function processArkvonCommand(command, data = {}) {
    if (!command || typeof command !== "string") {
      console.warn("[Arkvon] Invalid command provided");
      return null;
    }

    console.log(`[Arkvon] Processing command: ${command}`, data);

    try {
      switch (command) {
        case "signup":
          if (!data.email) {
            console.warn("[Arkvon] Email is required for signup tracking");
            return null;
          }
          return await makeArkvonApiCall("signup", {
            email: data.email,
            name: data.name || null,
            signup_source: data.source || "website",
            ...data,
          });

        case "custom":
          if (!data.event_name) {
            console.warn("[Arkvon] Event name is required for custom tracking");
            return null;
          }
          return await makeArkvonApiCall("custom_event", {
            event_name: data.event_name,
            event_data: data.event_data || {},
            ...data,
          });

        default:
          console.warn(`[Arkvon] Unknown command: ${command}`);
          return null;
      }
    } catch (error) {
      console.error(`[Arkvon] Error processing command ${command}:`, error);
      return null;
    }
  }

  // Form tracking setup for submit-btn elements
  function setupFormTracking() {
    try {
      console.log("[Arkvon] Setting up form tracking for submit-btn elements");

      // Function to extract form data
      function extractFormData(form) {
        const formData = {};
        const formElements = form.elements;

        for (let element of formElements) {
          if (element.name && element.value !== undefined) {
            // Handle different input types
            switch (element.type) {
              case "checkbox":
                formData[element.name] = element.checked;
                break;
              case "radio":
                if (element.checked) {
                  formData[element.name] = element.value;
                }
                break;
              case "select-multiple":
                formData[element.name] = Array.from(
                  element.selectedOptions
                ).map((option) => option.value);
                break;
              default:
                formData[element.name] = element.value;
            }
          }
        }

        return formData;
      }

      // Function to handle form submission
      function handleFormSubmission(event) {
        try {
          const form = event.target;
          const submitBtn = form.querySelector("#submit-btn");

          if (!submitBtn) return; // Only track forms with submit-btn id

          console.log(
            "[Arkvon] Form with submit-btn detected, extracting data"
          );

          // Extract form data
          const formData = extractFormData(form);

          // Look for email field (common field names)
          const emailFields = [
            "email",
            "user_email",
            "customer_email",
            "signup_email",
            "login_email",
          ];
          let email = null;

          for (let fieldName of emailFields) {
            if (
              formData[fieldName] &&
              typeof formData[fieldName] === "string"
            ) {
              email = formData[fieldName].trim();
              break;
            }
          }

          if (!email) {
            console.warn(
              "[Arkvon] No email field found in form, cannot track signup"
            );
            return;
          }

          // Prepare signup data
          const signupData = {
            email: email,
            form_data: formData,
            form_id: form.id || null,
            form_action: form.action || null,
            form_method: form.method || "GET",
            submit_btn_id: submitBtn.id,
            submit_btn_text:
              submitBtn.textContent?.trim() || submitBtn.value || null,
            source: "form_tracking",
          };

          // Track the signup
          processArkvonCommand("signup", signupData);
        } catch (error) {
          console.error("[Arkvon] Error handling form submission:", error);
        }
      }

      // Set up event listener for form submissions
      document.addEventListener("submit", handleFormSubmission, true);

      // Also set up for dynamically added forms
      const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node contains forms with submit-btn
              const forms =
                node.tagName === "FORM"
                  ? [node]
                  : node.querySelectorAll
                  ? node.querySelectorAll("form")
                  : [];

              forms.forEach(function (form) {
                if (form.querySelector("#submit-btn")) {
                  console.log("[Arkvon] New form with submit-btn detected");
                }
              });
            }
          });
        });
      });

      // Start observing
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      console.log("[Arkvon] Form tracking setup complete");
    } catch (error) {
      console.error("[Arkvon] Error setting up form tracking:", error);
    }
  }

  // Main initialization function with better error handling
  (async () => {
    try {
      console.log("[Arkvon] Initializing tracking script...");

      // Find script tag with data-arkvon attribute
      let scriptTag = document.querySelector("script[data-arkvon]");
      publicId = scriptTag ? scriptTag.getAttribute("data-arkvon") : null;

      if (!publicId || typeof publicId !== "string" || publicId.trim() === "") {
        console.warn(
          "[Arkvon] Valid public ID (data-arkvon) missing. Initialization aborted."
        );
        return;
      }

      publicId = publicId.trim();
      console.log(`[Arkvon] Public ID: ${publicId}`);

      // Main initialization function
      let initializeArkvon = async () => {
        // Determine domain for cookie setting with better validation
        try {
          let hostname = window.location.hostname;

          if (!hostname) {
            console.warn("[Arkvon] Could not determine hostname");
            domain = null;
          } else if (hostname === "localhost" || hostname.endsWith(".local")) {
            domain = hostname;
          } else {
            // Extract main domain (e.g., example.com from sub.example.com)
            let domainParts = hostname.split(".");
            domain =
              domainParts.length > 2
                ? domainParts.slice(-2).join(".")
                : hostname;
          }

          console.log(`[Arkvon] Domain: ${domain}`);
        } catch (error) {
          console.error("[Arkvon] Error determining domain:", error);
          domain = null;
        }

        // Check for existing tracking data in cookies
        let existingReferral = getArkvonCookie("arkvon_referral");
        let existingData = getArkvonCookie("arkvon_data");

        if (existingReferral && typeof existingReferral === "string") {
          console.log("[Arkvon] Loading existing tracking data from cookies");
          window.arkvon_referral = existingReferral;
          window.arkvon_data =
            existingData && typeof existingData === "object"
              ? existingData
              : null;
        } else {
          // Look for referral parameters in current URL
          try {
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
                let paramValue = urlParams.get(param);
                if (paramValue && paramValue.trim() !== "") {
                  foundReferralParam = param;
                  referralCode = paramValue.trim();
                  console.log(
                    `[Arkvon] Found referral parameter: ${param}=${referralCode}`
                  );
                  break;
                }
              }
            }

            // If referral found, set up tracking
            if (foundReferralParam && referralCode) {
              try {
                console.log(
                  `[Arkvon] Setting up referral tracking for: ${referralCode}`
                );

                // Default cookie duration
                let cookieDuration = 30;

                // Set referral tracking cookie
                setArkvonCookie(
                  "arkvon_referral",
                  referralCode,
                  cookieDuration
                );
                window.arkvon_referral = referralCode;

                // Set comprehensive tracking data
                window.arkvon_data = {
                  referral_id: referralCode,
                  param_name: foundReferralParam,
                  landing_page: window.location.href,
                  referrer_url: document.referrer || null,
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
              } catch (error) {
                console.error(
                  "[Arkvon] Failed to initialize referral tracking:",
                  error
                );
              }
            }
          } catch (error) {
            console.error("[Arkvon] Error parsing URL parameters:", error);
          }
        }

        // Process any queued commands from before initialization
        const queueLength = window.arkvon.queue?.length || 0;
        console.log(`[Arkvon] Processing ${queueLength} queued commands`);

        if (window.arkvon.queue && Array.isArray(window.arkvon.queue)) {
          for (let item of window.arkvon.queue) {
            if (item && typeof item === "object" && item.command) {
              try {
                await processArkvonCommand(item.command, item.data || {});
              } catch (error) {
                console.error(
                  "[Arkvon] Error processing queued command:",
                  error
                );
              }
            }
          }
        }

        // Clear queue and replace with direct function
        window.arkvon.queue = [];
        window.arkvon = async function (command, data = {}) {
          return await processArkvonCommand(command, data);
        };

        // Add convenience methods with better validation
        window.arkvon.signup = async function (email, additionalData = {}) {
          if (!email || typeof email !== "string") {
            console.warn("[Arkvon] Valid email is required for signup");
            return null;
          }
          return await processArkvonCommand("signup", {
            email,
            ...additionalData,
          });
        };

        // Set up form tracking for submit-btn elements
        setupFormTracking();

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
      try {
        const expireDate = "expires=Thu, 01 Jan 1970 00:00:00 UTC";
        const cookiePath = "path=/";
        const domainStr = domain ? `;domain=${domain}` : "";

        document.cookie = `arkvon_referral=; ${expireDate}; ${cookiePath}${domainStr}`;
        document.cookie = `arkvon_data=; ${expireDate}; ${cookiePath}${domainStr}`;

        window.arkvon_referral = null;
        window.arkvon_data = null;
        console.log("[Arkvon] Tracking data cleared");
      } catch (error) {
        console.error("[Arkvon] Error clearing tracking data:", error);
      }
    },
  };
})();
