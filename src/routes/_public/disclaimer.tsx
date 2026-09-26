import { createFileRoute } from "@tanstack/react-router";
import {
  Section,
  StaticPageShell,
} from "@/components/layout/static-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/disclaimer")({
  component: DisclaimerPage,
  head: () => ({
    meta: [{ title: m.page_disclaimer_title() }],
  }),
});

function DisclaimerPage() {
  return (
    <StaticPageShell
      title={m.page_disclaimer_title()}
      lead={m.page_disclaimer_intro()}
    >
      <Section title={m.page_disclaimer_content_title()}>
        <p>{m.page_disclaimer_content_body()}</p>
      </Section>

      <Section title={m.page_disclaimer_affiliate_title()}>
        <p>{m.page_disclaimer_affiliate_body()}</p>
      </Section>

      <Section title={m.page_disclaimer_liability_title()}>
        <p>{m.page_disclaimer_liability_body()}</p>
      </Section>
    </StaticPageShell>
  );
}
