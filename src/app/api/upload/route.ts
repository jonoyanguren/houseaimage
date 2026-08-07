import { NextRequest, NextResponse } from "next/server";
import { saveImage } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const urls = await Promise.all(
    files.map(async (file) => {
      const relativePath = await saveImage(file);
      return `${origin}${relativePath}`;
    })
  );

  return NextResponse.json({ urls });
}
