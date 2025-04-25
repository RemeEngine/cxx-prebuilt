# cxx-prebuilt

This repository hosts automation to build prebuilt binaries of [ANGLE](https://chromium.googlesource.com/angle/angle) across desktop, mobile, and Apple platforms using [vcpkg](https://github.com/microsoft/vcpkg).

## Continuous Integration: ANGLE via vcpkg

Workflow file: `.github/workflows/vcpkg.yml`

### What It Does
The workflow builds the `angle` port with vcpkg for a matrix of target triplets, packages each build, and uploads them as artifacts.

### Supported Targets (Matrix)
| Name          | Runner        | vcpkg Triplet   | Notes |
|---------------|---------------|-----------------|-------|
| windows-x64   | windows-latest| x64-windows     | Desktop Windows |
| macos-x64     | macos-13      | x64-osx         | Intel macOS |
| macos-arm64   | macos-14      | arm64-osx       | Apple Silicon |
| android-x64   | ubuntu-latest | android-x64     | Requires NDK (auto-setup) |
| android-arm64 | ubuntu-latest | android-arm64   | Requires NDK (auto-setup) |
| android-arm   | ubuntu-latest | android-arm     | Requires NDK (auto-setup) |
| ios-arm64     | macos-14      | arm64-ios       | iOS device build |

### Triggers
Currently only manual:
```
on:
  workflow_dispatch:
```
You can add branches or tags if desired, for example:
```yaml
on:
  push:
    branches: [ vcpkg ]
  workflow_dispatch:
```

### Key Steps
1. Checkout repository.
2. (Android only) Setup Java 17 and Android NDK r26d.
3. Cache vcpkg build artifacts to speed subsequent runs.
4. Clone and bootstrap vcpkg (Windows uses `.bat`, others use `.sh`).
5. Install ANGLE for the matrix triplet: `vcpkg install angle --triplet <triplet>`.
6. Package the installed tree: `tar -czf angle-<triplet>.tar.gz -C vcpkg/installed <triplet>`.
7. Upload the archive as a workflow artifact.

### Artifacts
Each job uploads: `angle-<triplet>.tar.gz`
Inside the archive: the directory structure under `vcpkg/installed/<triplet>` (include, lib, bin, share, etc.).

### Permissions
```yaml
permissions:
  contents: read
```
Restricted token scope: read-only repository access (cannot push, tag, or comment). Adjust if you later publish releases (`contents: write`).

### Concurrency
```yaml
concurrency:
  group: vcpkg-angle-${{ github.ref }}
  cancel-in-progress: false
```
Ensures only one workflow per ref (branch/PR/tag) runs at a time; others for the same ref queue. Set `cancel-in-progress: true` to skip superseded builds.

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `VCPKG_FEATURE_FLAGS=manifests,binarycaching` | Enables manifest mode & binary caching features. |
| `VCPKG_ROOT` | Path to cloned vcpkg root inside the workspace. |
| `VCPKG_DEFAULT_TRIPLET` | Set per matrix entry to the current triplet. |
| Android vars (`ANDROID_NDK_HOME`, `ANDROID_NDK_ROOT`, `ANDROID_SDK_ROOT`) | Provided for toolchains expecting them. |

### Caching Strategy
Uses `actions/cache` with the key pattern:
```
vcpkg-${{ runner.os }}-${{ matrix.triplet }}-${{ hashFiles('**/vcpkg.json') }}
```
If you add a `vcpkg.json` manifest with dependencies, cache keys will automatically change on dependency updates. Without a manifest, consider pinning a vcpkg commit (see below) to avoid stale binary mismatches.

### Reproducibility Enhancements (Optional)
Add after cloning vcpkg:
```yaml
      - name: Pin vcpkg commit
        run: |
          cd vcpkg
          git checkout <commit-sha>
```
Find a tested commit from the vcpkg repository or a tag (e.g., a date-based baseline).

### Using the Artifacts
After a run completes, download the artifact for your target, then extract:
```bash
tar -xzf angle-<triplet>.tar.gz
# Contents expand into <triplet>/ (if you first create a directory) or just inspect with tar -tzf
```
Integrate with your build system (examples):

CMake (using toolchain):
```bash
cmake -DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake \
      -DVCPKG_TARGET_TRIPLET=<triplet> \
      -S . -B build
```

### Extending the Workflow
- Add a test project build step to validate linkage.
- Publish a GitHub Release artifact on tag pushes (combine all triplets into one release).
- Introduce scheduled runs (e.g., nightly) to pick up upstream ANGLE changes.
- Split desktop/mobile into separate workflows for faster iteration.

### Troubleshooting
| Issue | Possible Cause | Fix |
|-------|----------------|-----|
| Cache miss every run | No `vcpkg.json` or frequent key changes | Add manifest or simplify key |
| Android build fails locating NDK | Action version change | Verify `nttld/setup-ndk@v1` still supports `r26d` or update version |
| iOS build toolchain errors | Missing Xcode components | Ensure runner `macos-14` has required SDK (default should) |
| Link errors in downstream project | Mismatched triplet | Confirm you use identical `VCPKG_TARGET_TRIPLET` |

### Future Ideas
- Generate SBOM (software bill of materials) for each artifact.
- Sign artifacts or checksum manifest.
- Add linter step to validate workflow & security scanning.

---
Generated documentation for the CI workflow. Update this README as you evolve build targets or distribution strategy.
