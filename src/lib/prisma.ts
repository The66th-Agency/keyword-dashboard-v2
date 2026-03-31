import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; pgPool: pg.Pool };

function createPool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    // Force IPv4 - Railway servers may not have IPv6 connectivity to Supabase
    ...({ family: 4 } as object),
  } as pg.PoolConfig);
}

function createPrismaClient(pool: pg.Pool) {
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const pgPool = globalForPrisma.pgPool || createPool();
export const prisma = globalForPrisma.prisma || createPrismaClient(pgPool);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pgPool;
}
