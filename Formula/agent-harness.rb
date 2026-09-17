class AgentHarness < Formula
  desc "Performance layer for coding agents"
  homepage "https://github.com/TheElephantCoder/agent-harness"
  url "https://github.com/TheElephantCoder/agent-harness/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "f685fcb060ae3182549bfbb85e8a0f36d2e8877389fdab378bdb3485fef3c04a"
  license "MIT"
  head "https://github.com/TheElephantCoder/agent-harness.git", branch: "main"

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: false)
    system "npm", "run", "build"
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "0.2.0", shell_output("#{bin}/harness --version")
    system bin/"harness", "doctor"
  end
end
