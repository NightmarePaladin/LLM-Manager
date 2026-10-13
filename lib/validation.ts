import { z } from "zod";
import { SERVER_STATUSES, SERVER_TYPES } from "@/lib/types";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const serverSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
  hostname: z
    .string()
    .trim()
    .min(1, "IP address / hostname is required")
    .max(255, "Hostname must be 255 characters or fewer"),
  os: optionalText(100),
  type: z.enum(SERVER_TYPES),
  description: optionalText(1000),
  status: z.enum(SERVER_STATUSES),
});

export const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
