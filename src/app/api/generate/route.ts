import { NextRequest, NextResponse } from "next/server";
import { createVideoJob } from "@/lib/higgsfield";
import type { GenerateVideoInput } from "@/types/higgsfield";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateVideoInput;

  if (!body.imageUrls?.length) {
    return NextResponse.json({ error: "imageUrls is required" }, { status: 400 });
  }

  try {
    const job = await createVideoJob(body);
    return NextResponse.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
