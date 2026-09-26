import { createFileRoute } from "@tanstack/react-router";
import {
  Section,
  StaticPageShell,
} from "@/components/layout/static-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [{ title: m.page_privacy_title() }],
  }),
});

function PrivacyPage() {
  return (
    <StaticPageShell
      title={m.page_privacy_title()}
      lead={m.page_privacy_intro()}
    >
      <Section title={m.page_privacy_info_title()}>
        <p>{m.page_privacy_info_body()}</p>
      </Section>

      <Section title={m.page_privacy_ads_title()}>
        <p>{m.page_privacy_ads_body()}</p>
      </Section>

      <Section title={m.page_privacy_cookies_title()}>
        <p>{m.page_privacy_cookies_body()}</p>
      </Section>

      <Section title={m.page_privacy_rights_title()}>
        <p>{m.page_privacy_rights_body()}</p>
      </Section>

      <Section title={m.page_privacy_contact_title()}>
        <p>{m.page_privacy_contact_body()}</p>
      </Section>
    </StaticPageShell>
  );
}
