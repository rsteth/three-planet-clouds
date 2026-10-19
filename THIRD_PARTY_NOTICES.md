# Third-party notices

The root MIT license covers the original work in this repository. It does not replace the notices applicable to third-party portions.

| Material                          | Where used                                                                                                            | Retained notice                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Three.js r169                     | Peer dependency; shader chunks and ACES-compatible constants used by Low and High                                     | [Three.js MIT notice](licenses/THREE.txt)                                          |
| Compact WebGL FXAA lineage        | Diagonal-luma edge direction, reduction constants, and narrow/wide output filtering in `src/cloud-high.js`            | [Matt DesLauriers MIT and Armin Ronacher redistribution notice](licenses/FXAA.txt) |
| Fitted ACES / LTC example lineage | ACES input/output matrices and rational-fit coefficients in `inverseACESClearColor`; runtime fit supplied by Three.js | [LTC source notice](licenses/LTC.txt), including its paper attribution requirement |

The FXAA shader has different names, an early contrast threshold, and preserves center alpha; the classic filtering construction is retained and credited. The ACES inversion solves the fitted transfer function used by Three.js; it is not a new tone-mapping operator.

The Three.js package itself is installed as a dependency and is not vendored into `src/`. Its package distribution carries additional upstream notices where applicable. The demo’s OrbitControls comes from that same package.

For redistribution, include this file, the root LICENSE, CREDITS.md, and the notices in licenses/. The npm package file list includes these materials. If you extract only individual shader strings, carry the corresponding notices with them.

The cloud projects in [Credits](CREDITS.md) are technique references, not vendored libraries. No cloud project screenshots, logos, precomputed textures, or game assets are included.
