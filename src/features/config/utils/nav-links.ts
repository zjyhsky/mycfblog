export const NAV_LINKS_MAX = 6;
export const NAV_LINK_LABEL_MAX = 20;
export const NAV_LINK_CHILDREN_MAX = 8;
export const NAV_CHILD_LABEL_MAX = 24;
export const NAV_CHILD_DESC_MAX = 60;

export type NavChildLink = {
  label: string;
  href: string;
  desc?: string;
};

export type NavLink = {
  label: string;
  href: string;
  children?: Array<NavChildLink>;
};

export function isExternalNavHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isInternalNavHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function isNavHref(href: string): boolean {
  return isInternalNavHref(href) || isExternalNavHref(href);
}

function looksLikeHost(value: string): boolean {
  if (!value || value.includes(" ") || value.includes("://")) return false;
  if (value.startsWith(".") || value.startsWith("/")) return false;
  if (/^localhost([:/?#]|$)/i.test(value)) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+([:/?#]|$)/i.test(
    value,
  );
}

export function canonicalizeNavHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  if (isInternalNavHref(trimmed) || isExternalNavHref(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (looksLikeHost(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function normalizeNavChildren(value: unknown): Array<NavChildLink> {
  if (!Array.isArray(value)) return [];

  const children: Array<NavChildLink> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      label?: unknown;
      href?: unknown;
      desc?: unknown;
    };
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const href = canonicalizeNavHref(
      typeof record.href === "string" ? record.href : "",
    );
    if (!label || !isNavHref(href)) continue;
    const desc =
      typeof record.desc === "string" ? record.desc.trim() : undefined;
    children.push({
      label: label.slice(0, NAV_CHILD_LABEL_MAX),
      href,
      ...(desc ? { desc: desc.slice(0, NAV_CHILD_DESC_MAX) } : {}),
    });
    if (children.length >= NAV_LINK_CHILDREN_MAX) break;
  }
  return children;
}

export function normalizeNavLinks(value: unknown): NavLink[] {
  if (!Array.isArray(value)) return [];

  const links: NavLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      label?: unknown;
      href?: unknown;
      children?: unknown;
    };
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const href = canonicalizeNavHref(
      typeof record.href === "string" ? record.href : "",
    );
    const children = normalizeNavChildren(record.children);
    // A parent entry may act purely as a dropdown trigger, so an empty href is
    // valid as long as it carries at least one child.
    if (!label) continue;
    if (!isNavHref(href) && children.length === 0) continue;
    links.push({
      label: label.slice(0, NAV_LINK_LABEL_MAX),
      href: isNavHref(href) ? href : "",
      ...(children.length > 0 ? { children } : {}),
    });
    if (links.length >= NAV_LINKS_MAX) break;
  }
  return links;
}
