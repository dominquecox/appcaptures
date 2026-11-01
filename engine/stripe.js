// engine/stripe.js — Stripe checkout, customer portal, and webhook handling (AC-013)

export const STRIPE_PRODUCTS = {
  lifetime: {
    id: "lifetime",
    name: "AppCaptures Lifetime Studio Pass",
    description: "Watermark-free exports, all store presets, brand kits, 50 AI credits included",
    amount_cents: 1900,
    currency: "usd",
    mode: "payment",
    plan: "lifetime",
    credits_granted: 50,
  },
  pro_monthly: {
    id: "pro_monthly",
    name: "AppCaptures Pro Creator (Monthly)",
    description: "Unlimited exports, 250 AI credits/mo, priority R2 cloud sync, new templates first",
    amount_cents: 900,
    currency: "usd",
    mode: "subscription",
    interval: "month",
    plan: "pro",
    credits_granted: 250,
  },
  pro_yearly: {
    id: "pro_yearly",
    name: "AppCaptures Pro Creator (Annual)",
    description: "Unlimited exports, 250 AI credits/mo, priority R2 cloud sync, new templates first (save 27%)",
    amount_cents: 7900,
    currency: "usd",
    mode: "subscription",
    interval: "year",
    plan: "pro",
    credits_granted: 250,
  },
  credits_100: {
    id: "credits_100",
    name: "100 AI Credits Pack",
    description: "100 AI Listing or Social Post generations. Credits never expire.",
    amount_cents: 499,
    currency: "usd",
    mode: "payment",
    plan: null,
    credits_granted: 100,
  },
  credits_500: {
    id: "credits_500",
    name: "500 AI Credits Pack",
    description: "500 AI Listing or Social Post generations. Credits never expire.",
    amount_cents: 1499,
    currency: "usd",
    mode: "payment",
    plan: null,
    credits_granted: 500,
  },
};

export function resolveProduct(productId) {
  if (!productId) return STRIPE_PRODUCTS.lifetime;
  const key = String(productId).toLowerCase().trim();
  if (STRIPE_PRODUCTS[key]) return STRIPE_PRODUCTS[key];
  if (key === "pro") return STRIPE_PRODUCTS.pro_monthly;
  if (key === "annual" || key === "yearly") return STRIPE_PRODUCTS.pro_yearly;
  if (key === "credits" || key === "pack_100" || key === "100") return STRIPE_PRODUCTS.credits_100;
  if (key === "pack_500" || key === "500") return STRIPE_PRODUCTS.credits_500;
  return null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300, nowSec = null) {
  if (!signatureHeader || !secret) {
    return { valid: false, error: "missing signature header or secret" };
  }

  const parts = signatureHeader.split(",");
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (k === "t") timestamp = parseInt(v, 10);
    if (k === "v1" && v) signatures.push(v);
  }

  if (!timestamp || signatures.length === 0 || isNaN(timestamp)) {
    return { valid: false, error: "invalid signature header format" };
  }

  const currentSec = nowSec !== null ? nowSec : Math.floor(Date.now() / 1000);
  if (Math.abs(currentSec - timestamp) > toleranceSeconds) {
    return { valid: false, error: "timestamp outside tolerance window" };
  }

  const payload = `${timestamp}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expectedHex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  let matched = false;
  for (const sig of signatures) {
    if (timingSafeEqual(sig, expectedHex)) {
      matched = true;
      break;
    }
  }

  return { valid: matched, timestamp, error: matched ? null : "signature mismatch" };
}

export async function createCheckoutSession({
  env,
  user,
  productId,
  successUrl,
  cancelUrl,
  origin = "https://appcaptures.com",
}) {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey && !env.MOCK_STRIPE) {
    throw new Error("stripe not configured");
  }

  const product = resolveProduct(productId);
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const sUrl = successUrl || `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cUrl = cancelUrl || `${origin}/app?checkout=cancel`;

  if (env.MOCK_STRIPE) {
    const mockId = `cs_test_${crypto.randomUUID().replace(/-/g, "")}`;
    return {
      id: mockId,
      url: `https://checkout.stripe.com/c/pay/${mockId}`,
      product,
    };
  }

  const params = new URLSearchParams();
  params.set("success_url", sUrl);
  params.set("cancel_url", cUrl);
  params.set("mode", product.mode);
  params.set("client_reference_id", user.id);
  params.set("metadata[userId]", user.id);
  params.set("metadata[productId]", product.id);

  if (user.stripe_customer_id) {
    params.set("customer", user.stripe_customer_id);
  } else {
    params.set("customer_email", user.email);
  }

  params.set("line_items[0][price_data][currency]", product.currency);
  params.set("line_items[0][price_data][product_data][name]", product.name);
  params.set("line_items[0][price_data][product_data][description]", product.description);
  params.set("line_items[0][price_data][unit_amount]", String(product.amount_cents));
  params.set("line_items[0][quantity]", "1");

  if (product.mode === "subscription") {
    params.set("line_items[0][price_data][recurring][interval]", product.interval);
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Stripe error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    url: data.url,
    product,
  };
}

export async function createPortalSession({
  env,
  user,
  returnUrl,
  origin = "https://appcaptures.com",
}) {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey && !env.MOCK_STRIPE) {
    throw new Error("stripe not configured");
  }

  if (!user.stripe_customer_id) {
    throw new Error("No active billing account found for user");
  }

  const rUrl = returnUrl || `${origin}/app`;

  if (env.MOCK_STRIPE) {
    const mockId = `bps_test_${crypto.randomUUID().replace(/-/g, "")}`;
    return {
      id: mockId,
      url: `https://billing.stripe.com/p/session/${mockId}`,
    };
  }

  const params = new URLSearchParams();
  params.set("customer", user.stripe_customer_id);
  params.set("return_url", rUrl);

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Stripe portal error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    url: data.url,
  };
}

export async function handleStripeWebhook({ env, event }) {
  if (!env.DB) throw new Error("no db");

  const eventId = String(event?.id || "").trim();
  const eventType = String(event?.type || "").trim();

  if (!eventId || !eventType) {
    return { ok: false, error: "missing event id or type" };
  }

  // Idempotency: verify if event was already processed
  const existing = await env.DB.prepare("SELECT id FROM stripe_events WHERE id = ?").bind(eventId).first();
  if (existing) {
    return { ok: true, duplicate: true, eventId };
  }

  // Record event in stripe_events
  await env.DB.prepare(
    "INSERT INTO stripe_events (id, type) VALUES (?, ?)"
  ).bind(eventId, eventType).run();

  const obj = event.data?.object || {};

  switch (eventType) {
    case "checkout.session.completed": {
      const userId = obj.metadata?.userId || obj.client_reference_id;
      const productId = obj.metadata?.productId || "lifetime";
      const product = resolveProduct(productId) || STRIPE_PRODUCTS.lifetime;
      const stripeCustomerId = obj.customer ? String(obj.customer) : null;
      const amountCents = typeof obj.amount_total === "number" ? obj.amount_total : product.amount_cents;

      if (!userId) break;

      // 1. Update plan and stripe_customer_id
      if (product.plan) {
        if (stripeCustomerId) {
          await env.DB.prepare(
            "UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?"
          ).bind(product.plan, stripeCustomerId, userId).run();
        } else {
          await env.DB.prepare(
            "UPDATE users SET plan = ? WHERE id = ?"
          ).bind(product.plan, userId).run();
        }
      } else if (stripeCustomerId) {
        await env.DB.prepare(
          "UPDATE users SET stripe_customer_id = ? WHERE id = ?"
        ).bind(stripeCustomerId, userId).run();
      }

      // 2. Insert into purchases table
      const purchaseId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO purchases (id, user_id, stripe_session_id, product, amount_cents, status) VALUES (?, ?, ?, ?, ?, 'completed')"
      ).bind(purchaseId, userId, obj.id, product.id, amountCents).run();

      // 3. Grant credits in credit_ledger
      if (product.credits_granted > 0) {
        const ledgerId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO credit_ledger (id, user_id, delta, reason, ref) VALUES (?, ?, ?, ?, ?)"
        ).bind(ledgerId, userId, product.credits_granted, `purchase_${product.id}`, obj.id).run();
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const stripeCustomerId = obj.customer ? String(obj.customer) : null;
      const billingReason = obj.billing_reason;
      if (stripeCustomerId && billingReason === "subscription_cycle") {
        const user = await env.DB.prepare(
          "SELECT id, plan FROM users WHERE stripe_customer_id = ?"
        ).bind(stripeCustomerId).first();

        if (user && user.plan === "pro") {
          const ledgerId = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO credit_ledger (id, user_id, delta, reason, ref) VALUES (?, ?, 250, 'subscription_renewal', ?)"
          ).bind(ledgerId, user.id, obj.id).run();
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const stripeCustomerId = obj.customer ? String(obj.customer) : null;
      if (stripeCustomerId) {
        await env.DB.prepare(
          "UPDATE users SET plan = 'free' WHERE stripe_customer_id = ? AND plan = 'pro'"
        ).bind(stripeCustomerId).run();
      }
      break;
    }

    default:
      break;
  }

  return { ok: true, processed: true, eventId, eventType };
}
