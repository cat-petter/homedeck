"""Connectivity detection: LAN IP + Tailscale IP/MagicDNS name.

All detection is best-effort and never raises; missing pieces are returned as
None so the UI can show what is available.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
from dataclasses import dataclass


@dataclass
class Connectivity:
    hostname: str
    lan_ip: str | None
    tailscale_ip: str | None
    tailscale_dns: str | None
    tailscale_available: bool


def _primary_lan_ip() -> str | None:
    """Find the primary outbound LAN IP without sending traffic.

    Uses a UDP socket 'connected' to a public address; the kernel picks the
    source interface/IP but no packets are actually sent.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _tailscale_status() -> tuple[str | None, str | None, bool]:
    """Return (tailscale_ip, magicdns_name, available) from `tailscale status`."""
    if shutil.which("tailscale") is None:
        return None, None, False
    try:
        out = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, OSError):
        return None, None, True
    if out.returncode != 0:
        return None, None, True
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        return None, None, True

    self_node = data.get("Self") or {}
    ips = self_node.get("TailscaleIPs") or []
    ipv4 = next((ip for ip in ips if ":" not in ip), ips[0] if ips else None)
    dns = (self_node.get("DNSName") or "").rstrip(".") or None
    return ipv4, dns, True


def get_connectivity() -> Connectivity:
    ts_ip, ts_dns, ts_available = _tailscale_status()
    return Connectivity(
        hostname=socket.gethostname(),
        lan_ip=_primary_lan_ip(),
        tailscale_ip=ts_ip,
        tailscale_dns=ts_dns,
        tailscale_available=ts_available,
    )
