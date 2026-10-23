import { Link } from "wouter";
import { useEffect } from "react";

export default function TermsOfService() {
  // The page title must display the app name exactly (TikTok App Review
  // requirement): "PackPTS Terms of Service".
  useEffect(() => {
    const prev = document.title;
    document.title = "PackPTS Terms of Service";
    return () => { document.title = prev; };
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to PackPTS</Link>
        </div>

        <h1 className="text-3xl font-bold mb-2">PackPTS Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Effective date: October 14, 2026</p>

        <div className="space-y-8 text-sm leading-7">

          <section>
            <h2 className="text-lg font-semibold mb-3">1. Acceptance of Terms</h2>
            <p>By creating an account or using PackPTS ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Description of Service</h2>
            <p>PackPTS is a sports trading card trivia game. Each round shows a real baseball, basketball or football card with the player's name hidden, and you name the player. Modes include solo games, the Daily 5 and head-to-head matches. You earn points (PackPTS) by playing, and you can also buy points. You can apply points to eBay listings shown inside PackPTS to earn a cash rebate, as described in section 6. PackPTS has no tournaments, prize pools or cash prizes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. Eligibility</h2>
            <p>You must be at least 13 years old to use the Service. By registering, you confirm that you meet this requirement. Users under 18 should have parental permission.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Accounts</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You are responsible for keeping your login secure and for all activity under your account.</li>
              <li>You may not create multiple accounts, refer yourself, or act with others to gain points or rebates unfairly.</li>
              <li>We may suspend or terminate accounts that violate these terms.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Points</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Points are earned by playing, granted as bonuses, or bought in the Store.</li>
              <li>Points have no cash value and cannot be sold, transferred or exchanged, except through the rebate program in section 6. The only way points lead to cash is a rebate confirmed by eBay's affiliate report.</li>
              <li>Newly earned points may expire 365 days after they are earned, and newly granted bonus points may expire after 90 days. Purchased PackPTS do not expire.</li>
              <li>We may change point values, rebate rates and limits at any time. The live rate is shown on the How points work page.</li>
              <li>Points gained through cheating, bots, bugs or multiple accounts will be removed, and the account may be closed.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Marketplace and Rebates</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>The Marketplace shows live eBay listings. We do not sell the cards. You buy from eBay at its full price and under its terms. PackPTS earns a commission on eBay purchases through our links.</li>
              <li>You can apply points only to a listing shown to you inside PackPTS. Applying takes the points from your wallet right away and sets the most rebate you can earn on that listing. It does not lower the price eBay charges.</li>
              <li>Purchased points can be applied to listings and count toward rebates the same way as earned points.</li>
              <li>Your rebate is 70% of the commission eBay reports to us for that purchase, up to the value of the points you applied. PackPTS keeps the other 30%. Rebates are also limited per user per day and per week, and are funded from a reserve that we can pause when it is low.</li>
              <li>A rebate is added to your USD rebate balance only when eBay's affiliate report confirms your purchase of that item through our tracked link. If eBay reports a lower total, the rebate and the points used are reduced in proportion and unused points go back to your wallet. If you do not buy, you can cancel the apply and get your points back.</li>
              <li>Each rebate is held for 60 days after the purchase, or 45 days once eBay reports the sale as final, before it can be paid out. If the purchase is returned, canceled or reversed, the rebate is removed from your balance.</li>
              <li>You can request a payout once your available balance reaches $10. Payouts are sent by PackPTS after staff review the request.</li>
              <li>Goldin gives us no automatic confirmation of purchases, so points cannot currently be applied to Goldin listings.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. Purchase Evidence and Manual Review</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>After an apply, you can submit an order number, receipt link or note from the Redemptions page. We store it to help support match your purchase to eBay's report.</li>
              <li>Submitted evidence never adds a rebate by itself, and staff do not add rebates by hand. A rebate is credited only from eBay's affiliate report.</li>
              <li>Staff review every payout request and may deny or delay one, or cancel an apply, when activity looks fraudulent or breaks these terms. We keep an append-only record of each quote, apply, confirmation, credit, reversal and payout.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. Purchases</h2>
            <p>Point bundles and subscriptions are processed by Stripe. All purchases are final and non-refundable unless required by law. By making a purchase you also agree to Stripe's terms of service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">9. Prohibited Conduct</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Using bots, scripts or automated tools to play, earn points or trigger rebates.</li>
              <li>Exploiting bugs or glitches for unfair advantage.</li>
              <li>Harassing, threatening or abusing other users.</li>
              <li>Attempting to reverse-engineer or interfere with the Service.</li>
              <li>Using the Service for any unlawful purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">10. Intellectual Property and Card Images</h2>
            <p>PackPTS branding, code and design are owned by us. Card images and the names, logos and marks shown on them belong to their respective owners. PackPTS is not affiliated with or endorsed by any card maker, league or players association. If you believe content on PackPTS infringes your rights, see our Copyright and Takedown page at packpts.com/dmca.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">11. Disclaimers</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, the accuracy of card or listing data, or that the Service will be error-free.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">12. Limitation of Liability</h2>
            <p>To the fullest extent permitted by law, PackPTS shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service, including loss of points or rebates due to technical issues.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">13. Termination</h2>
            <p>We may suspend or terminate your account for violation of these terms. You may delete your account at any time by contacting support. On termination, your points and progress are forfeited.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">14. Changes to Terms</h2>
            <p>We may update these terms from time to time. Continued use of the Service after changes means you accept the new terms. We will post the updated terms with a new effective date.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">15. Governing Law</h2>
            <p>These terms are governed by the laws of the United States. Any disputes shall be resolved through binding arbitration rather than in court, except where prohibited by law.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">16. Contact</h2>
            <p>Questions about these terms? Contact us at: <strong>support@packpts.com</strong></p>
          </section>

        </div>
      </div>
    </div>
  );
}
