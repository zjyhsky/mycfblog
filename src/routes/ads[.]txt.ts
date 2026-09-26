import { createFileRoute } from "@tanstack/react-router";
import { buildAdsTxt } from "@/features/ads/ads.utils";
import { resolveSiteConfig } from "@/features/config/config.resolve";
import { getSystemConfig } from "@/features/config/data/config.data";
import { getDb } from "@/lib/db";

const ADS_TXT_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

export const Route = createFileRoute("/ads.txt")({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const config = await getSystemConfig(getDb(context.env));
        const body = buildAdsTxt(resolveSiteConfig(config).ads);
        return new Response(
          body || "# No AdSense publisher configured yet.\n",
          {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": ADS_TXT_CACHE_CONTROL,
            },
          },
        );
      },
    },
  },
});
