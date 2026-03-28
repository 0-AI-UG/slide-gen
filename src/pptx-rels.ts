const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export class RelationshipManager {
  private counter = 0;
  private entries: { id: string; type: string; target: string; targetMode?: string }[] = [];

  add(type: string, target: string, targetMode?: string): string {
    const id = `rId${++this.counter}`;
    this.entries.push({ id, type, target, targetMode });
    return id;
  }

  toXml(): string {
    const rels = this.entries
      .map((e) => {
        const tm = e.targetMode ? ` TargetMode="${e.targetMode}"` : "";
        return `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"${tm}/>`;
      })
      .join("");
    return `${XML_HEADER}\n<Relationships xmlns="${RELS_NS}">${rels}</Relationships>`;
  }
}

// Common relationship type URIs
export const REL_TYPES = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  extendedProperties: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  coreProperties: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  presProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
  viewProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  tableStyles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
} as const;
