#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# 1. Node dependencies (for Vite build + Capacitor CLI)
# ──────────────────────────────────────────────────────────────────────────────
if [ -f package.json ]; then
  echo "[hook] Installing npm dependencies..."
  npm install --no-audit --no-fund --loglevel=error
fi

# ──────────────────────────────────────────────────────────────────────────────
# 2. Build a Java agent that installs an Authenticator for the HTTPS proxy.
#
# The remote container's egress proxy requires HTTP Basic auth for CONNECT
# tunneling. Modern JDKs ignore -Dhttp.proxyUser/-Dhttp.proxyPassword unless a
# java.net.Authenticator is registered. sdkmanager (and Gradle) use
# HttpURLConnection, so we install a default Authenticator via a javaagent.
# ──────────────────────────────────────────────────────────────────────────────
AGENT_DIR="${PROJECT_DIR}/.claude/hooks/lib"
AGENT_JAR="${AGENT_DIR}/proxy-auth-agent.jar"
if [ ! -f "$AGENT_JAR" ] && [ -f "${AGENT_DIR}/ProxyAuthAgent.java" ]; then
  echo "[hook] Building proxy-auth Java agent..."
  (
    cd "$AGENT_DIR"
    javac ProxyAuthAgent.java
    cat > manifest.txt <<EOF
Premain-Class: ProxyAuthAgent
Agent-Class: ProxyAuthAgent
Can-Retransform-Classes: true
EOF
    jar cfm proxy-auth-agent.jar manifest.txt ProxyAuthAgent*.class
    rm -f manifest.txt ProxyAuthAgent*.class
  )
fi

# If an agent jar exists, include it in JAVA_TOOL_OPTIONS for the rest of the hook
# and for the session. This makes Java authenticate CONNECT tunneling properly.
if [ -f "$AGENT_JAR" ]; then
  case "${JAVA_TOOL_OPTIONS:-}" in
    *"$AGENT_JAR"*) ;;  # already present
    *) export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -javaagent:${AGENT_JAR}" ;;
  esac
fi

# ──────────────────────────────────────────────────────────────────────────────
# 3. Android SDK (for ./gradlew assembleDebug)
#
# Android Gradle Plugin 8.2.1 requires compileSdk 34 / build-tools 34.0.0.
# Java 21 is already on the base image.
# ──────────────────────────────────────────────────────────────────────────────
ANDROID_SDK_DIR="${HOME}/.android-sdk"
CMDLINE_TOOLS_VER="11076708"   # commandline-tools revision 12.0
CMDLINE_TOOLS_ZIP="commandlinetools-linux-${CMDLINE_TOOLS_VER}_latest.zip"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/${CMDLINE_TOOLS_ZIP}"

PLATFORM_VER="android-34"
BUILD_TOOLS_VER="34.0.0"

SDKMANAGER="${ANDROID_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager"

if [ ! -x "$SDKMANAGER" ]; then
  echo "[hook] Installing Android command-line tools..."
  mkdir -p "${ANDROID_SDK_DIR}/cmdline-tools"
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  curl -sSL -o "${tmpdir}/tools.zip" "$CMDLINE_TOOLS_URL"
  unzip -q "${tmpdir}/tools.zip" -d "${tmpdir}"
  # Google ships the zip with a top-level "cmdline-tools/" directory; sdkmanager
  # expects it to live under "cmdline-tools/latest/".
  rm -rf "${ANDROID_SDK_DIR}/cmdline-tools/latest"
  mv "${tmpdir}/cmdline-tools" "${ANDROID_SDK_DIR}/cmdline-tools/latest"
fi

export ANDROID_HOME="${ANDROID_SDK_DIR}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_DIR}"
export PATH="${ANDROID_SDK_DIR}/cmdline-tools/latest/bin:${ANDROID_SDK_DIR}/platform-tools:${PATH}"

# Accept licenses (idempotent).
yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true

# Install required SDK packages (idempotent — sdkmanager skips already-installed).
if [ ! -d "${ANDROID_SDK_DIR}/platforms/${PLATFORM_VER}" ] \
   || [ ! -d "${ANDROID_SDK_DIR}/build-tools/${BUILD_TOOLS_VER}" ] \
   || [ ! -d "${ANDROID_SDK_DIR}/platform-tools" ]; then
  echo "[hook] Installing Android SDK packages (platform-tools, platforms;${PLATFORM_VER}, build-tools;${BUILD_TOOLS_VER})..."
  yes | "$SDKMANAGER" --install \
    "platform-tools" \
    "platforms;${PLATFORM_VER}" \
    "build-tools;${BUILD_TOOLS_VER}" >/dev/null
fi

# ──────────────────────────────────────────────────────────────────────────────
# 4. Point the Gradle build at the SDK
# ──────────────────────────────────────────────────────────────────────────────
if [ -d "${PROJECT_DIR}/android" ]; then
  cat > "${PROJECT_DIR}/android/local.properties" <<EOF
sdk.dir=${ANDROID_SDK_DIR}
EOF
fi

# ──────────────────────────────────────────────────────────────────────────────
# 5. Persist env vars for the rest of the session
# ──────────────────────────────────────────────────────────────────────────────
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export ANDROID_HOME=\"${ANDROID_SDK_DIR}\""
    echo "export ANDROID_SDK_ROOT=\"${ANDROID_SDK_DIR}\""
    echo "export PATH=\"${ANDROID_SDK_DIR}/cmdline-tools/latest/bin:${ANDROID_SDK_DIR}/platform-tools:\${PATH}\""
    if [ -f "$AGENT_JAR" ]; then
      echo "export JAVA_TOOL_OPTIONS=\"\${JAVA_TOOL_OPTIONS:-} -javaagent:${AGENT_JAR}\""
    fi
  } >> "$CLAUDE_ENV_FILE"
fi

echo "[hook] Setup complete. ANDROID_HOME=${ANDROID_SDK_DIR}"
