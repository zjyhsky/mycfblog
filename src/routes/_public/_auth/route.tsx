import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AuthLayout } from "@/components/layout/auth-layout";
import {
  emailConfiguredQuery,
  sessionQuery,
  socialProvidersQuery,
} from "@/features/auth/queries";
import { useNavigateBack } from "@/hooks/use-navigate-back";
import { CACHE_CONTROL } from "@/lib/constants";

export const Route = createFileRoute("/_public/_auth")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    const isEmailConfigured =
      await context.queryClient.fetchQuery(emailConfiguredQuery);
    const socialProviders =
      await context.queryClient.fetchQuery(socialProvidersQuery);

    if (session && !location.pathname.includes("verify-email")) {
      throw redirect({ to: "/" });
    }

    return { session, isEmailConfigured, socialProviders };
  },
  component: RouteComponent,
  headers: () => {
    return CACHE_CONTROL.private;
  },
});

function RouteComponent() {
  const navigateBack = useNavigateBack({ fallbackTo: "/" });
  return (
    <AuthLayout onBack={navigateBack}>
      <Outlet />
    </AuthLayout>
  );
}
