import { z } from "zod";

export const ConfigSchema = z.object({
  default_lat: z.number().min(-90).max(90).optional(),
  default_lon: z.number().min(-180).max(180).optional(),
  warn_threshold: z.number().positive().default(500),
  max_order_amount: z.number().positive().default(2000),
  headless: z.boolean().default(true),
  debug: z.boolean().default(false),
  slow_mo: z.number().min(0).default(0),
  playwright_mode: z.enum(["bridge", "direct"]).default("bridge"),
});

export type BlinkitConfig = z.infer<typeof ConfigSchema>;
