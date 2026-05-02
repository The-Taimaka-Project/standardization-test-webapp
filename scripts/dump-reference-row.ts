import path from 'node:path';
import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(
    path.resolve('reference', 'standardization_test_group3_results.xlsx'),
  );
  const sheet = wb.worksheets[0];
  // Inspect supervisor row (row 3) and a few others in raw form.
  for (const r of [3, 4, 5, 11]) {
    const row = sheet.getRow(r);
    console.log(`row ${r}:`);
    for (let c = 1; c <= 14; c++) {
      const cell = row.getCell(c);
      console.log(`  c${c} type=${cell.type} value=${JSON.stringify(cell.value)} text=${JSON.stringify((cell as unknown as { text?: string }).text)} numFmt=${JSON.stringify(cell.numFmt)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
