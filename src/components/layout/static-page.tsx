import type { ReactNode } from "react";

export function StaticPageShell({
  title,
  lead,
  children,
  updatedAt,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  /** 可选的最后更新时间，显示在标题下方 */
  updatedAt?: string;
}) {
  return (
    <article className="static-page fuwari-card-base fuwari-content-enter">
      <header className="static-page-head">
        <h1 className="tech-gradient-text">{title}</h1>
        {lead ? <p className="static-page-lead">{lead}</p> : null}
        {updatedAt ? (
          <p className="static-page-updated">{updatedAt}</p>
        ) : null}
      </header>
      <div className="prose-tech">{children}</div>
    </article>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="static-section">
      <h2>{title}</h2>
      <div className="static-section-body">{children}</div>
    </section>
  );
}
