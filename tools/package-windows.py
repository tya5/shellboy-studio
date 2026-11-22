#!/usr/bin/env python3
"""Build and inspect a candidate-only Windows x64 desktop ZIP."""
import argparse
from pathlib import Path
import re
import struct
from zipfile import ZIP_DEFLATED, ZipFile


def check_pe(data, subsystem):
    if not data.startswith(b"MZ") or len(data) < 64:
        raise ValueError("missing DOS header")
    pe, = struct.unpack_from("<I", data, 60)
    if pe + 94 > len(data) or data[pe:pe + 6] != b"PE\x00\x00\x64\x86":
        raise ValueError("not an x64 Windows PE executable")
    if (struct.unpack_from("<H", data, pe + 24)[0], struct.unpack_from("<H", data, pe + 92)[0]) != (0x20B, subsystem):
        raise ValueError("wrong PE format or Windows subsystem")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for ref in ("studio", "core"):
        parser.add_argument(f"--{ref}", required=True)
    for path in ("studio-bin", "core-bin", "out"):
        parser.add_argument(f"--{path}", required=True, type=Path)
    args = parser.parse_args()
    if not all(re.fullmatch("[0-9a-f]{40}", ref) for ref in (args.studio, args.core)):
        parser.error("exact Studio and Core SHAs are required")
    entries = {"Shellboy Studio.exe": args.studio_bin, "shellboy.exe": args.core_bin,
               "README.txt": Path("docs/guides/windows-desktop.txt")}
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"shellboy-studio-desktop-candidate-{args.studio}-core-{args.core}-x86_64-pc-windows-msvc.zip"
    with ZipFile(path, "x", ZIP_DEFLATED) as archive:
        for name, source in entries.items():
            archive.write(source, name)
    try:
        with ZipFile(path) as archive:
            if archive.namelist() != list(entries) or archive.testzip() is not None:
                raise ValueError("bad desktop ZIP layout or CRC")
            check_pe(archive.read("Shellboy Studio.exe"), 2)
            check_pe(archive.read("shellboy.exe"), 3)
    except Exception:
        path.unlink()
        raise
    print(path)


if __name__ == "__main__":
    main()
