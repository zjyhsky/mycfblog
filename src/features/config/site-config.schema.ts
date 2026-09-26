import { z } from "zod";
import type { Messages } from "@/lib/i18n";
import {
  canonicalizeNavHref,
  isNavHref,
  NAV_CHILD_DESC_MAX,
  NAV_CHILD_LABEL_MAX,
  NAV_LINK_CHILDREN_MAX,
  NAV_LINK_LABEL_MAX,
  NAV_LINKS_MAX,
} from "./utils/nav-links";
import { SOCIAL_PLATFORM_KEYS } from "./utils/social-platforms";

const SocialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORM_KEYS),
  url: z.string(),
  icon: z.string().optional(),
  label: z.string().optional(),
});

export const FUWARI_THEME_HUE_MIN = 0;
export const FUWARI_THEME_HUE_MAX = 360;

/** AdSense publisher id, e.g. pub-1234567890123456. */
const AdsPublisherIdSchema = z
  .string()
  .trim()
  .max(48)
  .refine((value) => value === "" || /^pub-\d{6,}$/.test(value), {
    message: "Publisher id must look like pub-1234567890123456",
  });

/** Ad unit "data-ad-slot" value: a numeric id (auto ads may be left empty). */
const AdSlotIdSchema = z
  .string()
  .trim()
  .max(32)
  .refine((value) => value === "" || /^\d{5,}$/.test(value), {
    message: "Ad slot must be a numeric Google ad unit id",
  });

export const AD_SLOT_KEYS = [
  "postTop",
  "postBottom",
  "listInline",
  "sidebar",
] as const;

export type AdSlotKey = (typeof AD_SLOT_KEYS)[number];

const AdSlotsSchema = z.object({
  postTop: AdSlotIdSchema,
  postBottom: AdSlotIdSchema,
  listInline: AdSlotIdSchema,
  sidebar: AdSlotIdSchema,
});

export const AdsConfigSchema = z.object({
  enabled: z.boolean(),
  publisherId: AdsPublisherIdSchema,
  autoAds: z.boolean(),
  consentRequired: z.boolean(),
  slots: AdSlotsSchema,
});

export type AdsConfig = z.infer<typeof AdsConfigSchema>;

export const DEFAULT_ADS_CONFIG: AdsConfig = {
  enabled: false,
  publisherId: "",
  autoAds: false,
  consentRequired: true,
  slots: {
    postTop: "",
    postBottom: "",
    listInline: "",
    sidebar: "",
  },
};

/**
 * Administrator sign-in for the standalone /console page. Only the login name is
 * persisted; the password never leaves the request that creates the account.
 */
export const AdminConsoleSchema = z.object({
  username: z
    .string()
    .trim()
    .max(32)
    .refine((value) => value === "" || /^[a-zA-Z0-9._-]{3,32}$/.test(value), {
      message:
        "Login name must be 3-32 characters using letters, numbers, dot, dash or underscore",
    }),
  enabled: z.boolean(),
});

export type AdminConsole = z.infer<typeof AdminConsoleSchema>;

export const DEFAULT_ADMIN_CONSOLE: AdminConsole = {
  username: "",
  enabled: false,
};

function createSiteTextSchema(max: number) {
  return z.string().trim().max(max);
}

const NavChildLinkSchema = z.object({
  label: createSiteTextSchema(NAV_CHILD_LABEL_MAX).pipe(z.string().min(1)),
  href: z.string().trim().refine(isNavHref, {
    message: "Please enter a root-relative path or http(s) URL",
  }),
  desc: createSiteTextSchema(NAV_CHILD_DESC_MAX).optional(),
});

const NavLinkSchema = z.object({
  label: createSiteTextSchema(NAV_LINK_LABEL_MAX).pipe(z.string().min(1)),
  href: z
    .string()
    .trim()
    .refine((value) => value === "" || isNavHref(value), {
      message: "Please enter a root-relative path or http(s) URL",
    }),
  children: z.array(NavChildLinkSchema).max(NAV_LINK_CHILDREN_MAX).optional(),
});

function createNavLinksFormSchema(messages: Messages) {
  return z
    .array(
      z.object({
        label: z.string(),
        href: z.string(),
        children: z
          .array(
            z.object({
              label: z.string(),
              href: z.string(),
              desc: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .max(NAV_LINKS_MAX)
    .transform((links) =>
      links.map((link) => ({
        label: link.label.trim(),
        href: canonicalizeNavHref(link.href),
        ...(link.children?.length
          ? {
              children: link.children.map((child) => ({
                label: child.label.trim(),
                href: canonicalizeNavHref(child.href),
                desc: child.desc?.trim() || "",
              })),
            }
          : {}),
      })),
    )
    .superRefine((links, ctx) => {
      links.forEach((link, index) => {
        if (!link.label && !link.href) return;
        if (!link.label) {
          ctx.addIssue({
            code: "custom",
            message: messages.settings_site_validation_nav_label_required(),
            path: [index, "label"],
          });
        } else if (link.label.length > NAV_LINK_LABEL_MAX) {
          ctx.addIssue({
            code: "custom",
            message: messages.settings_site_validation_too_long({
              max: NAV_LINK_LABEL_MAX,
            }),
            path: [index, "label"],
          });
        }

        const children = link.children ?? [];
        if (children.length > 0) {
          children.forEach((child, childIndex) => {
            if (!child.label) {
              ctx.addIssue({
                code: "custom",
                message: messages.settings_site_validation_nav_label_required(),
                path: [index, "children", childIndex, "label"],
              });
            }
            if (!child.href || !isNavHref(child.href)) {
              ctx.addIssue({
                code: "custom",
                message: messages.settings_site_validation_invalid_nav_href(),
                path: [index, "children", childIndex, "href"],
              });
            }
          });
          return;
        }

        if (!link.href) {
          ctx.addIssue({
            code: "custom",
            message: messages.settings_site_validation_nav_href_required(),
            path: [index, "href"],
          });
        } else if (!isNavHref(link.href)) {
          ctx.addIssue({
            code: "custom",
            message: messages.settings_site_validation_invalid_nav_href(),
            path: [index, "href"],
          });
        }
      });
    });
}

function createSiteTextFormSchema(max: number, messages: Messages) {
  return z
    .string()
    .trim()
    .max(max, messages.settings_site_validation_too_long({ max }));
}

function createAssetRefSchema() {
  return z.string().refine((value) => value === "" || value.startsWith("/"), {
    message: "Please enter a root-relative path",
  });
}

function createAssetRefFormSchema(messages: Messages) {
  return z.string().refine((value) => value === "" || value.startsWith("/"), {
    message: messages.settings_site_validation_invalid_asset_ref(),
  });
}

function isExternalImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createBackgroundImageRefSchema() {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" || value.startsWith("/") || isExternalImageUrl(value),
      {
        message: "Please enter a root-relative path or http(s) URL",
      },
    );
}

function createBackgroundImageRefFormSchema(messages: Messages) {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" || value.startsWith("/") || isExternalImageUrl(value),
      {
        message:
          messages.settings_site_validation_invalid_background_image_ref(),
      },
    );
}

function createAssetPathSchema() {
  return z.string().refine((value) => value.startsWith("/"), {
    message: "Please enter a root-relative path",
  });
}

function createAssetPathFormSchema(messages: Messages) {
  return z.string().refine((value) => value.startsWith("/"), {
    message: messages.settings_site_validation_invalid_asset_path(),
  });
}

function createOptionalAssetPathSchema() {
  return z.union([createAssetPathSchema(), z.literal("")]);
}

function createOptionalAssetPathFormSchema(messages: Messages) {
  return z.union([createAssetPathFormSchema(messages), z.literal("")]);
}

function createHueSchema() {
  return z
    .number()
    .int()
    .min(FUWARI_THEME_HUE_MIN)
    .max(FUWARI_THEME_HUE_MAX, {
      message: `Value must be between ${FUWARI_THEME_HUE_MIN} and ${FUWARI_THEME_HUE_MAX}`,
    });
}

function createHueFormSchema(messages: Messages) {
  return z.number().int().min(FUWARI_THEME_HUE_MIN).max(FUWARI_THEME_HUE_MAX, {
    message: messages.settings_site_validation_hue_range(),
  });
}

function createFuwariThemeSiteConfigSchema() {
  return z.object({
    homeBg: createBackgroundImageRefSchema(),
    avatar: createAssetRefSchema(),
    primaryHue: createHueSchema(),
  });
}

function createFuwariThemeSiteConfigInputSchema() {
  return z.object({
    homeBg: createBackgroundImageRefSchema().optional(),
    avatar: createAssetRefSchema().optional(),
    primaryHue: createHueSchema().optional(),
  });
}

function createFuwariThemeSiteConfigInputFormSchema(messages: Messages) {
  return z.object({
    homeBg: createBackgroundImageRefFormSchema(messages).optional(),
    avatar: createAssetRefFormSchema(messages).optional(),
    primaryHue: createHueFormSchema(messages).optional(),
  });
}

const fuwariThemeSiteConfigSchema = createFuwariThemeSiteConfigSchema();
const fuwariThemeSiteConfigInputSchema =
  createFuwariThemeSiteConfigInputSchema();

export const FullSiteConfigSchema = z.object({
  title: createSiteTextSchema(120),
  author: createSiteTextSchema(80),
  description: createSiteTextSchema(300),
  social: z.array(SocialLinkSchema),
  navLinks: z.array(NavLinkSchema).max(NAV_LINKS_MAX),
  ads: AdsConfigSchema,
  icons: z.object({
    faviconSvg: createAssetPathSchema(),
    faviconIco: createAssetPathSchema(),
    favicon96: createAssetPathSchema(),
    appleTouchIcon: createAssetPathSchema(),
    webApp192: createAssetPathSchema(),
    webApp512: createAssetPathSchema(),
  }),
  theme: z.object({
    fuwari: fuwariThemeSiteConfigSchema,
  }),
});

export function createSiteConfigInputFormSchema(messages: Messages) {
  return z.object({
    title: createSiteTextFormSchema(120, messages).optional(),
    author: createSiteTextFormSchema(80, messages).optional(),
    description: createSiteTextFormSchema(300, messages).optional(),
    social: z.array(SocialLinkSchema).optional(),
    navLinks: createNavLinksFormSchema(messages).optional(),
    ads: AdsConfigSchema.optional(),
    icons: z
      .object({
        faviconSvg: createOptionalAssetPathFormSchema(messages).optional(),
        faviconIco: createOptionalAssetPathFormSchema(messages).optional(),
        favicon96: createOptionalAssetPathFormSchema(messages).optional(),
        appleTouchIcon: createOptionalAssetPathFormSchema(messages).optional(),
        webApp192: createOptionalAssetPathFormSchema(messages).optional(),
        webApp512: createOptionalAssetPathFormSchema(messages).optional(),
      })
      .optional(),
    theme: z
      .object({
        fuwari: createFuwariThemeSiteConfigInputFormSchema(messages).optional(),
      })
      .optional(),
  });
}

export const SiteConfigInputSchema = z.object({
  title: createSiteTextSchema(120).optional(),
  author: createSiteTextSchema(80).optional(),
  description: createSiteTextSchema(300).optional(),
  social: z.array(SocialLinkSchema).optional(),
  navLinks: z.array(NavLinkSchema).max(NAV_LINKS_MAX).optional(),
  ads: AdsConfigSchema.optional(),
  adminConsole: AdminConsoleSchema.optional(),
  icons: z
    .object({
      faviconSvg: createOptionalAssetPathSchema().optional(),
      faviconIco: createOptionalAssetPathSchema().optional(),
      favicon96: createOptionalAssetPathSchema().optional(),
      appleTouchIcon: createOptionalAssetPathSchema().optional(),
      webApp192: createOptionalAssetPathSchema().optional(),
      webApp512: createOptionalAssetPathSchema().optional(),
    })
    .optional(),
  theme: z
    .object({
      fuwari: fuwariThemeSiteConfigInputSchema.optional(),
    })
    .optional(),
});

export type SiteConfig = z.infer<typeof FullSiteConfigSchema>;
export type SiteConfigInput = z.infer<typeof SiteConfigInputSchema>;
