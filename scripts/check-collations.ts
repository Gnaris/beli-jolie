import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; TABLE_COLLATION: string; ENGINE: string }>>(
    `SELECT TABLE_NAME, TABLE_COLLATION, ENGINE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'beli_jolie'
     AND TABLE_NAME IN ('Tenant', 'TenantDomain', 'User', 'Product', 'Order', 'CompanyInfo', 'LoginAttempt', 'PasswordResetToken', 'LoginOtp', 'AccountLockout')
     ORDER BY TABLE_NAME`
  );
  console.table(rows);

  const cols = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; COLUMN_NAME: string; COLLATION_NAME: string; DATA_TYPE: string; CHARACTER_SET_NAME: string }>>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME, DATA_TYPE, CHARACTER_SET_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'beli_jolie'
     AND ((TABLE_NAME = 'Tenant' AND COLUMN_NAME = 'id')
       OR (TABLE_NAME = 'LoginAttempt' AND COLUMN_NAME IN ('id', 'email', 'ip'))
       OR (TABLE_NAME = 'User' AND COLUMN_NAME IN ('id', 'tenantId'))
     )`
  );
  console.table(cols);
}
main().finally(() => prisma.$disconnect());
