import Link from "next/link";
import { connection } from "next/server";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  return <main><h1>Fixture page {id}</h1><Link id="next-page" prefetch={false} href={`/probe/${id}-next?kept=yes`}>Next page</Link><section>{Array.from({ length: 30 }, (_, i) => <div key={i}><Link prefetch={true} href={`/probe/prefetch-${i}`}>Prefetch {i}</Link></div>)}</section></main>;
}
