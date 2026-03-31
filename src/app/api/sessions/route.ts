import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, scope } = body;

  if (!clientId || !scope) {
    return NextResponse.json({ error: "clientId and scope are required" }, { status: 400 });
  }

  const session = await prisma.researchSession.create({
    data: { clientId, scope, status: "idle" },
  });

  return NextResponse.json(session, { status: 201 });
}
