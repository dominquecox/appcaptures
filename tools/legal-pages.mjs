// Maintenance helper only: committed HTML is served directly, with no build step.
// Set EFFECTIVE_DATE to the development merge date; rerun if that date changes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const SUPPORT_EMAIL = 'support@appcaptures.com';
const EFFECTIVE_DATE = '2026-10-24';
const date = new Date(`${EFFECTIVE_DATE}T12:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
});
const mail = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;
const contact = `<p>AppCaptures is operated by <strong>Ploonu LLC</strong>, an Indiana limited liability company.</p>
<p>8063 Madison Ave, PMB 576, Indianapolis, IN 46227, United States.</p>
<p>Support and privacy requests: ${mail}.</p>`;
const footer = `<footer class="site"><div class="wrap">
<span>© 2026 AppCaptures · Ploonu LLC</span>
<a href="/">Home</a><a href="/news/">News</a><a href="/changelog/">Changelog</a>
<a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/support">Support</a>
<a href="/support#remove-email">Remove my email</a>${mail}
</div></footer>`;
const pages = {
  terms: {
    title: 'Terms of Service', description: 'Terms for the AppCaptures website and waitlist.',
    body: `<p>These Terms are an agreement between you and Ploonu LLC for your use of the AppCaptures website and waitlist. By using the website or joining the waitlist, you agree to these Terms. If you do not agree, stop using the website.</p>
<h2>1. Eligibility</h2>
<p>You must be legally able to agree to these Terms. If you act for an organization, you confirm that you have authority to bind it. Submit only an email address you control or have permission to use.</p>
<h2>2. Acceptable use</h2>
<p>Use the website lawfully. Do not submit another person’s email without permission, send spam, impersonate others, interfere with the website, bypass security protections, or infringe anyone’s rights.</p>
<h2>3. Intellectual property</h2>
<p>AppCaptures branding, website text, and design belong to Ploonu LLC or its licensors. You may view the website for its intended purpose. These Terms do not transfer ownership of our intellectual property or restrict rights provided by applicable law.</p>
<h2>4. Disclaimers</h2>
<p>The website is provided “as is” and “as available,” to the extent permitted by law. We do not guarantee uninterrupted or error-free access. Joining the waitlist does not guarantee access to a product or a particular launch date.</p>
<h2>5. Limitation of liability</h2>
<p>To the extent permitted by law, Ploonu LLC is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the website. Nothing in these Terms excludes liability or consumer rights that cannot lawfully be excluded.</p>
<h2>6. Termination</h2>
<p>You can stop using the website at any time. To leave the waitlist, follow the <a href="/support#remove-email">email removal instructions</a>. We may restrict access for misuse or violations of these Terms. Our <a href="/privacy">Privacy Policy</a> explains data retention and deletion.</p>
<h2>7. Governing law</h2>
<p>These Terms are governed by Indiana law, United States, without regard to conflict-of-law rules. Mandatory consumer protections where you live continue to apply.</p>
<h2>8. Changes</h2>
<p>We may update these Terms by posting a revised version with a new effective date. Review this page before continuing to use the website.</p>
<h2>9. Contact</h2>
${contact}`,
  },
  privacy: {
    title: 'Privacy Policy', description: 'How AppCaptures handles waitlist emails and website data.',
    body: `<p>This policy explains how Ploonu LLC handles information when you visit AppCaptures or join its waitlist.</p>
<h2>1. What you give us</h2>
<p>When you join the waitlist, we collect your email address and record a signup timestamp. A signup may also include an optional platform preference and referral source. We use waitlist information for launch and major-template emails. If you email support, we receive your email address and the information you include in your message.</p>
<h2>2. What is collected automatically</h2>
<p>Website delivery and security involve technical request information, such as your IP address, browser information, requested page, and request time. Cloudflare Turnstile checks browser and connection signals to protect the waitlist from automated abuse. Hosting logs are enabled to help diagnose errors and protect the website.</p>
<p>Your browser keeps a copy of your own waitlist entry in localStorage under the key <code>appcaptures_waitlist</code>. This includes the submitted email, submission time, form identifier, and, when available, the challenge response. A local copy may be saved even if the server signup fails. Clearing it does not remove a server entry. The website also caches page files in your browser for faster or offline loading.</p>
<p>The website does not load analytics, ads, or tracking cookies. Google Fonts requests are described below.</p>
<h2>3. Who processes data</h2>
<p>Cloudflare provides website hosting, waitlist database storage, operational logs, and Turnstile bot protection. It processes information needed to deliver and secure the website. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s Privacy Policy</a> and the <a href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile Privacy Addendum</a>.</p>
<p>The website loads fonts from Google Fonts. Your browser sends Google technical request information, including your IP address, when requesting those fonts. See <a href="https://fonts.googleblog.com/2022/11/your-privacy-and-google-fonts.html">Google’s explanation of font privacy</a>.</p>
<h2>4. Retention</h2>
<p>Waitlist entries remain stored until removed; there is no automatic expiry. You can request removal at any time. The browser copy stays until you clear site data. Hosting logs follow Cloudflare’s configured retention. Contact us with questions about a particular record.</p>
<h2>5. Deleting your data and unsubscribing</h2>
<p>Follow the <a href="/support#remove-email">Remove your email / unsubscribe instructions</a> to request removal from the waitlist and stop future waitlist emails. There are no accounts to delete. Clear AppCaptures site data in each browser you used to remove local copies; emailing us does not clear your browser storage.</p>
<h2>6. Your rights</h2>
<p>Depending on where you live, you may have rights to access, correct, receive a copy of, or delete your personal information, object to processing, withdraw consent, or complain to a data protection authority. Email ${mail} to make a request. We may ask for information needed to verify that the request concerns your data and will respond as required by applicable law.</p>
<h2>7. Children</h2>
<p>AppCaptures is not directed to children. We do not knowingly collect personal information from children. If you believe a child has provided personal information, contact us so we can review and remove it.</p>
<h2>8. Security</h2>
<p>We use HTTPS and bot protection to help protect the website and information in transit. No website or transmission method is perfectly secure. Avoid including sensitive information in a support message.</p>
<h2>9. International transfers</h2>
<p>Ploonu LLC is based in the United States. Our providers operate globally, so information may be processed in the United States and other countries with different data protection laws.</p>
<h2>10. Changes</h2>
<p>We may update this policy as our practices change. The current version and effective date will appear on this page.</p>
<h2>11. Contact</h2>
${contact}`,
  },
  support: {
    title: 'Support', description: 'Get AppCaptures help, make privacy requests, or remove your waitlist email.',
    body: `<p>For help with AppCaptures or its waitlist, email ${mail}. Include what happened and the browser you used. Do not send passwords or sensitive documents.</p>
<h2>Frequently asked questions</h2>
<h3>What will the waitlist emails cover?</h3>
<p>Launch and major-template updates. Joining is free, and you can <a href="/support#remove-email">unsubscribe or remove your email</a> at any time.</p>
<h3>Does the signup message confirm a server entry?</h3>
<p>The page can save a local copy if the connection fails, so the message alone does not guarantee your email reached us. Email support if you need help checking your signup.</p>
<h3>Do I need an account to request help?</h3>
<p>No. The website’s waitlist does not create an account.</p>
<h2>Privacy requests</h2>
<p>To request access, correction, or a copy of your information, email ${mail} from the address concerned and describe your request. See our <a href="/privacy">Privacy Policy</a> for details. For deletion, follow the <a href="/support#remove-email">removal steps below</a>.</p>
<h2 id="remove-email">Remove your email / unsubscribe</h2>
<ol>
<li>Email ${mail} from the address you used to join the waitlist.</li>
<li>Use the subject “Remove my email” and tell us whether you want to stop waitlist emails, delete your waitlist entry, or both. If you cannot access that address, explain this so we can help verify your request.</li>
<li>We handle requests manually and will confirm when the request has been completed. No account or sign-in is needed.</li>
<li>To remove the copy stored on your device, open your browser’s settings and clear site data for appcaptures.com. Repeat for each browser or device you used. This clears local waitlist copies and cached pages, but does not remove the server entry; email us for that.</li>
</ol>
<p>You do not need to install or open an app to make a removal request.</p>
<h2>Contact</h2>
${contact}`,
  },
};
const style = `:root{--paper:#f5f5f7;--ink:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--accent:#1d1d1f;--card:#fff}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--paper);color:var(--ink);font:15px/1.7 Inter,ui-sans-serif,-apple-system,sans-serif}
a{color:inherit;text-underline-offset:3px}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:2px}
.wrap{max-width:1060px;margin:0 auto;padding:0 24px}header.site{border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-block:16px}
.brand{font:800 17px "Hanken Grotesk",Inter,sans-serif;letter-spacing:-.02em;text-decoration:none}
nav{display:flex;gap:8px 20px;flex-wrap:wrap}nav a,footer.site a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
main{max-width:780px;margin:0 auto;padding:48px 24px 64px}h1{font:800 clamp(32px,5vw,48px)/1.1 "Hanken Grotesk",Inter,sans-serif;letter-spacing:-.03em;margin:12px 0 16px}
.date{font-size:13px;color:var(--muted)}.prose{border-top:1px solid var(--line);margin-top:28px;padding-top:12px}
h2{font-size:21px;line-height:1.35;margin:32px 0 12px;scroll-margin-top:24px}h3{font-size:16px;margin:24px 0 8px}p{margin:12px 0}li{margin:12px 0}code{overflow-wrap:anywhere}
footer.site{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--muted);font-size:13px}
footer.site .wrap{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center}footer.site a{overflow-wrap:anywhere}
.skip{position:absolute;top:-100px;left:16px;background:var(--ink);color:white;padding:12px}.skip:focus{top:8px}
@media(max-width:640px){main{padding-top:32px}.nav{align-items:flex-start;flex-direction:column}nav{gap:4px 18px}}`;
for (const [slug, page] of Object.entries(pages)) {
  const dir = new URL(`public/${slug}/`, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${page.title} — AppCaptures</title>
<meta name="description" content="${page.description}" />
<meta name="theme-color" content="#f5f5f7" />
<link rel="canonical" href="https://appcaptures.com/${slug}" />
<link rel="icon" type="image/png" href="/icons/icon-192.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&amp;family=Hanken+Grotesk:wght@700;800&amp;display=swap" rel="stylesheet" />
<style>
${style}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><div class="wrap nav">
<a class="brand" href="/">AppCaptures</a>
<nav aria-label="Primary"><a href="/terms"${slug === 'terms' ? ' aria-current="page"' : ''}>Terms</a><a href="/privacy"${slug === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a href="/support"${slug === 'support' ? ' aria-current="page"' : ''}>Support</a></nav>
</div></header>
<main id="main">
<p class="date">Ploonu LLC · Effective <time datetime="${EFFECTIVE_DATE}">${date}</time></p>
<h1>${page.title}</h1>
<p>${page.description}</p>
<div class="prose">
${page.body}
</div>
</main>
${footer}
</body>
</html>
`);
}
for (const file of ['public/index.html', 'public/news/index.html', 'public/changelog/index.html']) {
  const url = new URL(file, root);
  let html = readFileSync(url, 'utf8').replace(/<footer[\s\S]*?<\/footer>/, footer);
  // Ensure the existing news/changelog pages share the landing footer layout and focus style.
  if (!html.includes('/* legal-links */')) html = html.replace('</style>', `/* legal-links */
footer.site .wrap{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center}
footer.site a{display:inline-flex;align-items:center;min-height:44px}
a:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.band .fine a{color:#fff}
</style>`);
  if (file === 'public/index.html' && !html.includes('By joining you agree')) {
    const notice = '<p class="fine">By joining you agree to our <a href="/privacy">Privacy Policy</a>. <a href="/terms">Terms</a> · <a href="/support#remove-email">Remove my email / unsubscribe</a>.</p>';
    html = html.replace('</form>', `</form>\n${notice}`).replace('</form><p', `</form>${notice}<p`);
    // Preserve the band’s existing readable secondary-text color.
    html = html.replace(`</form>${notice}`, `</form>${notice.replace('class="fine"', 'class="fine" style="color:#a1a1a6"')}`);
  }
  writeFileSync(url, html);
}
