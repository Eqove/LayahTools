/** Tool search: everyday words find the right tool. */
import { searchTools, TOP_TOOLS } from "../src/lib/capabilities/groups";
import { CAPABILITY_REGISTRY } from "../src/lib/capabilities/registry";

let failed = 0;
const first = (q: string) => searchTools(q)[0]?.id;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); if (!ok) failed++; };

for (const [q, id] of [["sign", "pdf.sign"], ["smaller", "pdf.compress"], ["jpg", "pdf.pdf-to-image"], ["combine", "pdf.merge"],
  ["merge", "pdf.merge"], ["black out", "pdf.redact"], ["excel", "pdf.extract-tables"], ["turn", "pdf.rotate"], ["Edit", "pdf.edit"]] as const) {
  check(`"${q}" -> ${id}`, first(q) === id, `got ${first(q)}`);
}
check("empty query finds nothing", searchTools("  ").length === 0);
check("nonsense finds nothing", searchTools("zzqx").length === 0);
check("every start-here tool exists", TOP_TOOLS.every((t) => CAPABILITY_REGISTRY[t.id]));

console.log(failed ? `\n${failed} FAILED` : "\nALL TOOL-SEARCH CHECKS PASSED");
process.exit(failed ? 1 : 0);
