import { isDefinedError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type {
  ImportReport,
  ImportWarning,
  TaskState,
} from "@/features/import-export/import-export.schema";
import {
  exportProgressQuery,
  importProgressQuery,
} from "@/features/import-export/queries";
import { orpcClient } from "@/lib/orpc";
import { m } from "@/paraglide/messages";

const IMPORT_ACCEPT = ".zip,.md";
/** 结果面板里每类最多列出的条数 */
const REPORT_ITEM_LIMIT = 5;

/** 多个 .md 先在浏览器侧打成一个 zip，服务端只处理单文件上传 */
async function packMarkdownFiles(files: Array<File>): Promise<File> {
  const { strToU8, zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};

  for (const file of files) {
    entries[file.name] = strToU8(await file.text());
  }

  return new File([zipSync(entries, { level: 6 })], "markdown-import.zip", {
    type: "application/zip",
  });
}

function startErrorMessage(error: unknown): string {
  if (isDefinedError(error)) {
    switch ((error as { code: string }).code) {
      case "QUEUE_UNAVAILABLE":
        return m.settings_backup_error_queue();
      case "FILE_TOO_LARGE":
        return m.settings_backup_error_too_large();
      case "INVALID_ARCHIVE":
        return m.settings_backup_error_archive();
      case "UPLOAD_FAILED":
        return m.settings_backup_error_upload();
      default:
        return m.settings_backup_error_unknown();
    }
  }
  return m.settings_backup_error_unknown();
}

function warningText(warning: ImportWarning): string {
  const title = warning.title ?? "";
  const detail = warning.detail ?? "";

  switch (warning.code) {
    case "MISSING_IMAGE":
      return m.settings_backup_warn_missing_image({ key: detail || title });
    case "EMPTY":
      return m.settings_backup_warn_empty();
    case "SITE_CONFIG_BACKUP_FAILED":
      return m.settings_backup_warn_site_config({ detail });
    case "SLUG_ALREADY_EXISTS":
      return m.settings_backup_warn_slug_exists({ title });
    case "CONTENT_JSON_INVALID":
      return m.settings_backup_warn_content_json({ title });
    case "MARKDOWN_CONVERT_FAILED":
      return m.settings_backup_warn_markdown_failed({ title, detail });
    case "IMAGE_MISSING":
      return m.settings_backup_warn_md_image_missing({ title, detail });
    case "IMAGE_UPLOAD_FAILED":
      return m.settings_backup_warn_md_image_failed({ title, detail });
    case "COVER_MISSING":
      return m.settings_backup_warn_cover_missing({ title, detail });
    case "COVER_SKIPPED":
      return m.settings_backup_warn_cover_skipped({ title });
    case "FUTURE_DATE_CLAMPED":
      return m.settings_backup_warn_future_date({ title });
    case "PUBLISH_FAILED":
      return m.settings_backup_warn_publish_failed({ title, detail });
    case "COMMENT_POST_MISSING":
      return m.settings_backup_warn_comment_post_missing({ detail });
    case "COMMENT_RESTORE_FAILED":
      return m.settings_backup_warn_comment_failed({ detail });
    case "IMPORT_ZIP_MISSING":
      return m.settings_backup_warn_zip_missing();
    case "IMPORT_EMPTY":
      return m.settings_backup_warn_empty();
    case "INVALID_METADATA":
      return m.settings_backup_warn_invalid_metadata({ title });
    default:
      return detail ? `${warning.code}: ${detail}` : warning.code;
  }
}

function ImportReportPanel({ report }: { report: ImportReport }) {
  const { counts, posts, failed, warnings } = report;
  const remainingPosts = posts.length - REPORT_ITEM_LIMIT;
  const remainingWarnings = warnings.length - REPORT_ITEM_LIMIT;

  return (
    <div className="settings-backup-report">
      <p className="settings-backup-report-title">
        {m.settings_backup_import_result_title()}
      </p>
      <ul className="settings-backup-report-stats">
        <li>{m.settings_backup_import_result_created({ count: counts.created })}</li>
        {counts.skipped > 0 && (
          <li>
            {m.settings_backup_import_result_skipped({ count: counts.skipped })}
          </li>
        )}
        {counts.tags > 0 && (
          <li>{m.settings_backup_import_result_tags({ count: counts.tags })}</li>
        )}
        {counts.categories > 0 && (
          <li>
            {m.settings_backup_import_result_categories({ count: counts.categories })}
          </li>
        )}
        {counts.media > 0 && (
          <li>{m.settings_backup_import_result_media({ count: counts.media })}</li>
        )}
        {counts.comments > 0 && (
          <li>
            {m.settings_backup_import_result_comments({ count: counts.comments })}
          </li>
        )}
      </ul>

      {posts.length > 0 && (
        <>
          <p className="settings-backup-report-group" data-tone="ok">
            <CheckCircle2 size={13} strokeWidth={2.5} aria-hidden="true" />
            {m.settings_backup_import_created_title({ count: posts.length })}
          </p>
          <ul className="settings-backup-report-list">
            {posts.slice(0, REPORT_ITEM_LIMIT).map((post) => (
              <li key={`${post.slug}-${post.title}`}>
                {post.title}
                <span className="settings-backup-report-slug">/{post.slug}</span>
              </li>
            ))}
            {remainingPosts > 0 && (
              <li className="settings-backup-report-more">
                {m.settings_backup_import_result_others({ count: remainingPosts })}
              </li>
            )}
          </ul>
        </>
      )}

      {failed.length > 0 && (
        <>
          <p className="settings-backup-report-group" data-tone="error">
            <XCircle size={13} strokeWidth={2.5} aria-hidden="true" />
            {m.settings_backup_import_failed_title({ count: failed.length })}
          </p>
          <ul className="settings-backup-report-list">
            {failed.map((item) => (
              <li key={`${item.title}-${item.reason}`}>
                {item.title}
                <span className="settings-backup-report-reason">{item.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <>
          <p className="settings-backup-report-group" data-tone="warning">
            <AlertTriangle size={13} strokeWidth={2.5} aria-hidden="true" />
            {m.settings_backup_import_warnings_title({ count: warnings.length })}
          </p>
          <ul className="settings-backup-report-list">
            {warnings.slice(0, REPORT_ITEM_LIMIT).map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warningText(warning)}</li>
            ))}
            {remainingWarnings > 0 && (
              <li className="settings-backup-report-more">
                {m.settings_backup_import_result_others({ count: remainingWarnings })}
              </li>
            )}
          </ul>
        </>
      )}

      <p className="settings-muted">{m.settings_backup_import_result_cache_hint()}</p>
    </div>
  );
}

export function BackupRestoreSection() {
  // --- 导出 ---
  const [exportTaskId, setExportTaskId] = useState<string | null>(null);
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);
  const exportQuery = useQuery(exportProgressQuery(exportTaskId));
  const exportSnapshot = exportQuery.data;

  const startExportMutation = useMutation({
    mutationFn: () => orpcClient.importExport.startExport({}),
    onSuccess: (result) => {
      setDownloadTaskId(null);
      setExportTaskId(result.taskId);
      toast.info(m.settings_backup_export_toast_start(), {
        description: m.settings_backup_export_toast_start_desc(),
      });
    },
    onError: (error) => {
      toast.error(m.settings_backup_export_toast_error(), {
        description: startErrorMessage(error),
      });
    },
  });

  useEffect(() => {
    if (!exportTaskId || !exportSnapshot || exportSnapshot.state !== "ok") return;
    const task = exportSnapshot.task;

    if (task.status === "completed") {
      setDownloadTaskId(exportTaskId);
      setExportTaskId(null);
      toast.success(m.settings_backup_export_toast_done(), {
        description: m.settings_backup_export_done({ total: task.total }),
        action: {
          label: m.settings_backup_export_download(),
          onClick: () =>
            window.open(`/api/export/${exportTaskId}`, "_blank", "noopener"),
        },
      });
      return;
    }

    if (task.status === "failed") {
      setExportTaskId(null);
      toast.error(m.settings_backup_export_toast_failed(), {
        description: m.settings_backup_export_failed(),
      });
    }
  }, [exportSnapshot, exportTaskId]);

  // --- 导入 ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importTaskId, setImportTaskId] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const importQuery = useQuery(importProgressQuery(importTaskId));
  const importSnapshot = importQuery.data;

  const uploadMutation = useMutation({
    mutationFn: async (files: Array<File>) => {
      const archive =
        files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")
          ? files[0]
          : await packMarkdownFiles(files);
      return orpcClient.importExport.startImport({ file: archive });
    },
    onSuccess: (result) => {
      setImportReport(null);
      setImportTaskId(result.taskId);
    },
    onError: (error) => {
      toast.error(m.settings_backup_import_toast_error(), {
        description: startErrorMessage(error),
      });
    },
  });

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    uploadMutation.mutate(files);
  };

  useEffect(() => {
    if (!importTaskId || !importSnapshot || importSnapshot.state !== "ok") return;
    const task: TaskState = importSnapshot.task;

    if (task.status === "completed") {
      setImportTaskId(null);
      setImportReport(task.report ?? null);
      toast.success(m.settings_backup_import_toast_done(), {
        description: task.report
          ? m.settings_backup_import_result_created({
              count: task.report.counts.created,
            })
          : undefined,
      });
      return;
    }

    if (task.status === "failed") {
      setImportTaskId(null);
      toast.error(m.settings_backup_import_toast_failed(), {
        description: m.settings_backup_import_failed(),
      });
    }
  }, [importSnapshot, importTaskId]);

  const exportTask =
    exportSnapshot && exportSnapshot.state === "ok" ? exportSnapshot.task : null;
  const importTask =
    importSnapshot && importSnapshot.state === "ok" ? importSnapshot.task : null;

  const exportStatus = (() => {
    if (startExportMutation.isPending) return m.settings_backup_export_status_queued();
    if (!exportTask) return null;
    if (exportTask.status === "pending") return m.settings_backup_export_status_queued();
    if (exportTask.status === "processing")
      return m.settings_backup_export_status_running({
        completed: exportTask.completed,
        total: exportTask.total,
        current: exportTask.current,
      });
    return null;
  })();

  const importStatus = (() => {
    if (uploadMutation.isPending) return m.settings_backup_import_status_uploading();
    if (!importTask) return null;
    if (importTask.status === "pending") return m.settings_backup_import_status_queued();
    if (importTask.status === "processing")
      return m.settings_backup_import_status_running({
        completed: importTask.completed,
        total: importTask.total,
        current: importTask.current,
      });
    return null;
  })();

  const exportBusy = startExportMutation.isPending || exportTaskId !== null;
  const importBusy = uploadMutation.isPending || importTaskId !== null;

  return (
    <>
      <div className="flex items-center gap-3 py-4 border-b border-(--fuwari-input-border)">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium fuwari-text-90">
            {m.settings_backup_export_title()}
          </p>
          <p className="text-xs fuwari-text-50">{m.settings_backup_export_desc()}</p>
          {exportStatus && (
            <p role="status" className="settings-operation-result">
              {exportStatus}
            </p>
          )}
          {!exportStatus && downloadTaskId && (
            <p role="status" className="settings-operation-result">
              {m.settings_backup_export_done({ total: exportTask?.total ?? 0 })}{" "}
              <a
                href={`/api/export/${downloadTaskId}`}
                className="text-(--fuwari-primary)"
                target="_blank"
                rel="noopener noreferrer"
              >
                {m.settings_backup_export_download()}
              </a>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => startExportMutation.mutate()}
          disabled={exportBusy}
          className="fuwari-btn-regular rounded-xl h-9 px-3 text-sm font-medium shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {exportBusy && <Loader2 size={14} className="animate-spin" />}
          {exportBusy
            ? m.settings_backup_export_btn_loading()
            : m.settings_backup_export_btn()}
        </button>
      </div>

      <div className="flex items-center gap-3 py-4 border-b border-(--fuwari-input-border)">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium fuwari-text-90">
            {m.settings_backup_import_title()}
          </p>
          <p className="text-xs fuwari-text-50">{m.settings_backup_import_desc()}</p>
          <p className="text-xs fuwari-text-50">{m.settings_backup_import_tip()}</p>
          {importStatus && (
            <p role="status" className="settings-operation-result">
              {importStatus}
            </p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy}
          className="fuwari-btn-regular rounded-xl h-9 px-3 text-sm font-medium shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {importBusy && <Loader2 size={14} className="animate-spin" />}
          {importBusy
            ? m.settings_backup_import_btn_loading()
            : m.settings_backup_import_btn()}
        </button>
      </div>

      {importReport && <ImportReportPanel report={importReport} />}
    </>
  );
}
