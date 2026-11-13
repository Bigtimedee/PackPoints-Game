import { useState } from "react";
import { useRoute, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  KIT_INDEX_SLUG,
  KIT_PAGE_LEAD,
  KIT_PAGE_TITLE,
  kitCaptions,
  kitPlayUrl,
  parseKitSlug,
  sanitizeShopName,
} from "@shared/partnerKit";
import { getPackptsDayKey } from "@shared/packptsDay";

type KitMeta = {
  slug: string;
  shopName: string | null;
  day: string;
  lead: string;
  captions: { feed: string; story: string; results: string; shop: string | null };
  links: { qr: string; copy: string };
  qr: { png: string; svg: string };
};

function KitImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"wait" | "on" | "off">("wait");
  if (state === "off") return null;
  return (
    <img
      src={src}
      alt={alt}
      className={state === "on" ? "mt-4 w-full h-auto rounded-md" : "hidden"}
      onLoad={() => setState("on")}
      onError={() => setState("off")}
    />
  );
}

export default function PartnerKitPage() {
  const [, params] = useRoute("/kit/:slug");
  const search = useSearch();
  const rawSlug = params?.slug ?? KIT_INDEX_SLUG;
  const slug = parseKitSlug(rawSlug);
  const shopQuery = sanitizeShopName(new URLSearchParams(search).get("shop"));
  const meta = useQuery({
    queryKey: ["/api/kit/meta", slug, shopQuery],
    enabled: Boolean(slug),
    queryFn: async (): Promise<KitMeta> => {
      const q = new URLSearchParams();
      if (shopQuery) q.set("shop", shopQuery);
      const suffix = q.toString() ? `?${q}` : "";
      const res = await fetch(`/api/kit/meta/${slug}${suffix}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  if (!slug) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10" data-testid="page-partner-kit">
        <h1 className="text-3xl font-bold">Partner kit</h1>
        <p className="mt-3 text-muted-foreground">That kit link is not valid.</p>
      </div>
    );
  }

  const day = meta.data?.day ?? getPackptsDayKey();
  const shopName = meta.data?.shopName ?? shopQuery;
  const captions = meta.data?.captions ?? kitCaptions(day, shopName);
  const copyLink = meta.data?.links.copy ?? kitPlayUrl(slug, "link");
  const qrPng = meta.data?.qr.png ?? `/api/kit/qr.png?slug=${encodeURIComponent(slug)}`;
  const qrSvg = meta.data?.qr.svg ?? `/api/kit/qr.svg?slug=${encodeURIComponent(slug)}`;
  const asset = (kind: string) => {
    const q = new URLSearchParams({ slug });
    if (shopName) q.set("shop", shopName);
    return `/api/kit/asset/${kind}?${q}`;
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12" data-testid="page-partner-kit">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{KIT_PAGE_TITLE}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{meta.data?.lead ?? KIT_PAGE_LEAD}</p>
      {captions.shop ? <p className="mt-4 text-base font-medium">{captions.shop}</p> : null}

      <CaptionBlock title="Feed caption" text={captions.feed} testId="caption-feed" />
      <KitImage src={asset("feed")} alt="Masked card" />

      <CaptionBlock title="Story" text={captions.story} testId="caption-story" />
      <KitImage src={asset("story")} alt="Masked card" />

      <CaptionBlock title="Results" text={captions.results} testId="caption-results" />
      <KitImage src={asset("results")} alt="Daily 5 results" />

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Play link</h2>
        <p className="mt-3 break-all rounded-md border bg-card px-3 py-3 font-mono text-sm" data-testid="play-link">{copyLink}</p>
        <CopyButton text={copyLink} label="Copy link" testId="copy-link" />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">QR code</h2>
        <img src={qrPng} alt="QR code" width={220} height={220} className="mt-4 h-auto w-[220px] max-w-full bg-white p-2" data-testid="qr-image" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={qrPng} download={`packpts-${slug}-qr.png`}>Download PNG</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={qrSvg} download={`packpts-${slug}-qr.svg`}>Download SVG</a>
          </Button>
        </div>
      </section>

      <KitImage src={asset("qrsheet")} alt="Printable QR sheet" />
    </div>
  );
}

function CaptionBlock({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-base leading-relaxed" data-testid={testId}>{text}</p>
      <CopyButton text={text} label="Copy caption" testId={`${testId}-copy`} />
    </section>
  );
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="mt-3"
      data-testid={testId}
      onClick={() => {
        const finish = () => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        };
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
          return;
        }
        fallbackCopy(text, finish);
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

function fallbackCopy(text: string, done: () => void) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } finally {
    area.remove();
  }
  done();
}
