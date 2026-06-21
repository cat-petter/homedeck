# catalog/

Curated data and the catalog importer for HomeDeck's app stores.

- `featured/` — small, hand-maintained "Featured" lists layered on top of the
  huge live sources (APT via python-apt/AppStream; Docker via imported catalogs).
- `overrides/` — curated per-app overrides for normalized Docker templates. These
  always win in the resolution order:
  **curated overrides → merged imported templates → generic Docker Hub fallback.**

The Portainer/CasaOS catalog importer and the normalization/dedup pipeline land in
Phase 5. Imported templates retain per-source attribution and respect upstream
licenses (noted in the root `README.md`).
