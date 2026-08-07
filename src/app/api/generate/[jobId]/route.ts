import { NextRequest, NextResponse } from "next/server";
import { getVideoJobStatus } from "@/lib/higgsfield";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  try {
    const status = await getVideoJobStatus(jobId);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
