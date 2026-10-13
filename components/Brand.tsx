import { Server } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
        <Server className="size-4" aria-hidden />
      </span>
      <span className="text-base font-semibold tracking-tight">Homelab</span>
    </div>
  );
}
