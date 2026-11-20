import type { ReactNode } from "react";

import { BotAvatar } from "../../dropwave/BotAvatar";

export function StandalonePage({ children }: { readonly children: ReactNode }) {
  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div
      className="dark flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both px-4 py-10 text-[#f2f1f6] sm:px-6"
      style={{
        colorScheme: "dark",
        background:
          'linear-gradient(rgb(8 9 14 / 32%), rgb(8 9 14 / 42%)), url("/dropwave/mountains.jpg") center / cover no-repeat #141520',
      }}
    >
      <section
        className="w-full max-w-xl rounded-2xl border p-6"
        style={{
          borderColor: "rgb(255 255 255 / 12%)",
          background:
            "linear-gradient(180deg, rgb(255 255 255 / 6%), rgb(255 255 255 / 2%) 45%, rgb(0 0 0 / 6%)), rgb(16 17 26 / 74%)",
          backdropFilter: "blur(26px) saturate(1.4)",
          WebkitBackdropFilter: "blur(26px) saturate(1.4)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 12%), 0 18px 48px rgb(0 0 0 / 45%)",
        }}
      >
        {children}
      </section>
    </div>
  );
}

export function StandalonePageHeader({
  context,
  title,
  description,
}: {
  readonly context?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product brand name */}
        <span className="flex items-center gap-2.5" role="img" aria-label="Dropwave">
          <BotAvatar size={26} seed={0} />
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
          <span className="text-base font-semibold tracking-tight text-[#f2f1f6]">Dropwave</span>
        </span>
        {context ? <span className="text-sm">{context}</span> : null}
      </div>
      <h1 className="mt-6 text-xl leading-tight font-semibold text-[#f2f1f6]">{title}</h1>
      <p className="mt-2 text-sm text-[#b8b6c7]">{description}</p>
    </>
  );
}
