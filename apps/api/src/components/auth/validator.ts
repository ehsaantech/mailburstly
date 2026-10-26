import { z } from "zod";

/** Schemas live here so both controller and service can import them without a cycle. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;