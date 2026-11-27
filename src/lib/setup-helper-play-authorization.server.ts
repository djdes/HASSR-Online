import { readFile } from "node:fs/promises";
import path from "node:path";

import { brandSeller } from "@/lib/brand-docs/pdf-kit";
import {
  isPng,
  legalDir,
  readLegalImage,
  readPlatformRequisites,
} from "@/lib/closing-documents/requisites";
import {
  DEFAULT_BFS_SELLER,
  type LegalSignImages,
} from "@/lib/setup-helper-play-authorization";

async function readDefaultLegalPng(filename: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(path.join(legalDir(), filename));
    return isPng(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Загружает факсимиле и печать ООО «БФС» из приватного каталога `LEGAL_DIR`
 * (на проде `/var/www/wesetupru/data/legal`) и реквизиты из БД с безопасным
 * откатом на константы ООО «БФС», если база недоступна.
 */
export async function loadBfsAuthorizationAssets() {
  const requisites = await readPlatformRequisites().catch(() => null);
  const [facsimile, stamp] = await Promise.all([
    requisites?.facsimileFile
      ? readLegalImage("facsimile", requisites)
      : readDefaultLegalPng("facsimile.png"),
    requisites?.stampFile
      ? readLegalImage("stamp", requisites)
      : readDefaultLegalPng("stamp.png"),
  ]);

  const images: LegalSignImages = { facsimile, stamp };
  const seller =
    requisites && requisites.inn
      ? brandSeller({ ...requisites, site: "wesetup.ru" })
      : DEFAULT_BFS_SELLER;

  return { seller, images };
}
