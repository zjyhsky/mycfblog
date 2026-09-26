import { orpc } from "@/lib/orpc";

/** 轮询间隔：任务完成后组件会清空 taskId，查询随之停用 */
const PROGRESS_POLL_MS = 2000;

export function exportProgressQuery(taskId: string | null) {
  return orpc.importExport.exportProgress.queryOptions({
    input: { taskId: taskId ?? "" },
    enabled: Boolean(taskId),
    refetchInterval: PROGRESS_POLL_MS,
  });
}

export function importProgressQuery(taskId: string | null) {
  return orpc.importExport.importProgress.queryOptions({
    input: { taskId: taskId ?? "" },
    enabled: Boolean(taskId),
    refetchInterval: PROGRESS_POLL_MS,
  });
}
