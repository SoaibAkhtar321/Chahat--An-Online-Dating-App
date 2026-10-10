import { Phone, Header } from "./Phone";

/** Placeholder legal text. Must be replaced by counsel-reviewed documents before launch. */
export function LegalPage({ title, sections }: { title: string; sections: [string, string][] }) {
  return (
    <Phone>
      <Header title={title} back="/settings" />
      <article className="space-y-5 p-5 text-sm leading-relaxed">
        <p className="rounded-xl border-2 border-dashed border-destructive/50 bg-card p-3 font-semibold">
          DRAFT PLACEHOLDER FOR LEGAL REVIEW. Not a final or legally reviewed document. Milo has not
          certified compliance with any law.
        </p>
        {sections.map(([h, b], i) => (
          <section key={h}>
            <h2 className="font-sans text-base font-bold">
              {i + 1}. {h}
            </h2>
            <p className="mt-1 text-muted-foreground">{b}</p>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          Last updated: draft. Contact details, the company name and the governing law will be added
          after legal review.
        </p>
      </article>
    </Phone>
  );
}
