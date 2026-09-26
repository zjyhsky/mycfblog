import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicLayout as SitePublicLayout } from "@/components/layout/public-layout";
import { Toaster } from "@/components/layout/toaster";
import { AdSenseRuntime } from "@/components/ads/adsense-runtime";
import { CookieConsent } from "@/components/ads/cookie-consent";
import { useLogout } from "@/features/auth/hooks/use-logout";
import { authClient } from "@/lib/auth/auth.client";
import { CACHE_CONTROL } from "@/lib/constants";
import { clientEnv } from "@/lib/env/client.env";
import { isExternalNavHref } from "@/features/config/utils/nav-links";
import { orpc } from "@/lib/orpc";
import type { NavChildOption, NavOption } from "@/components/layout/layout-props";
import { m } from "@/paraglide/messages";

/** 导航「文章」下拉里最多展示的文章数（超过可滚动），点击「查看全部」进归档页看全部 */
const NAV_POSTS_LIMIT = 30;

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
  headers: () => {
    return CACHE_CONTROL.public;
  },
  head: () => {
    const env = clientEnv();
    return {
      scripts: env.VITE_UMAMI_WEBSITE_ID
        ? [
            {
              src: "/stats.js",
              defer: true,
              "data-website-id": env.VITE_UMAMI_WEBSITE_ID,
            },
          ]
        : [],
    };
  },
});

function PublicLayout() {
  const navigate = useNavigate();
  const { siteConfig } = useRouteContext({ from: "__root__" });
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const { logout } = useLogout();

  const postsNavQuery = useQuery({
    ...orpc.posts.list.queryOptions({ input: { limit: NAV_POSTS_LIMIT } }),
    staleTime: 5 * 60 * 1000,
  });

  const postChildren: Array<NavChildOption> = useMemo(() => {
    const items = postsNavQuery.data?.items ?? [];
    return items.map((post) => ({
      id: `post-${post.slug}`,
      label: post.title,
      href: `/posts/${post.slug}`,
      external: false,
    }));
  }, [postsNavQuery.data]);

  const navOptions: Array<NavOption> = [
    { id: "home", label: m.nav_home(), href: "/", external: false },
    {
      id: "posts",
      label: m.nav_posts(),
      href: "/posts",
      external: false,
      children: postChildren,
    },
    {
      id: "friend-links",
      label: m.nav_friend_links(),
      href: "/friend-links",
      external: false,
    },
    {
      id: "about",
      label: m.nav_about(),
      href: "/about",
      external: false,
    },
    {
      id: "contact",
      label: m.nav_contact(),
      href: "/contact",
      external: false,
    },
    {
      id: "privacy",
      label: m.nav_privacy(),
      href: "/privacy",
      external: false,
    },
    {
      id: "disclaimer",
      label: m.nav_disclaimer(),
      href: "/disclaimer",
      external: false,
    },
    ...siteConfig.navLinks.map((link, index) => ({
      id: `custom-${index}`,
      label: link.label,
      href: link.href,
      external: isExternalNavHref(link.href),
      ...(link.children && link.children.length > 0
        ? {
            children: link.children.map((child, childIndex) => ({
              id: `custom-${index}-${childIndex}`,
              label: child.label,
              href: child.href,
              desc: child.desc,
              external: isExternalNavHref(child.href),
            })),
          }
        : {}),
    })),
  ];

  // Global shortcut: Cmd/Ctrl + K to navigate to search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isToggle) {
        e.preventDefault();
        navigate({ to: "/search" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <>
      <SitePublicLayout
        navOptions={navOptions}
        user={session?.user}
        isSessionLoading={isSessionPending}
        logout={logout}
      >
        <Outlet />
      </SitePublicLayout>
      <AdSenseRuntime />
      <CookieConsent />
      <Toaster />
    </>
  );
}
