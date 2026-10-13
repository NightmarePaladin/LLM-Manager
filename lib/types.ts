export const SERVER_TYPES = ["physical", "vm", "container", "other"] as const;
export const SERVER_STATUSES = ["online", "offline", "unknown"] as const;

export type ServerType = (typeof SERVER_TYPES)[number];
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export type Server = {
  id: string;
  owner_id: string;
  name: string;
  hostname: string;
  os: string | null;
  type: ServerType;
  description: string | null;
  status: ServerStatus;
  created_at: string;
  updated_at: string;
};
