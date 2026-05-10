"""Minimal dependency-free PDF generator for walk sheets.

Produces a single-page PDF with one Helvetica text block. Sufficient for
short lists; for hundreds of entries the text overflows the page (acceptable
for the simplified server — paginate later if needed).
"""
from datetime import datetime, timezone


def _escape(s):
    # Built-in PDF Helvetica only covers WinAnsi/Latin-1. Drop characters
    # outside that range so the file stays valid; loud unicode loss is
    # better than a 500.
    s = s.encode("latin-1", errors="replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build(rows):
    lines = ["Voter Match - Walk Sheet",
             f"Generated {datetime.now(timezone.utc).isoformat()}",
             ""]
    if not rows:
        lines.append("No confirmed matches yet.")
    else:
        for r in rows:
            name = " ".join(p for p in (r["first_name"], r["last_name"]) if p)
            addr = ", ".join(p for p in (r["address"], r["city"], r["zip"]) if p)
            lines.append(f"- {name}  ({r['party'] or 'N/A'})")
            lines.append(f"    {addr}")
            lines.append(f"    tag: {r['relationship_tag'] or '-'}  last voted: {r['last_voted'] or '-'}")
            if r["notes"]:
                lines.append(f"    notes: {r['notes']}")
            lines.append("")

    parts = ["BT /F1 12 Tf 54 770 Td 14 TL"]
    for i, line in enumerate(lines):
        if i == 0:
            parts.append(f"({_escape(line)}) Tj")
        else:
            parts.append(f"T* ({_escape(line)}) Tj")
    parts.append("ET")
    content = " ".join(parts)

    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    pdf = "%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects):
        offsets.append(len(pdf))
        pdf += f"{i + 1} 0 obj\n{obj}\nendobj\n"
    xref = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for off in offsets:
        pdf += f"{off:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return pdf.encode("latin-1")
