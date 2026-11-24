// Minimal .xlsx reader (first worksheet, values only). No dependencies: a .xlsx is a zip of XML files.
import zlib from "node:zlib";
import { decodeEntities } from "./util.mjs";

export function unzip(buf) {
  // Find the end-of-central-directory record, then walk the central directory.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nlen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    off += 46 + nlen + xlen + clen;
  }
  return files;
}

const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function sheetNames(buf) {
  const wb = unzip(buf)["xl/workbook.xml"]?.toString("utf8") || "";
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => decodeEntities(m[1]));
}

// readXlsx(buf) reads the first sheet; readXlsx(buf, "Sheet name") reads that sheet.
export function readXlsx(buf, wanted) {
  const files = unzip(buf);
  const text = n => files[n] ? files[n].toString("utf8") : "";
  if (wanted) {
    const wb = text("xl/workbook.xml"), rels = text("xl/_rels/workbook.xml.rels");
    const sheet = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find(m => decodeEntities(m[1]) === wanted);
    if (!sheet) throw new Error(`sheet "${wanted}" not found`);
    const target = new RegExp(`Id="${sheet[2]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${sheet[2]}"`).exec(rels);
    const path = (target[1] || target[2]).replace(/^\/?(xl\/)?/, "xl/");
    files.__sheet = path;
  }
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  const sheetName = files.__sheet || Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const rows = [];
  for (const r of text(sheetName).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
      if (type === "s") v = shared[+v] ?? "";
      else v = decodeEntities(v);
      // A cell holding only =HYPERLINK("url", "label") with no cached value: return the url.
      if (!v) { const f = /<f>([\s\S]*?)<\/f>/.exec(body)?.[1]; const h = f && /HYPERLINK\(\s*"([^"]+)"/i.exec(decodeEntities(f)); if (h) v = h[1]; }
      row[ref ? colIndex(ref) : row.length] = v.trim();
    }
    rows.push(Array.from(row, x => x ?? ""));
  }
  return rows;
}
