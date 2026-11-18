#!/usr/bin/env bash
# Release Neon Work: check, build, tag and publish a version.
#
#   tools/release.sh [VERSION] [--dry-run] [--yes] [--no-push]
#
#   VERSION     X.Y.Z. Default: the version in src/kernel/manifest.json. If it differs from the manifest, the manifest
#               and versions.json are set to it and committed ("Release X.Y.Z").
#   --dry-run   run the checks and the build, then say what would happen; change nothing, push nothing
#   --yes       don't ask before changing the version, tagging or pushing
#   --no-push   stop after tagging (to push later, run it again without --no-push)
#
# Needs docs/release-notes/VERSION.md (its text becomes the GitHub release notes). Steps:
#   1. checks: a clean working tree, the release notes, the unit tests, the build and tools/check.mjs
#   2. the version in the manifest and versions.json (only when VERSION differs)
#   3. the sample vault's copy of the plugin, committed if it changed
#   4. main fast-forwarded to this branch (main must not have commits this branch lacks)
#   5. an annotated tag VERSION on this commit
#   6. push main, this branch and the tag to origin
#   7. a GitHub release with dist/neon-work/{main.js,manifest.json,styles.css}, with the GitHub CLI (gh) when it is
#      installed and signed in; otherwise the steps for github.com are printed
# Safe to run again: steps already done (version set, tag on this commit, release made) are skipped.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY=0
YES=0
PUSH=1
VERSION=''
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --yes | -y) YES=1 ;;
    --no-push) PUSH=0 ;;
    -h | --help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $a (see --help)" >&2; exit 2 ;;
    *) VERSION="$a" ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
# run a command that changes something (shown, or only described with --dry-run)
run() {
  if [ "$DRY" = 1 ]; then printf '   would run: %s\n' "$*"; else printf '   + %s\n' "$*"; "$@"; fi
}
ask() {
  [ "$YES" = 1 ] || [ "$DRY" = 1 ] && return 0
  local r
  read -r -p "   $1 [y/N] " r
  [[ "$r" =~ ^[Yy] ]] || fail "not confirmed"
}

MANIFEST=src/kernel/manifest.json
DIST=dist/neon-work
SAMPLE="sample vault/.obsidian/plugins/neon-work"
CURRENT=$(node -p "require('./$MANIFEST').version")
MINAPP=$(node -p "require('./$MANIFEST').minAppVersion")
VERSION=${VERSION:-$CURRENT}
NOTES="docs/release-notes/$VERSION.md"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

say "Neon Work $VERSION (manifest: $CURRENT, branch: $BRANCH)$([ "$DRY" = 1 ] && echo ', dry run')"

# ---- 1. checks
say "Checks"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$VERSION' isn't a release version (X.Y.Z; betas aren't released)"
[ "$BRANCH" != HEAD ] || fail "not on a branch"
[ -z "$(git status --porcelain)" ] || { git status --short; fail "the working tree has changes: commit or stash them first"; }
[ -f "$NOTES" ] || fail "no release notes: write $NOTES first"
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  TAGGED=$(git rev-list -n 1 "$VERSION")
  [ "$TAGGED" = "$(git rev-parse HEAD)" ] || [ "$CURRENT" != "$VERSION" ] || fail "tag $VERSION already exists on another commit ($(git log --oneline -1 "$TAGGED"))"
  [ "$CURRENT" = "$VERSION" ] || fail "tag $VERSION already exists"
fi
echo "   release notes: $NOTES"
echo "   unit tests…"
node --test test/*.test.mjs >/tmp/neon-release-tests.txt 2>&1 || { grep -E '^not ok|^# (pass|fail)' /tmp/neon-release-tests.txt; fail "unit tests failed (all output: /tmp/neon-release-tests.txt)"; }
grep -E '^# (pass|fail)' /tmp/neon-release-tests.txt | sed 's/^/   /'

# ---- 2. the version
if [ "$CURRENT" != "$VERSION" ]; then
  say "Version $CURRENT → $VERSION"
  ask "Set the version to $VERSION and commit?"
  if [ "$DRY" = 1 ]; then
    echo "   would set $MANIFEST and versions.json to $VERSION (minAppVersion $MINAPP), build and commit \"Release $VERSION\""
  else
    node -e "
      const fs = require('fs');
      const m = JSON.parse(fs.readFileSync('$MANIFEST', 'utf8'));
      m.version = '$VERSION';
      fs.writeFileSync('$MANIFEST', JSON.stringify(m, null, 2) + '\n');
      const v = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
      v['$VERSION'] = m.minAppVersion;
      fs.writeFileSync('versions.json', JSON.stringify(v, null, 2) + '\n');"
  fi
fi

say "Build"
node tools/build.mjs | tail -1 | sed 's/^/   /'
node tools/check.mjs dist >/tmp/neon-release-check.txt 2>&1 || { tail -20 /tmp/neon-release-check.txt; fail "tools/check.mjs found problems"; }
grep -E '✓|failure' /tmp/neon-release-check.txt | tail -1 | sed 's/^/   /'
if [ "$DRY" = 0 ]; then
  BUILT=$(node -p "require('./$DIST/manifest.json').version")
  [ "$BUILT" = "$VERSION" ] || fail "the build says $BUILT, not $VERSION"
fi
if [ "$CURRENT" != "$VERSION" ] && [ "$DRY" = 0 ]; then
  node tools/map.mjs >/dev/null
  run git add "$MANIFEST" manifest.json versions.json MAP.md
  run git commit -q -m "Release $VERSION"
fi

# ---- 3. the sample vault
if [ -d "$SAMPLE" ]; then
  say "Sample vault"
  if [ "$DRY" = 1 ]; then
    echo "   would copy main.js, styles.css and manifest.json from $DIST and commit them if they changed"
  else
    cp "$DIST/main.js" "$DIST/styles.css" "$DIST/manifest.json" "$SAMPLE/"
    if [ -n "$(git status --porcelain -- "$SAMPLE")" ]; then
      run git add -- "$SAMPLE"
      run git commit -q -m "Sample vault: plugin build $VERSION"
    else
      echo "   already up to date"
    fi
  fi
fi

# ---- 4. main
say "main"
if [ "$PUSH" = 1 ]; then git fetch -q origin || fail "can't reach origin (git fetch)"; fi
if git rev-parse -q --verify refs/remotes/origin/main >/dev/null; then
  git merge-base --is-ancestor origin/main HEAD || fail "origin/main has commits this branch lacks: merge them in first"
fi
if [ "$BRANCH" != main ]; then
  git merge-base --is-ancestor main HEAD || fail "main has commits this branch lacks: merge main into $BRANCH first"
  if [ "$(git rev-parse main)" = "$(git rev-parse HEAD)" ]; then
    echo "   main is already here"
  else
    echo "   main moves forward from $(git log --oneline -1 main) to this commit ($(git rev-list --count main..HEAD) commits)"
    run git branch -f main HEAD
  fi
else
  echo "   on main"
fi

# ---- 5. the tag
say "Tag $VERSION"
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null && [ "$(git rev-list -n 1 "$VERSION")" = "$(git rev-parse HEAD)" ]; then
  echo "   already on this commit"
else
  ask "Tag $(git log --oneline -1 HEAD) as $VERSION?"
  TITLE=$(head -1 "$NOTES" | sed 's/^# *//')
  run git tag -a "$VERSION" -m "${TITLE:-Neon Work $VERSION}"
fi

# ---- 6. push
if [ "$PUSH" = 0 ]; then
  say "Not pushed (--no-push). To finish: tools/release.sh $VERSION"
  exit 0
fi
say "Push"
REFS=(main)
[ "$BRANCH" != main ] && REFS+=("$BRANCH")
ask "Push ${REFS[*]} and tag $VERSION to origin?"
run git push origin "${REFS[@]}"
run git push origin "refs/tags/$VERSION"

# ---- 7. the GitHub release
say "GitHub release"
ASSETS=("$DIST/main.js" "$DIST/manifest.json" "$DIST/styles.css")
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if gh release view "$VERSION" >/dev/null 2>&1; then
    echo "   release $VERSION already exists: its files are replaced with this build"
    run gh release upload "$VERSION" "${ASSETS[@]}" --clobber
  else
    run gh release create "$VERSION" "${ASSETS[@]}" --title "$VERSION" --notes-file "$NOTES" --verify-tag
  fi
else
  REPO=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
  cat <<EOF
   The GitHub CLI (gh) isn't installed or signed in, so make the release on github.com:
     1. open https://github.com/$REPO/releases/new
     2. choose the tag $VERSION, title it $VERSION
     3. paste the text of $NOTES as the description
     4. attach ${ASSETS[*]}
     5. Publish release
   (Or install gh, run "gh auth login", and run this script again: it skips what's done.)
EOF
fi

say "Done: Neon Work $VERSION"
