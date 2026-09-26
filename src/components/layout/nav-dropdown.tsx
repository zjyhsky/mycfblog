import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NavOption } from "@/components/layout/layout-props";
import { cn } from "@/lib/utils";
import { PublicNavLink } from "./public-nav-link";

/**
 * Desktop navigation entry. Renders a plain link when the entry has no
 * children, otherwise a trigger button that reveals a dropdown panel on
 * hover, focus or click.
 */
export function NavDropdown({
  option,
  className,
  activeClassName,
}: {
  option: NavOption;
  className?: string;
  activeClassName?: string;
}) {
  const children = option.children ?? [];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (children.length === 0) {
    return (
      <PublicNavLink
        option={option}
        className={className}
        activeClassName={activeClassName}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className="nav-dropdown"
      onMouseEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setOpen(false), 140);
      }}
      onFocusCapture={() => setOpen(true)}
    >
      <button
        type="button"
        className={cn(className, "nav-dropdown-trigger")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{option.label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={cn("nav-dropdown-caret", open && "is-open")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="nav-dropdown-panel" role="menu">
          {option.href ? (
            <a
              href={option.href}
              className="nav-dropdown-item nav-dropdown-all"
              role="menuitem"
              {...(option.external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              <span className="nav-dropdown-label truncate">查看全部</span>
            </a>
          ) : null}
          {children.map((child) => (
            <a
              key={child.id}
              href={child.href}
              className="nav-dropdown-item"
              role="menuitem"
              {...(child.external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              <span className="nav-dropdown-item-main">
                <span className="nav-dropdown-label truncate">
                  {child.label}
                </span>
                {child.desc ? (
                  <span className="nav-dropdown-desc">{child.desc}</span>
                ) : null}
              </span>
              {child.external ? (
                <ExternalLink size={12} className="shrink-0 opacity-60" />
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
