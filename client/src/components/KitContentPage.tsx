import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import coreKit from "../../../docs/seo/content/core-pages.json";

type KitCore = { path: string; h1: string; answer: string; body: string; faq: [string, string][]; links: [string, string][] };
const CORE = (coreKit as unknown as { core: KitCore[] }).core;

/** Renders a page from Design's SEO content kit, same copy as the server HTML. No player names. */
export default function KitContentPage({ path, testId }: { path: string; testId: string }) {
  const page = CORE.find((p) => p.path === path);
  if (!page) return null;
  const paras = page.body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] space-y-4" data-testid={testId}>
      <h1 className="text-3xl font-bold">{page.h1}</h1>
      <p className="text-muted-foreground">{page.answer}</p>
      {paras.map((t, i) => <p key={i} className="text-muted-foreground">{t}</p>)}
      {page.faq?.length ? <h2 className="text-xl font-semibold">Questions</h2> : null}
      {page.faq?.map(([q, a], i) => (
        <div key={i} className="space-y-1"><h3 className="font-semibold">{q}</h3><p className="text-muted-foreground">{a}</p></div>
      ))}
      <div className="flex flex-col gap-3 pt-2">
        <Link href="/daily"><Button size="lg" className="w-full min-h-11" data-testid={`${testId}-daily`}>Play the Daily 5</Button></Link>
        <Link href="/sets"><Button size="lg" variant="outline" className="w-full min-h-11" data-testid={`${testId}-sets`}>Browse sets</Button></Link>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {page.links?.filter(([, h]) => h.startsWith("/")).map(([t, h]) => <li key={h + t}><Link href={h} className="underline">{t}</Link></li>)}
      </ul>
    </div>
  );
}
