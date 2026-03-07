import { Link } from "wouter";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to PackPTS</Link>
        </div>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Effective date: March 1, 2026</p>

        <div className="space-y-8 text-sm leading-7">

          <section>
            <h2 className="text-lg font-semibold mb-3">1. Acceptance of Terms</h2>
            <p>By creating an account or using PackPTS ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Description of Service</h2>
            <p>PackPTS is a baseball trading card trivia game where players earn points (PackPTS) by correctly identifying cards, competing in matches, maintaining streaks, and completing daily challenges. Points may be redeemed for rewards as described in the app.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. Eligibility</h2>
            <p>You must be at least 13 years old to use the Service. By registering, you confirm that you meet this requirement. Users under 18 should have parental permission.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Accounts</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You are responsible for maintaining the confidentiality of your password.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You may not create multiple accounts to gain unfair advantages.</li>
              <li>We reserve the right to suspend or terminate accounts that violate these terms.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Points and Rewards</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>PackPTS points have no cash value and cannot be transferred, sold, or exchanged outside the platform.</li>
              <li>We reserve the right to adjust point values, reward thresholds, and redemption options at any time.</li>
              <li>Points earned through manipulation, cheating, or exploiting bugs will be forfeited and the account may be banned.</li>
              <li>Unused points may expire after 12 months of account inactivity.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Purchases</h2>
            <p>Some features require payment. All purchases are final and non-refundable unless required by law. Payments are processed by Stripe. By making a purchase you agree to Stripe's terms of service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Use bots, scripts, or automated tools to play the game or earn points.</li>
              <li>Exploit bugs or glitches for unfair advantage.</li>
              <li>Harass, threaten, or abuse other users.</li>
              <li>Attempt to reverse-engineer or interfere with the Service.</li>
              <li>Use the Service for any unlawful purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. Intellectual Property</h2>
            <p>All content, branding, code, and design of PackPTS is owned by us or licensed to us. Card images are provided by CardHedge and are subject to their licensing terms. You may not reproduce or redistribute any content without written permission.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">9. Disclaimers</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, accuracy of card data, or that the Service will be error-free.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">10. Limitation of Liability</h2>
            <p>To the fullest extent permitted by law, PackPTS shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service, including loss of points or rewards due to technical issues.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">11. Termination</h2>
            <p>We may suspend or terminate your account at any time for violation of these terms. You may delete your account at any time by contacting support. Upon termination, your points and progress are forfeited.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">12. Changes to Terms</h2>
            <p>We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the new terms. We will post the updated terms with a new effective date.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">13. Governing Law</h2>
            <p>These terms are governed by the laws of the United States. Any disputes shall be resolved through binding arbitration rather than in court, except where prohibited by law.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">14. Contact</h2>
            <p>Questions about these terms? Contact us at: <strong>support@packpts.com</strong></p>
          </section>

        </div>
      </div>
    </div>
  );
}
