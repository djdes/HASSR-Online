import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const expiredBefore=new Date(Date.now()-86400_000);
  const receiptBefore=new Date(Date.now()-30*86400_000);
  const counts=await db.$transaction([
    db.maxLinkRequest.deleteMany({where:{expiresAt:{lt:expiredBefore}}}),
    db.maxSessionHandoff.deleteMany({where:{expiresAt:{lt:expiredBefore}}}),
    db.maxInvite.deleteMany({where:{expiresAt:{lt:expiredBefore}}}),
    db.maxWebhookReceipt.deleteMany({where:{completedAt:{not:null},createdAt:{lt:receiptBefore}}}),
  ]);
  console.log(JSON.stringify({links:counts[0].count,handoffs:counts[1].count,invites:counts[2].count,receipts:counts[3].count}));
}
main().catch(()=>{console.error("MAX maintenance failed");process.exitCode=1;}).finally(()=>db.$disconnect());
