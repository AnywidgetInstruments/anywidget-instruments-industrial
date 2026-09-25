"""SVG sanitizer for user supplied skins (STYLE-006).

Removes scripts, ``foreignObject``, event handler attributes and any reference
to an external resource, so that a skin can neither run code nor fetch data
from the network (GEN-005).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_FORBIDDEN_TAGS = {"script", "foreignobject", "iframe", "object", "embed", "audio", "video"}
_URL_IN_CSS = re.compile(r"url\(\s*['\"]?\s*(?!#)[^)]*\)", re.IGNORECASE)
_IMPORT_IN_CSS = re.compile(r"@import[^;]*;?", re.IGNORECASE)

ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)
# keep the prefixes of vector editor metadata (SvgPanel roles live in inkscape:label)
ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")
ET.register_namespace("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1].lower()


def _is_safe_ref(value: str) -> bool:
    v = value.strip().lower()
    # internal fragment references and embedded raster images only
    return v.startswith("#") or v.startswith("data:image/png") or v.startswith("data:image/jpeg")


def _clean(elem: ET.Element) -> None:
    for child in list(elem):
        if _local(child.tag) in _FORBIDDEN_TAGS:
            elem.remove(child)
        else:
            _clean(child)
    for attr in list(elem.attrib):
        name = _local(attr)
        value = elem.attrib[attr]
        if name.startswith("on") or (name in {"href", "src"} and not _is_safe_ref(value)):
            del elem.attrib[attr]
        elif name == "style" or "url(" in value.lower():
            elem.attrib[attr] = _URL_IN_CSS.sub("none", value)
    if _local(elem.tag) == "style" and elem.text:
        elem.text = _URL_IN_CSS.sub("none", _IMPORT_IN_CSS.sub("", elem.text))


def sanitize_svg(source: str) -> str:
    """Return a sanitized copy of the SVG document ``source``.

    Raises ``ValueError`` if ``source`` is not well-formed SVG.
    """
    if "<!DOCTYPE" in source.upper() or "<!ENTITY" in source.upper():
        raise ValueError("SVG skins must not contain DOCTYPE or ENTITY declarations")
    try:
        root = ET.fromstring(source)
    except ET.ParseError as exc:
        raise ValueError(f"invalid SVG skin: {exc}") from exc
    if _local(root.tag) != "svg":
        raise ValueError("a skin must be an <svg> document")
    _clean(root)
    return ET.tostring(root, encoding="unicode")
