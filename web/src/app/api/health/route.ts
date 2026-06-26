//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { NextResponse } from 'next/server';
import { checkKvrVersion, checkCmsApiKey } from '@/lib/kvr-checker';

/**
 * GET /api/health
 * Returns system dependency status without exposing filesystem paths.
 */
export async function GET(_req: Request): Promise<Response> {
  const kvr = checkKvrVersion();
  const cmsKeySet = checkCmsApiKey();

  const body = {
    kvr: kvr.ok ? 'ok' : 'missing',
    cms_api_key: cmsKeySet ? 'set' : 'unset',
    version: kvr.version,
  };

  return NextResponse.json(body, { status: 200 });
}
