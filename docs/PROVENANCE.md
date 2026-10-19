# Source provenance

## Extraction

Source project: **ant-world**  
Source commit: **23eb201f9a8a63ab1a8963ca05814597f96321a4**  
Extraction date: **2026-10-18**

This is a new repository with fresh history. It does not contain ant-world's Git history, deployment configuration, gameplay modules, credentials, or game art.

[The source manifest](source-manifest.json) records SHA-256 hashes of the eight original cloud modules and seven cloud regression files before modification. This supports comparison with the source checkout without requiring that project to be public.

Standalone changes:

- Replace relative vendored Three imports with the exact Three.js peer dependency.
- Expose a package entry point and explicit module subpaths.
- Add explicit view: 'ant' | 'world' | 'system' | null while retaining the legacy adapter.
- Use an independent three-planet-clouds-v1 preference key.
- Format JavaScript and tests for readability without changing embedded GLSL algorithms.
- Strengthen the Low hot-path test so its source selection cannot silently match an empty string after formatting.
- Add shader lineage notices, package/API checks, a procedural demo, and documentation.

The v0.1 numerical layout/density remains available in explicit legacy mode. Version 0.2 adds newly authored weather and hierarchy modules, a new density construction, and the coordinated worker/Low changes described in [Enhancements](ENHANCEMENTS.md). The sample caps and composition pipeline are retained. The demo's planet and controls do not depend on ant-world assets. The original source hashes remain historical extraction records, not hashes of the enhanced files.

## External work

The three user-supplied cloud projects were reviewed as technique references. No complete renderer, source file, or image/noise texture from those repositories is bundled. The repository includes explicit notices for the compact FXAA construction and ACES/Three.js constants instead of claiming all shader techniques as original. See [Credits](../CREDITS.md) and [Third-party notices](../THIRD_PARTY_NOTICES.md).

Upstream license pages were checked during extraction on 2026-10-18. Faraz Shaikh's reviewed tree did not contain a root license. Leonardo Soares Gonçalves's project and Shota Matsuda's three-geospatial repository carry MIT notices. These observations are not a grant to reuse unlicensed material from elsewhere.

## Included blue-noise bytes

The 32² rank mask is inherited as bytes from ant-world's cloud-volume-data module, not downloaded from the referenced cloud projects. Its retained source comment describes a toroidal void-and-cluster construction with Gaussian sigma 1.5, seed 0xBA5E, and 10% initial occupancy followed by ranking through the complement.

The original generation script was not present in the inspected source tree. Therefore this release provides the exact bytes and tests their histogram, copy isolation, and low-frequency suppression, but does **not** claim a retained script can regenerate the same bytes from those parameters. The SHA-256 of the mask is recorded in [asset-manifest.json](asset-manifest.json). A future generator should either reproduce that hash or deliberately version a replacement.

## Naming and publication

The public repository is [rsteth/three-planet-clouds](https://github.com/rsteth/three-planet-clouds). Package metadata names that verified destination. The package name does not imply an npm registry publication.
