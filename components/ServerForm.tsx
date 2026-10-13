import { SERVER_STATUSES, SERVER_TYPES, type Server } from "@/lib/types";

export function ServerForm({
  action,
  server,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  server?: Server;
  submitLabel: string;
}) {
  return (
    <form action={action}>
      <p>
        <label>
          Name <input name="name" required maxLength={100} defaultValue={server?.name} />
        </label>
      </p>
      <p>
        <label>
          IP address / hostname <input name="hostname" required maxLength={255} defaultValue={server?.hostname} />
        </label>
      </p>
      <p>
        <label>
          Operating system <input name="os" maxLength={100} defaultValue={server?.os ?? ""} />
        </label>
      </p>
      <p>
        <label>
          Type{" "}
          <select name="type" defaultValue={server?.type ?? "other"}>
            {SERVER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Status{" "}
          <select name="status" defaultValue={server?.status ?? "unknown"}>
            {SERVER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Description <br />
          <textarea name="description" rows={4} maxLength={1000} defaultValue={server?.description ?? ""} />
        </label>
      </p>
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
