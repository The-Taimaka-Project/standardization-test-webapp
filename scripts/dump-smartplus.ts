import path from 'node:path';
import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve('reference', 'smartplus-report.xlsx'));
  for (const sheet of wb.worksheets) {
    console.log(`\n===== SHEET: ${sheet.name} (${sheet.rowCount}x${sheet.columnCount}) =====`);
    let r = 0;
    sheet.eachRow({ includeEmpty: true }, (row) => {
      r++;
      if (r > 80) return;
      const cells: string[] = [];
      const max = Math.min(20, sheet.columnCount || 14);
      for (let c = 1; c <= max; c++) {
        const v = row.getCell(c).value;
        let s: string;
        if (v == null) s = '';
        else if (typeof v === 'object' && v !== null && 'result' in (v as { result?: unknown })) {
          const inner = (v as { result?: unknown }).result;
          s = typeof inner === 'number' ? inner.toString() : String(inner ?? '');
        } else if (typeof v === 'number') s = v.toString();
        else s = String(v);
        cells.push(s.padEnd(14).slice(0, 14));
      }
      console.log(String(r).padStart(2), cells.join('|'));
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
