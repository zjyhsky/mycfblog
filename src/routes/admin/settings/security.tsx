import { createFileRoute } from "@tanstack/react-router";
import { SecurityPanel } from "@/features/admin-console/components/admin/security-panel";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/settings/security")({
  ssr: false,
  loader: () => ({ title: m.settings_nav_security() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
  component: SecurityPanel,
});
