import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    // Force IPv4 - Railway servers may not have IPv6 connectivity to Supabase
    ...({ family: 4 } as object),
  } as pg.PoolConfig);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
