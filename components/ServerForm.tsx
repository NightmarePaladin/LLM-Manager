import Link from "next/link";
import { SERVER_STATUSES, SERVER_TYPES, type Server } from "@/lib/types";

export function ServerForm({
  action,
  server,
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  server?: Server;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <form action={action} className="card space-y-5 p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input id="name" name="name" required maxLength={100} defaultValue={server?.name} className="input" placeholder="proxmox-01" />
        </div>
        <div>
          <label htmlFor="hostname" className="label">
            IP address / hostname
          </label>
          <input id="hostname" name="hostname" required maxLength={255} defaultValue={server?.hostname} className="input" placeholder="192.168.1.10" />
        </div>
        <div>
          <label htmlFor="os" className="label">
            Operating system
          </label>
          <input id="os" name="os" maxLength={100} defaultValue={server?.os ?? ""} className="input" placeholder="Ubuntu 24.04" />
        </div>
        <div>
          <label htmlFor="type" className="label">
            Type
          </label>
          <select id="type" name="type" defaultValue={server?.type ?? "other"} className="input capitalize">
            {SERVER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">
            Status
          </label>
          <select id="status" name="status" defaultValue={server?.status ?? "unknown"} className="input capitalize">
            {SERVER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="description" className="label">
          Description
        </label>
        <textarea id="description" name="description" rows={4} maxLength={1000} defaultValue={server?.description ?? ""} className="input resize-y" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
        <Link href={cancelHref} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
