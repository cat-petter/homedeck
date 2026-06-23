"""Shared app metadata: map a Docker image reference to a display name, a likely
web-UI port, and an icon URL.

Used by Discover (proposing tiles for existing containers) and, later, the app
store config form. The curated map is intentionally small and clearly
extensible — we don't fabricate exhaustive data, we annotate the common cases
and fall back to derived guesses (icons degrade gracefully if missing).
"""

from __future__ import annotations

from dataclasses import dataclass

# Icon CDN keyed by app slug (homarr-labs/dashboard-icons). Falls back gracefully
# in the UI (AppIcon) if a slug has no icon.
ICON_BASE = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png"


def icon_url(slug: str) -> str:
    return f"{ICON_BASE}/{slug}.png"


@dataclass
class AppMeta:
    slug: str
    name: str
    web_port: int | None
    icon_url: str


# Curated map keyed by the image's final path segment (stable across registries:
# both linuxserver/jellyfin and jellyfin/jellyfin → "jellyfin"). Each entry:
# (display name, default web port or None, dashboard-icons slug).
_CURATED: dict[str, tuple[str, int | None, str]] = {
    "adguardhome": ("AdGuard Home", 3000, "adguard-home"),
    "pihole": ("Pi-hole", 80, "pi-hole"),
    "jellyfin": ("Jellyfin", 8096, "jellyfin"),
    "plex": ("Plex", 32400, "plex"),
    "emby": ("Emby", 8096, "emby"),
    "immich-server": ("Immich", 2283, "immich"),
    "immich-machine-learning": ("Immich ML", None, "immich"),
    "home-assistant": ("Home Assistant", 8123, "home-assistant"),
    "grafana": ("Grafana", 3000, "grafana"),
    "prometheus": ("Prometheus", 9090, "prometheus"),
    "portainer-ce": ("Portainer", 9443, "portainer"),
    "portainer": ("Portainer", 9443, "portainer"),
    "vaultwarden": ("Vaultwarden", 80, "vaultwarden"),
    "nextcloud": ("Nextcloud", 80, "nextcloud"),
    "sonarr": ("Sonarr", 8989, "sonarr"),
    "radarr": ("Radarr", 7878, "radarr"),
    "prowlarr": ("Prowlarr", 9696, "prowlarr"),
    "bazarr": ("Bazarr", 6767, "bazarr"),
    "lidarr": ("Lidarr", 8686, "lidarr"),
    "readarr": ("Readarr", 8787, "readarr"),
    "qbittorrent": ("qBittorrent", 8080, "qbittorrent"),
    "transmission": ("Transmission", 9091, "transmission"),
    "deluge": ("Deluge", 8112, "deluge"),
    "jellyseerr": ("Jellyseerr", 5055, "jellyseerr"),
    "overseerr": ("Overseerr", 5055, "overseerr"),
    "uptime-kuma": ("Uptime Kuma", 3001, "uptime-kuma"),
    "gitea": ("Gitea", 3000, "gitea"),
    "forgejo": ("Forgejo", 3000, "forgejo"),
    "paperless-ngx": ("Paperless-ngx", 8000, "paperless-ngx"),
    "navidrome": ("Navidrome", 4533, "navidrome"),
    "audiobookshelf": ("Audiobookshelf", 13378, "audiobookshelf"),
    "syncthing": ("Syncthing", 8384, "syncthing"),
    "duplicati": ("Duplicati", 8200, "duplicati"),
    "filebrowser": ("File Browser", 80, "filebrowser"),
    "code-server": ("code-server", 8443, "code-server"),
    "homepage": ("Homepage", 3000, "homepage"),
    "homarr": ("Homarr", 7575, "homarr"),
    "heimdall": ("Heimdall", 80, "heimdall"),
    "dashy": ("Dashy", 80, "dashy"),
    "nginx-proxy-manager": ("Nginx Proxy Manager", 81, "nginx-proxy-manager"),
    "npm": ("Nginx Proxy Manager", 81, "nginx-proxy-manager"),
    "crafty-4": ("Crafty Controller", 8443, "crafty-controller"),
}

# Common suffixes to strip when a slug isn't found directly (immich-server → immich).
_STRIP_SUFFIXES = ("-server", "-app", "-ce", "-ee", "-community")

# Generic final path segments where the namespace carries the app identity
# (vaultwarden/server → "vaultwarden").
_GENERIC_SEGMENTS = {"server", "app", "core", "web", "application", "ce", "ee", "docker"}


def parse_image(image_ref: str) -> dict[str, str]:
    """Parse a Docker image reference into registry/repository/tag/slug.

    Handles implicit docker.io and the library/ namespace.
    """
    ref = (image_ref or "").strip()
    # Strip digest.
    if "@" in ref:
        ref = ref.split("@", 1)[0]

    registry = "docker.io"
    remainder = ref
    first, _, rest = ref.partition("/")
    if rest and ("." in first or ":" in first or first == "localhost"):
        registry = first
        remainder = rest

    # Split repository / tag (a ':' after the last '/').
    repo = remainder
    tag = "latest"
    if ":" in remainder.rsplit("/", 1)[-1]:
        repo, _, tag = remainder.rpartition(":")

    if registry == "docker.io" and "/" not in repo:
        repo = f"library/{repo}"

    slug = repo.rsplit("/", 1)[-1].lower()
    return {"registry": registry, "repository": repo, "tag": tag, "slug": slug}


def _lookup(slug: str) -> tuple[str, int | None, str] | None:
    if slug in _CURATED:
        return _CURATED[slug]
    for suffix in _STRIP_SUFFIXES:
        if slug.endswith(suffix):
            base = slug[: -len(suffix)]
            if base in _CURATED:
                return _CURATED[base]
    return None


def _humanize(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").strip().title() or slug


def app_metadata(image_ref: str) -> AppMeta:
    parsed = parse_image(image_ref)
    slug = parsed["slug"]
    # Generic last segment (…/server) → use the namespace as the app identity.
    segments = parsed["repository"].split("/")
    if slug in _GENERIC_SEGMENTS and len(segments) >= 2:
        slug = segments[-2].lower()
    curated = _lookup(slug)
    if curated:
        name, web_port, icon_slug = curated
        return AppMeta(slug=slug, name=name, web_port=web_port, icon_url=icon_url(icon_slug))
    # Unknown image: derive a display name and try the icon CDN by slug.
    return AppMeta(slug=slug, name=_humanize(slug), web_port=None, icon_url=icon_url(slug))
