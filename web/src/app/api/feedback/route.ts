import { NextResponse } from "next/server";
import { z } from "zod";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Lightweight assistant-feedback endpoint (thumbs up/down on replies).
 * Appends one JSON line per vote to data/feedback.jsonl — a persistent QA
 * signal for later analysis (which replies disappoint users most).
 * Logging failures never surface to the user: a failed write still returns
 * {ok:true} so the chat UX is never disturbed by telemetry.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FEEDBACK_DIR = path.join(process.cwd(), "data");
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, "feedback.jsonl");

const feedbackSchema = z
  .object({
    rating: z.enum(["up", "down"]),
    question: z.string().max(500).optional(),
    reply_excerpt: z.string().max(800).optional(),
    tools: z.array(z.string().max(60)).max(10).optional(),
    fallback: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body", code: "validation_error" }, { status: 400 });
  }
  const validated = feedbackSchema.safeParse(body);
  if (!validated.success) {
    const firstIssue = validated.error.issues[0];
    const msg = firstIssue ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}` : "validation error";
    return NextResponse.json({ error: msg, code: "validation_error" }, { status: 400 });
  }

  const entry = {
    ts: new Date().toISOString(),
    ...validated.data,
  };
  try {
    await mkdir(FEEDBACK_DIR, { recursive: true });
    await appendFile(FEEDBACK_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Telemetry must never break the chat — swallow write errors.
  }
  return NextResponse.json({ ok: true });
}

/** Aggregate counts (tiny admin signal: {up, down, total}). */
export async function GET() {
  try {
    const raw = await readFile(FEEDBACK_FILE, "utf8");
    let up = 0;
    let down = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.rating === "up") up++;
        else if (j.rating === "down") down++;
      } catch {
        /* skip corrupted line */
      }
    }
    return NextResponse.json({ up, down, total: up + down });
  } catch {
    return NextResponse.json({ up: 0, down: 0, total: 0 });
  }
}
