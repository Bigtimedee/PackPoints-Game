import { Link } from "wouter";
import { useEffect } from "react";

export const TAKEDOWN_EMAIL = "support@packpts.com";

/** Copyright (DMCA) and takedown policy, linked from the footer and Terms. */
export default function DmcaPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "PackPTS Copyright and Takedown Policy";
    return () => { document.title = prev; };
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Back to PackPTS</Link>
        </div>
        <h1 className="text-3xl font-bold mb-2">Copyright and Takedown Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Effective date: October 14, 2026</p>
        <div className="space-y-8 text-sm leading-7" data-testid="page-dmca">
          <section>
            <h2 className="text-lg font-semibold mb-3">Our approach</h2>
            <p>PackPTS shows images of trading cards so players can name the player. Card images, names, logos and marks belong to their owners. PackPTS is not affiliated with or endorsed by any card maker, league or players association. We respect the rights of creators and owners and respond quickly to valid requests.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-3">How to send a takedown notice</h2>
            <p>Email <a className="underline" href={`mailto:${TAKEDOWN_EMAIL}?subject=Takedown%20request`} data-testid="link-dmca-email"><strong>{TAKEDOWN_EMAIL}</strong></a> with the subject "Takedown request" and include:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Your name, address, phone number and email.</li>
              <li>The work or right you believe is infringed (copyright, trademark, or name and likeness).</li>
              <li>The PackPTS page or card you want removed. A link or the set name and card number is best.</li>
              <li>A statement that you have a good faith belief the use is not authorized by the owner, its agent or the law.</li>
              <li>A statement, under penalty of perjury, that the information in your notice is accurate and that you are the owner or authorized to act for the owner.</li>
              <li>Your physical or electronic signature.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-3">What happens next</h2>
            <p>We acknowledge notices within 2 business days. When a notice is complete, we remove or disable the card or content from play while we review it, and tell you what we did. If we need more information, we will ask.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-3">Counter notices</h2>
            <p>If content you provided was removed and you believe that was a mistake, email the same address with your contact details, the content removed, a statement under penalty of perjury that it was removed by mistake or misidentification, your consent to the jurisdiction of a federal court in your district, and your signature.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-3">Repeat infringers</h2>
            <p>We close accounts that repeatedly infringe the rights of others.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
