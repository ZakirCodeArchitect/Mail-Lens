import OpenAI from "openai";

import { getRequiredEnv } from "@/lib/env";

export const openai = new OpenAI({
  apiKey: getRequiredEnv("OPENAI_API_KEY"),
});
