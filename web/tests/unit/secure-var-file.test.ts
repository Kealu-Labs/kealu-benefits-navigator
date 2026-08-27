//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { writeVarFiles, resolveSecureVarDir } from '@/lib/secure-var-file';

const base = () => mkdtempSync(path.join(tmpdir(), 'kbn-test-'));

const APPLICANT = {
  annual_income: '41200',
  medications: 'metformin, lisinopril',
  household_profile: 'single parent, 2 children',
  zip_code: '78701',
};

describe('applicant values never reach argv', () => {
  it('puts file PATHS in the args, never the values', () => {
    const h = writeVarFiles(APPLICANT, base());
    try {
      const joined = h.args.join(' ');
      // This is the whole point of the module: argv is world-readable.
      expect(joined).not.toContain('41200');
      expect(joined).not.toContain('metformin');
      expect(joined).not.toContain('single parent');
      expect(joined).not.toContain('78701');

      for (const key of Object.keys(APPLICANT)) {
        expect(joined).toContain(`${key}=@`);
      }
    } finally {
      h.cleanup();
    }
  });

  it('writes the real value into the referenced file', () => {
    const h = writeVarFiles({ annual_income: '41200' }, base());
    try {
      const arg = h.args[1];
      const file = arg.slice(arg.indexOf('@') + 1);
      expect(readFileSync(file, 'utf8')).toBe('41200');
    } finally {
      h.cleanup();
    }
  });

  it('skips empty and absent values, as the inline form did', () => {
    const h = writeVarFiles(
      { a: '1', b: '', c: null, d: undefined },
      base(),
    );
    try {
      expect(h.args).toEqual(['--var', `a=@${path.join(h.dir, 'a')}`]);
    } finally {
      h.cleanup();
    }
  });
});

describe('file permissions', () => {
  it('creates value files mode 0600 inside a 0700 directory', () => {
    const h = writeVarFiles({ annual_income: '41200' }, base());
    try {
      const arg = h.args[1];
      const file = arg.slice(arg.indexOf('@') + 1);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(h.dir).mode & 0o777).toBe(0o700);
    } finally {
      h.cleanup();
    }
  });
});

describe('cleanup actually unlinks', () => {
  it('removes every value file and the directory', () => {
    const h = writeVarFiles(APPLICANT, base());
    const files = h.args
      .filter((a) => a.includes('=@'))
      .map((a) => a.slice(a.indexOf('@') + 1));

    expect(files.length).toBe(4);
    for (const f of files) expect(existsSync(f)).toBe(true);

    h.cleanup();

    // The difference between this and leaving PII on disk is that this line passes.
    for (const f of files) expect(existsSync(f)).toBe(false);
    expect(existsSync(h.dir)).toBe(false);
  });

  it('is idempotent — it is called from three lifecycle events', () => {
    const h = writeVarFiles(APPLICANT, base());
    h.cleanup();
    expect(() => {
      h.cleanup();
      h.cleanup();
    }).not.toThrow();
  });
});

describe('directory choice', () => {
  it('prefers tmpfs where it exists, and is a real directory either way', () => {
    const dir = resolveSecureVarDir();
    expect(statSync(dir).isDirectory()).toBe(true);
    if (existsSync('/dev/shm')) expect(dir).toBe('/dev/shm');
  });

  it('isolates runs from each other', () => {
    const b = base();
    const a1 = writeVarFiles({ x: '1' }, b);
    const a2 = writeVarFiles({ x: '2' }, b);
    try {
      expect(a1.dir).not.toBe(a2.dir);
    } finally {
      a1.cleanup();
      a2.cleanup();
    }
  });
});
