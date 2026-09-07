import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const source = readFileSync('server/index.js', 'utf8');
const shared = { bank: 'Banco Villa', account_holder: 'Titular Villa', clabe: '123456789012345678' };
const pozos = { bank: 'Banco Pozos', account_holder: 'Titular Pozos', clabe: '987654321098765432' };

function harness(scoped, { legacy = false, fail = false } = {}) {
  const query = vi.fn(async (sql, args) => {
    if (args?.[0] === 'bank_info_pozos') {
      if (fail) throw new Error('database unavailable');
      return { rows: scoped === undefined ? [] : [{ value: scoped }] };
    }
    if (legacy && sql.includes('FROM settings ')) return { rows: [] };
    return { rows: [{ value: shared }] };
  });
  const context = vm.createContext({ pool: { query }, DEFAULT_BANK_INFO: {} });
  const start = source.indexOf('function digitsOnly(');
  const end = source.indexOf('const DEFAULT_POLICIES_SETTINGS', start);
  vm.runInContext(source.slice(start, end), context);
  return { query, get: code => context.getConfiguredBankInfo(undefined, code) };
}

describe('branch-specific transfer account selection', () => {
  it('keeps Villa Magna and video purchases on the existing account', async () => {
    const { get } = harness(pozos);
    expect((await get('villa-magna')).bank).toBe(shared.bank);
    expect((await get()).bank).toBe(shared.bank);
  });
  it('uses the saved Pozos account, including holder and CLABE', async () => {
    const { get, query } = harness(pozos);
    const result = await get('pozos');
    expect(result.bank).toBe(pozos.bank);
    expect(result.account_holder).toBe(pozos.account_holder);
    expect(result.clabe.replace(/\s/g, '')).toBe(pozos.clabe);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('preserves shared account before Pozos is configured (legacy=%s)', async legacy => {
    const { get } = harness(undefined, { legacy });
    expect((await get('pozos')).bank).toBe(shared.bank);
  });
  it.each([{}, null, { bank: '', clabe: '' }])('does not substitute Villa Magna for an explicitly cleared Pozos setting (%j)', async value => {
    const { get, query } = harness(value);
    expect((await get('pozos')).bank).toBe('');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('does not silently return the wrong account on a Pozos read failure', async () => {
    await expect(harness(undefined, { fail: true }).get('pozos')).rejects.toThrow('database unavailable');
  });
  it('both order creation paths resolve bank info from the validated branch', () => {
    expect(source.match(/getConfiguredBankInfo\(client, requestedBranch\.code\)/g)).toHaveLength(2);
  });
});
