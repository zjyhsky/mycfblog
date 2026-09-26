import { createFileRoute } from "@tanstack/react-router";
import {
  Section,
  StaticPageShell,
} from "@/components/layout/static-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/contact")({
  component: ContactPage,
  head: () => ({
    meta: [{ title: m.page_contact_title() }],
  }),
});

function ContactPage() {
  return (
    <StaticPageShell
      title={m.page_contact_title()}
      lead={m.page_contact_intro()}
    >
      <Section title={m.page_contact_email_title()}>
        <p>{m.page_contact_email_body()}</p>
        <a className="static-inline-link" href={`mailto:${m.page_contact_email()}`}>
          {m.page_contact_email()}
        </a>
      </Section>

      <Section title={m.page_contact_social_title()}>
        <p>{m.page_contact_social_body()}</p>
      </Section>

      <Section title={m.page_contact_note_title()}>
        <p>{m.page_contact_note_body()}</p>
      </Section>
    </StaticPageShell>
  );
}
