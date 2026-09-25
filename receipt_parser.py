"""
Local receipt OCR + parsing — no external API, runs entirely on-device.

Stage 1: macOS Vision (via the `ocrmac` package) extracts text fragments
         with bounding boxes from the receipt image.
Stage 2: fragments are reconstructed into visual lines, then parsed into
         {items, subtotal, tax, tip, total} with price/keyword heuristics.

Public entry point: parse_receipt_image(image) -> dict
    `image` may be a file path (str), raw bytes, or a PIL.Image.Image.
"""
import io
import re

# A price like 1.99, $1.99, 1,299.00, or -5.00 (refunds). Requires the
# decimal cents — the most reliable signal a token is actually a price.
# `\s?` around the decimal tolerates OCR artifacts like "8. 95".
_PRICE_RE = re.compile(r"-?\$?\s?\d{1,3}(?:,\d{3})*\s?\.\s?\d{2}\b")

# Order matters: "subtotal" is checked before "total" because "subtotal"
# also contains the substring "total". First match wins.
_KEYWORDS = [
    ("subtotal", ("subtotal", "sub total")),
    ("tax",      ("tax", "hst", "gst", "vat")),
    ("tip",      ("tip", "gratuity")),
    ("total",    ("total", "amount due", "balance due", "grand total")),
]


def _to_float(s: str) -> float:
    """'$1,299.00' -> 1299.00"""
    return float(s.replace("$", "").replace(",", "").replace(" ", ""))


def _reconstruct_lines(annotations, y_tol: float = 0.02):
    """
    Group OCR fragments into visual lines.

    `annotations` is ocrmac's output: a list of (text, confidence, bbox)
    where bbox is [x, y, w, h] normalized 0..1 with the origin at the
    BOTTOM-left (y increases upward). We sort top-to-bottom (y descending),
    cluster fragments whose vertical centers are within `y_tol`, then order
    each line left-to-right by x.
    """
    frags = []
    for text, _conf, (x, y, w, h) in annotations:
        frags.append((y + h / 2.0, x, text))  # (center_y, x, text)
    frags.sort(key=lambda f: (-f[0], f[1]))

    lines = []
    for cy, x, text in frags:
        if lines and abs(lines[-1]["cy"] - cy) <= y_tol:
            lines[-1]["parts"].append((x, text))
        else:
            lines.append({"cy": cy, "parts": [(x, text)]})

    result = []
    for ln in lines:
        ln["parts"].sort(key=lambda p: p[0])
        text = " ".join(p[1] for p in ln["parts"])
        result.append(re.sub(r"\s{2,}", " ", text).strip())
    return result


def parse_lines(lines):
    """Turn reconstructed text lines into the receipt structure."""
    items = []
    fields = {"subtotal": None, "tax": None, "tip": None, "total": None}

    for line in lines:
        prices = _PRICE_RE.findall(line)
        if not prices:
            continue
        price = _to_float(prices[-1])  # the amount is the rightmost price
        low = line.lower()

        matched = None
        for field, kws in _KEYWORDS:
            if any(kw in low for kw in kws):
                matched = field
                break

        if matched:
            fields[matched] = price
        else:
            name = _PRICE_RE.sub("", line).strip(" .\t-•")
            name = re.sub(r"\s{2,}", " ", name).strip()
            if name:
                items.append({"name": name, "price": price})

    return {"items": items, **fields}


def parse_receipt_image(image):
    """
    OCR a receipt image and return {items, subtotal, tax, tip, total}.

    `image` may be a path (str), raw bytes, or a PIL.Image.Image.
    Raises RuntimeError with a friendly message if OCR is unavailable.
    """
    try:
        from ocrmac import ocrmac
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "OCR engine not installed. Run: pip install ocrmac"
        ) from e

    if isinstance(image, bytes):
        from PIL import Image
        image = Image.open(io.BytesIO(image)).convert("RGB")

    annotations = ocrmac.OCR(image).recognize()
    lines = _reconstruct_lines(annotations)
    return parse_lines(lines)
