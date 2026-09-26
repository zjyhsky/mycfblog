import { createFileRoute } from "@tanstack/react-router";
import {
  Section,
  StaticPageShell,
} from "@/components/layout/static-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/about")({
  component: AboutPage,
  head: () => ({
    meta: [{ title: m.page_about_title() }],
  }),
});

function AboutPage() {
  return (
    <StaticPageShell
      title={m.page_about_title()}
      lead={m.page_about_intro()}
    >
      <Section title={m.page_about_site_title()}>
        <p>{m.page_about_site_body()}</p>
      </Section>

      <Section title={m.page_about_author_title()}>
        <p>{m.page_about_author_body()}</p>
      </Section>

      <Section title={m.page_about_tech_title()}>
        <p>{m.page_about_tech_body()}</p>
      </Section>
    </StaticPageShell>
  );
}
