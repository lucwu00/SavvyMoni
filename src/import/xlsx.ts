/**
 * Minimal, dependency-free .xlsx reader and writer.
 *
 * Reading: walks the ZIP central directory, inflates entries with the
 * browser's built-in DecompressionStream, and extracts cell values from the
 * worksheet XML (shared strings, inline strings, numbers, booleans). No
 * formulas are evaluated, no macros are run, no external references are
 * followed: only cached cell values are read. Works offline.
 *
 * Writing: produces a valid workbook (stored ZIP entries, inline strings)
 * for the template and sample files.
 */

/** A cell as read from a workbook: text, or a number (amounts and Excel dates). */
export type Cell = string | number;
export type Sheets = Record<string, Cell[][]>;

const MAX_ENTRY_BYTES = 30_000_000; // decompressed safety limit per part

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

interface Entry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  offset: number;
}

function readCentralDirectory(b: Uint8Array): Entry[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('The workbook is damaged (bad directory).');
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as .csv and import that instead.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readEntry(b: Uint8Array, e: Entry): Promise<string> {
  if (u32(b, e.offset) !== 0x04034b50) throw new Error('The workbook is damaged (bad entry).');
  if (e.size > MAX_ENTRY_BYTES) throw new Error('The workbook is too large to open here.');
  const nameLen = u16(b, e.offset + 26);
  const extraLen = u16(b, e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = b.subarray(start, start + e.compSize);
  let data: Uint8Array;
  if (e.method === 0) data = raw;
  else if (e.method === 8) data = await inflateRaw(raw);
  else throw new Error('The workbook uses an unsupported compression method.');
  return new TextDecoder().decode(data);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? _;
  });
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function textOf(xml: string): string {
  // Concatenate all <t> runs (rich text), ignoring phonetic runs.
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of noPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[], maxRows: number): Cell[][] {
  const rows: Cell[][] = [];
  const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] ?? '';
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= maxRows) break;
    const rAttr = attr(rm[1], 'r');
    const rowIdx = rAttr ? Number(rAttr) - 1 : rows.length;
    const cells: Cell[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = attr(a, 'r');
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const t = attr(a, 't');
      const inner = cm[2] ?? '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = '';
      if (t === 's') value = v !== undefined ? shared[Number(v)] ?? '' : '';
      else if (t === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') value = '';
      else if (t === 'str') value = v !== undefined ? decodeXml(v) : '';
      else if (v !== undefined) {
        const n = Number(v);
        value = v.trim() !== '' && Number.isFinite(n) ? n : decodeXml(v);
      }
      if (idx < 1000) cells[idx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    while (rows.length < rowIdx && rows.length < maxRows) rows.push([]);
    rows[rowIdx] = cells;
  }
  return rows.map((r) => r ?? []);
}

/** Read every worksheet into rows of cell text. */
export async function readXlsx(buffer: ArrayBuffer | Uint8Array, maxRows = 20_000): Promise<Sheets> {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = readCentralDirectory(b);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]));
  const get = async (name: string) => {
    const e = byName.get(name);
    return e ? readEntry(b, e) : null;
  };
  const workbook = await get('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not an Excel workbook (.xlsx). Older .xls files must be saved as .xlsx or .csv first.');
  const rels = (await get('xl/_rels/workbook.xml.rels')) ?? '';
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sharedXml = (await get('xl/sharedStrings.xml')) ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets: Sheets = {};
  let i = 0;
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    i++;
    const name = decodeXml(attr(m[1], 'name') ?? `Sheet${i}`);
    const rid = attr(m[1], 'r:id') ?? m[1].match(/\b\w+:id="([^"]*)"/)?.[1];
    const target = (rid && relTarget.get(rid)) || `worksheets/sheet${i}.xml`;
    const xml = await get(`xl/${target}`);
    if (xml) sheets[name] = parseSheet(xml, shared, maxRows);
  }
  return sheets;
}

/** Excel stores dates as days since 1899-12-30. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoToExcelSerial(iso: string): number {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / 86_400_000) + 25569;
}

/* ----------------------------- Writer ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: string }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 names
    dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((t, a) => t + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

export interface SheetSpec {
  name: string;
  /** Cell values. `{ date: 'YYYY-MM-DD' }` is written as a real Excel date. */
  rows: Array<Array<string | number | null | { date: string }>>;
  widths?: number[];
  /**
   * Drop-down lists for whole columns (rows 2–1000). `strict: false` still
   * accepts other text, so people can type their own words.
   */
  lists?: Array<{ col: number; values: string[]; strict?: boolean }>;
}

/** Build an .xlsx file. The first row of each sheet is styled as a header. */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const sheetXml = (s: SheetSpec) => {
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = s.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            if (v === null || v === '') return '';
            const ref = `${colName(ci)}${ri + 1}`;
            const style = ri === 0 ? ' s="1"' : '';
            if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`;
            if (typeof v === 'object') return `<c r="${ref}" s="2"><v>${isoToExcelSerial(v.date)}</v></c>`;
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    const lists = s.lists?.length
      ? `<dataValidations count="${s.lists.length}">${s.lists
          .map((l) => {
            const col = colName(l.col);
            const strict = l.strict ?? true;
            return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${strict ? 1 : 0}" errorStyle="${strict ? 'stop' : 'information'}" sqref="${col}2:${col}1000"><formula1>${esc(`"${l.values.join(',')}"`)}</formula1></dataValidation>`;
          })
          .join('')}</dataValidations>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData>${lists}</worksheet>`;
  };
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files);
}
