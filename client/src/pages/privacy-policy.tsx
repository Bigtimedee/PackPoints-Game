import { Link } from "wouter";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to PackPTS</Link>
        </div>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Effective date: March 1, 2026</p>

        <div className="space-y-8 text-sm leading-7">

          <section>
            <h2 className="text-lg font-semibold mb-3">1. Who We Are</h2>
            <p>PackPTS ("we," "us," or "our") operates the game and website located at PackPTS.com. This Privacy Policy explains how we collect, use, and protect your information when you use our service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Account information:</strong> username, email address, and password when you register.</li>
              <li><strong>Gameplay data:</strong> match history, scores, streaks, correct/incorrect answers, and points earned.</li>
              <li><strong>Device and usage data:</strong> IP address, browser type, device fingerprint, and pages visited, collected automatically when you use the service.</li>
              <li><strong>Payment information:</strong> processed securely by Stripe. We do not store credit card numbers.</li>
              <li><strong>Communications:</strong> any messages you send us via email or support channels.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To create and manage your account.</li>
              <li>To operate the game, display leaderboards, and award points and rewards.</li>
              <li>To process purchases and transactions.</li>
              <li>To send you transactional emails (e.g., password reset, purchase confirmation).</li>
              <li>To detect fraud, abuse, and violations of our Terms of Service.</li>
              <li>To improve the service through analytics and usage patterns.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Information Sharing</h2>
            <p>We do not sell your personal information. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Service providers:</strong> Stripe (payments), Resend (email), WorkOS (authentication), Railway (hosting). Each is bound by their own privacy policies.</li>
              <li><strong>Legal requirements:</strong> if required by law, court order, or to protect our rights.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Leaderboards and Public Information</h2>
            <p>Your username and game scores may be displayed publicly on leaderboards. Do not use your real name as your username if you prefer anonymity.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Data Retention</h2>
            <p>We retain your account data for as long as your account is active. If you request deletion, we will remove your personal information within 30 days, except where retention is required by law.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. Security</h2>
            <p>We use industry-standard security measures including encrypted connections (HTTPS), hashed passwords, and access controls. No system is 100% secure, and we cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. Children's Privacy</h2>
            <p>PackPTS is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us information, contact us and we will delete it.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">9. Your Rights</h2>
            <p>You may request access to, correction of, or deletion of your personal data at any time by contacting us at the address below. California residents may have additional rights under the CCPA.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">10. Changes to This Policy</h2>
            <p>We may update this policy from time to time. We will notify you of material changes by posting the new policy on this page with an updated effective date.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">11. Contact Us</h2>
            <p>For privacy-related questions or requests, contact us at: <strong>support@packpts.com</strong></p>
          </section>

        </div>
      </div>
    </div>
  );
}
