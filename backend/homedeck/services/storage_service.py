"""Storage breakdowns for the Storage drill-in page.

Three independent views:
  - Docker usage (images/containers/volumes/build cache) via the Docker df API.
  - Filesystems / mounts (psutil + statvfs for inodes).
  - Largest directories: a `du -d1`-style scan of a path's immediate children,
    staying on one filesystem and surfacing permission-denied paths (the service
    runs unprivileged, so root-only trees like /var/lib/docker are flagged).
"""

from __future__ import annotations

import os
from typing import Any

import psutil
from docker.errors import DockerException

from .docker_service import DockerUnavailable, get_client
from .metrics_service import _PSEUDO_FSTYPES


# --- Docker storage ---------------------------------------------------------

def _image_name(img: dict[str, Any]) -> str:
    tags = img.get("RepoTags") or []
    real = [t for t in tags if t and t != "<none>:<none>"]
    if real:
        return real[0]
    digests = img.get("RepoDigests") or []
    if digests and digests[0]:
        return digests[0].split("@")[0]
    return (img.get("Id") or "").replace("sha256:", "")[:19] or "<none>"


def docker_usage() -> dict[str, Any]:
    try:
        df = get_client().df()
    except DockerException as exc:
        raise DockerUnavailable(str(exc)) from exc

    images = df.get("Images") or []
    containers = df.get("Containers") or []
    volumes = df.get("Volumes") or []
    build = df.get("BuildCache") or []
    layers_size = df.get("LayersSize") or 0

    def vol_size(v: dict) -> int:
        return ((v.get("UsageData") or {}).get("Size") or 0)

    def vol_refs(v: dict) -> int:
        return ((v.get("UsageData") or {}).get("RefCount") or 0)

    # Images: total on-disk is the deduplicated LayersSize. Reclaimable ≈ the
    # non-shared bytes of images not used by any container.
    img_reclaimable = sum(
        max((i.get("Size") or 0) - (i.get("SharedSize") or 0), 0)
        for i in images
        if (i.get("Containers") or 0) <= 0
    )
    cont_size = sum(c.get("SizeRw") or 0 for c in containers)
    cont_reclaimable = sum(c.get("SizeRw") or 0 for c in containers if c.get("State") != "running")
    vol_total = sum(vol_size(v) for v in volumes)
    vol_reclaimable = sum(vol_size(v) for v in volumes if vol_refs(v) <= 0)
    bc_size = sum(b.get("Size") or 0 for b in build)

    categories = [
        {
            "type": "Images",
            "count": len(images),
            "active": sum(1 for i in images if (i.get("Containers") or 0) > 0),
            "size": layers_size,
            "reclaimable": img_reclaimable,
        },
        {
            "type": "Containers",
            "count": len(containers),
            "active": sum(1 for c in containers if c.get("State") == "running"),
            "size": cont_size,
            "reclaimable": cont_reclaimable,
        },
        {
            "type": "Volumes",
            "count": len(volumes),
            "active": sum(1 for v in volumes if vol_refs(v) > 0),
            "size": vol_total,
            "reclaimable": vol_reclaimable,
        },
        {
            "type": "Build cache",
            "count": len(build),
            "active": 0,
            "size": bc_size,
            "reclaimable": bc_size,
        },
    ]

    largest_images = sorted(images, key=lambda i: i.get("Size") or 0, reverse=True)[:10]
    largest_volumes = sorted(volumes, key=vol_size, reverse=True)[:10]
    return {
        "categories": categories,
        "total_size": sum(c["size"] for c in categories),
        "total_reclaimable": sum(c["reclaimable"] for c in categories),
        "largest_images": [
            {
                "name": _image_name(i),
                "size": i.get("Size") or 0,
                "shared": i.get("SharedSize") or 0,
                "containers": i.get("Containers") or 0,
            }
            for i in largest_images
        ],
        "largest_volumes": [
            {"name": v.get("Name"), "size": vol_size(v), "refcount": vol_refs(v)}
            for v in largest_volumes
            if vol_size(v) > 0
        ],
    }


# --- Filesystems ------------------------------------------------------------

def filesystems() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for part in psutil.disk_partitions(all=False):
        if not part.fstype or part.fstype in _PSEUDO_FSTYPES or part.device in seen:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        seen.add(part.device)
        inodes = None
        try:
            st = os.statvfs(part.mountpoint)
            itotal = st.f_files
            ifree = st.f_ffree
            if itotal:
                iused = itotal - ifree
                inodes = {
                    "total": itotal,
                    "used": iused,
                    "free": ifree,
                    "percent": round(iused / itotal * 100, 1),
                }
        except OSError:
            pass
        out.append(
            {
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "opts": part.opts,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent,
                "inodes": inodes,
            }
        )
    out.sort(key=lambda d: d["mountpoint"])
    return out


# --- Largest directories (du -d1, single filesystem) ------------------------

def _dir_size(path: str) -> tuple[int, int]:
    """Recursive byte size of a directory, not crossing mountpoints or symlinks.

    Returns (total_bytes, error_count) where errors are unreadable subpaths.
    """
    total = 0
    errors = 0

    def on_error(_exc: OSError) -> None:
        nonlocal errors
        errors += 1

    for root, dirs, files in os.walk(path, onerror=on_error, followlinks=False):
        # Don't descend into nested mountpoints (other filesystems).
        dirs[:] = [d for d in dirs if not os.path.ismount(os.path.join(root, d))]
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                errors += 1
    return total, errors


def directory_breakdown(path: str = "/", limit: int = 40) -> dict[str, Any]:
    """`du -d1`-style listing of a directory's immediate children, by size."""
    path = os.path.realpath(path)
    if not os.path.isdir(path):
        raise NotADirectoryError(path)
    try:
        names = os.listdir(path)
    except PermissionError as exc:
        raise PermissionError(f"Permission denied: {path}") from exc

    entries: list[dict[str, Any]] = []
    for name in names:
        full = os.path.join(path, name)
        try:
            is_link = os.path.islink(full)
            is_dir = os.path.isdir(full) and not is_link
        except OSError:
            continue

        if is_link:
            entries.append({"name": name, "is_dir": False, "is_link": True, "size": 0, "accessible": True, "is_mount": False})
            continue
        if is_dir:
            if os.path.ismount(full):
                try:
                    size = psutil.disk_usage(full).used
                except (PermissionError, OSError):
                    size = 0
                entries.append({"name": name, "is_dir": True, "is_link": False, "is_mount": True, "size": size, "accessible": True})
            else:
                size, errs = _dir_size(full)
                entries.append({"name": name, "is_dir": True, "is_link": False, "is_mount": False, "size": size, "accessible": errs == 0, "errors": errs})
        else:
            try:
                size = os.lstat(full).st_size
            except OSError:
                size = 0
            entries.append({"name": name, "is_dir": False, "is_link": False, "is_mount": False, "size": size, "accessible": True})

    entries.sort(key=lambda e: e["size"], reverse=True)
    return {
        "path": path,
        "parent": os.path.dirname(path) if path != "/" else None,
        "entries": entries[:limit],
        "truncated": len(entries) > limit,
    }
