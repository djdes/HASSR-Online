import { NextResponse } from "next/server";

import { loadBfsAuthorizationAssets } from "@/lib/setup-helper-play-authorization.server";
import {
  renderFunctionalCharacteristicsPdf,
  renderInstallationGuidePdf,
  renderLifecycleAndSupportPdf,
  renderUserManualPdf,
} from "@/lib/software-registry-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_RENDERERS: Record<
  string,
  {
    filename: string;
    render: typeof renderFunctionalCharacteristicsPdf;
  }
> = {
  "functional-characteristics.pdf": {
    filename: "wesetup-functional-characteristics.pdf",
    render: renderFunctionalCharacteristicsPdf,
  },
  "installation-guide.pdf": {
    filename: "wesetup-installation-and-admin-guide.pdf",
    render: renderInstallationGuidePdf,
  },
  "user-manual.pdf": {
    filename: "wesetup-user-manual.pdf",
    render: renderUserManualPdf,
  },
  "lifecycle-and-support.pdf": {
    filename: "wesetup-lifecycle-and-support.pdf",
    render: renderLifecycleAndSupportPdf,
  },
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ doc: string }> },
) {
  const { doc } = await context.params;
  const entry = DOC_RENDERERS[doc];
  if (!entry) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { seller, images } = await loadBfsAuthorizationAssets();
  const pdf = entry.render(images, seller);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${entry.filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
