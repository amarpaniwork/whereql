/**
 * Differential check: the shared package's parser must produce the same AST as bank-core's,
 * or the proxy and the database can disagree about what an expression means.
 */
import { parse as bankCoreParse } from '/Users/amarpanigrahy/Downloads/ittikar-files/ittikar-agent-portal/itti-bankcore-deal-deal-api/app/src/filter/FilterParser.js';
import { parse as sharedParse } from '/Users/amarpanigrahy/Downloads/ittikar-files/ittikar-agent-portal/itti-filter-dsl/dist/index.js';
import { contextStore } from '/Users/amarpanigrahy/Downloads/ittikar-files/ittikar-agent-portal/itti-bankcore-deal-deal-api/app/src/utils/ContextStore.js';

const EXPRESSIONS = [
  "status eq 'DRAFT'",
  "status ne 'DRAFT'",
  "referenceCode in ('CD-1','CD-2','CD-3')",
  "referenceCode not_in ('CD-9')",
  'amount gte -1500.50',
  "name eq 'O''Brien'",
  "createdAtIso gte '2026-01-01T00:00:00Z'",
  "a eq '1' and b eq '2'",
  "a eq '1' or b eq '2'",
  "(a eq '1' or b eq '2') and c eq '3'",
  "a eq '1' or b eq '2' and c eq '3'",
  "dealName contains 'capital'",
  "id in (1,2,3)",
  "(countryAlpha3 ne 'GBR' or assetClass ne 'PRIVATE_EQUITY') or referenceCode in ('CD-1')",
];

const REFUSALS = ["a in ()", "a in ('x'", 'a in (b)', 'a eq', "eq 'x'", '', "a eq 'x' extra"];

const ctx = {
  correlationId: 'c',
  trackingId: 't',
  httpMethod: 'GET',
  url: '/x',
  os: 'o',
  host: 'h',
  country: 'c',
  platform: 'p',
  application: 'a',
};

let ok = 0;
let bad = 0;

void contextStore.run(ctx as never, () => {
  for (const expr of EXPRESSIONS) {
    const a = JSON.stringify(bankCoreParse(expr));
    const b = JSON.stringify(sharedParse(expr));
    if (a === b) {
      ok += 1;
    } else {
      bad += 1;
      console.log(`MISMATCH  ${expr}\n  bank-core: ${a}\n  shared   : ${b}`);
    }
  }

  for (const expr of REFUSALS) {
    const threwA = ((): boolean => {
      try {
        bankCoreParse(expr);
        return false;
      } catch {
        return true;
      }
    })();
    const threwB = ((): boolean => {
      try {
        sharedParse(expr);
        return false;
      } catch {
        return true;
      }
    })();
    if (threwA === threwB && threwA) {
      ok += 1;
    } else {
      bad += 1;
      console.log(`REFUSAL MISMATCH  ${JSON.stringify(expr)}  bank-core threw=${threwA} shared threw=${threwB}`);
    }
  }

  console.log(`\n${ok} agreed, ${bad} diverged`);
  process.exit(bad === 0 ? 0 : 1);
});
