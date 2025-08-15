# USAGE EXAMPLES:

## Basic Setup

`<script data-arkvon="your_public_id" src="arkvon-tracking.js"></script>`

## With Payment Integration

`<script data-arkvon="your_public_id" data-payment-type="stripe_links" data-payment-domain="https://buy.stripe.com" src="arkvon-tracking.js"></script>`

## Track Events

`<script>
// Wait for script to load
document.addEventListener('arkvonScriptLoaded', function() {

        // Track signup
        arkvon('signup', {
          email: 'user@example.com',
          name: 'John Doe',
          source: 'homepage_form'
        });

        // Track conversion/purchase
        arkvon('conversion', {
          type: 'purchase',
          value: 99.99,
          currency: 'USD',
          transaction_id: 'txn_123456'
        });

        // Track custom events
        arkvon('custom', {
          event_name: 'video_watched',
          event_data: {
            video_id: 'intro_video',
            watch_duration: 120
          }
        });

        // Using convenience methods
        arkvon.signup('user@example.com', { source: 'modal' });
        arkvon.conversion(49.99, 'subscription');
        arkvon.track('button_click', { button_name: 'get_started' });

        // Check if user came from referral
        if (arkvonUtils.isReferralUser()) {
          console.log('This user came from a referral!');
          console.log(arkvonUtils.getReferralData());
        }
      });
    </script>`

### SUPPORTED PAYMENT PROCESSORS:

- stripe_links: Stripe payment links and checkout
- stripe_elements: Stripe embedded elements
- paypal_buttons: PayPal button integration
- paypal_links: PayPal payment links
- payment_forms: Generic payment forms

### REFERRAL PARAMETERS DETECTED:

- arkvon, ref, referral, aff, affiliate
- partner, via, utm_source, source
- lmref, fpr, tap_s, afmc, promo

### API ENDPOINTS CALLED:

- POST /clicks - Track referral clicks
- POST /signup - Track user signups
- POST /conversion - Track purchases/conversions
- POST /page_view - Track page views
- POST /custom_event - Track custom events
