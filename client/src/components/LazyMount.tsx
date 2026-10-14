import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders children once the placeholder is near the viewport. Used to keep
 * below-the-fold /sets covers from all requesting at once on page load.
 */
export function LazyMount({
  children,
  minHeight,
  eager = false,
  rootMargin = "400px 0px",
}: {
  children: ReactNode;
  minHeight: number;
  eager?: boolean;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  if (visible) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" data-testid="lazy-cover-placeholder" />;
}
