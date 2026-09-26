import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { adminConsoleStatusQuery } from "@/features/admin-console/queries";
import { SETTINGS_FIELD_CLASS } from "@/features/config/components/admin/settings-pages";
import { orpcClient } from "@/lib/orpc";
import { m } from "@/paraglide/messages";

/**
 * Manages the standalone /console administrator sign-in: a username plus
 * password that works without any mail delivery configuration.
 */
export function SecurityPanel() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(adminConsoleStatusQuery);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const enabled = Boolean(data?.enabled);
  const configuredName = data?.username ?? "";

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: adminConsoleStatusQuery.queryKey,
    });

  const save = useMutation({
    mutationFn: () =>
      orpcClient.adminConsole.setCredentials({
        username: username.trim(),
        password,
      }),
    onSuccess: async () => {
      setPassword("");
      await invalidate();
      toast.success(m.settings_security_created());
    },
    onError: () => {
      toast.error(m.settings_security_error());
    },
  });

  const disable = useMutation({
    mutationFn: () =>
      orpcClient.adminConsole.disable({ username: configuredName }),
    onSuccess: async () => {
      setUsername("");
      await invalidate();
      toast.success(m.settings_security_disabled());
    },
    onError: () => {
      toast.error(m.settings_security_error());
    },
  });

  const canSave = username.trim().length >= 3 && password.length >= 8;
  const busy = save.isPending || disable.isPending || isPending;

  return (
    <div className="settings-panel flex flex-col gap-4">
      <section className="settings-card flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-(--fuwari-primary)" />
          <h3 className="text-sm font-medium">{m.settings_security_title()}</h3>
        </div>
        <p className="text-xs fuwari-text-50">{m.settings_security_hint()}</p>
        <p className="text-xs fuwari-text-75">
          {enabled ? m.settings_security_state_on() : m.settings_security_state_off()}
          {enabled && configuredName ? ` — ${configuredName}` : ""}
        </p>
      </section>

      <section className="settings-card flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-(--fuwari-primary)" />
          <h3 className="text-sm font-medium">{m.settings_security_save()}</h3>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs fuwari-text-50">
            {m.settings_security_username()}
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={m.settings_security_username_ph()}
            className={SETTINGS_FIELD_CLASS}
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs fuwari-text-50">
            {m.settings_security_password()}
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={m.settings_security_password_ph()}
            className={SETTINGS_FIELD_CLASS}
            autoComplete="new-password"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => save.mutate()}
            className="fuwari-btn-primary h-9 rounded-xl px-4 text-sm font-medium disabled:opacity-50"
          >
            {m.settings_security_save()}
          </button>

          {enabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => disable.mutate()}
              className="fuwari-btn-regular h-9 rounded-xl px-4 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {m.settings_security_disable()}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
